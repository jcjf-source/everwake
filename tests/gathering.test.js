import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexKey } from '../src/world/hex.js';
import { TERRAIN } from '../src/data/terrain.js';
import { RESOURCES, RESOURCE_KINDS, NODE_KINDS, nodeKindFor, validateNodeKind } from '../src/data/resources.js';
import { nodeForTile, RESOURCE_LAYOUT_VERSION } from '../src/world/resourceNodes.js';
import { createWorldChanges, restoreWorldChanges } from '../src/world/worldChanges.js';
import { createInventory, addItem, countOf } from '../src/systems/inventory.js';
import { nodeState, checkGather, gatherOptions, planApproach } from '../src/systems/gathering.js';
import { createTurnSystem } from '../src/core/game.js';
import { createWorld } from '../src/world/world.js';
import { seedToNumber } from '../src/world/seed.js';
import { hashString } from '../src/core/rng.js';
import { decideTap } from '../src/ui/moveIntent.js';
import * as G from '../src/ui/gatherText.js';
import * as clockText from '../src/ui/clockText.js';
import { asciiGame } from './helpers/asciiMap.js';

// S at (0,0). Mountains at (1,1). Deep water from q = 5 (rows 0–2), so a
// node at (5,0) is reachable from (4,0)/(4,1), and one at (6,1) is cut off.
const MAP = [
  'S . f . . W W W',
  '. M . . . W W W',
  '. . . . . W W W',
];

function setup() {
  const { game, world } = asciiGame(MAP);
  world.setNode(hex(1, 0), 'deadfall', 2); // next to S
  world.setNode(hex(1, 1), 'looseStone', 3); // on the mountain
  world.setNode(hex(2, 0), 'herbPatch', 2); // two hexes from S
  world.setNode(hex(5, 0), 'fishShoal', 2); // deep water by the shore
  world.setNode(hex(6, 1), 'fishShoal', 2); // deep water, no shore
  return { game, world, turns: createTurnSystem() };
}

/** Everything a gather could change. */
const snapshot = (game) => JSON.stringify({
  position: game.player.position,
  turn: game.clock.turn,
  log: game.log,
  items: game.player.inventory.items,
  changes: game.changes.serialize(),
  known: game.memory.serialize().known,
});

// ---------------------------------------------------------------- data

test('resource and node kind definitions are valid', () => {
  assert.deepEqual(Object.keys(RESOURCES).sort(), [...RESOURCE_KINDS].sort());
  for (const k of Object.values(NODE_KINDS)) assert.deepEqual(validateNodeKind(k), [], k.id);
  for (const r of RESOURCE_KINDS) assert.ok(Object.values(NODE_KINDS).some((k) => k.resource === r), `a node kind yields ${r}`);
  assert.equal(nodeKindFor('food', 'deepWater').id, 'fishShoal');
  assert.equal(nodeKindFor('food', 'grassland').id, 'berryBushes');
  assert.equal(nodeKindFor('wood', 'forest').id, 'deadfall');
  assert.ok(validateNodeKind({ id: 'x', name: 'X', resource: 'gold', yield: 1, uses: [1, 2] }).length > 0);
  assert.ok(validateNodeKind({ id: 'x', name: 'X', resource: 'wood', yield: 0, uses: [1, 2] }).length > 0);
  assert.ok(validateNodeKind({ id: 'x', name: 'X', resource: 'wood', yield: 1, uses: [3, 2] }).length > 0);
});

// ---------------------------------------------------------------- placement

test('placement: deterministic, terrain-appropriate, never on the sanctuary', () => {
  const a = createWorld('everwake', 40);
  const b = createWorld('everwake', 40);
  assert.deepEqual(a.resourceNodes, b.resourceNodes, 'same seed, same nodes');
  assert.notDeepEqual(createWorld('other-seed', 40).resourceNodes, a.resourceNodes, 'another seed differs');

  const counts = Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0]));
  for (const n of a.resourceNodes) {
    const t = a.tileAt(n);
    assert.ok(TERRAIN[t.terrain].resources[n.resource] > 0, `${n.resource} suits ${t.terrain} at ${hexKey(n)}`);
    const kind = NODE_KINDS[n.kind];
    assert.equal(kind.resource, n.resource);
    const water = t.terrain === 'deepWater' || t.terrain === 'shallowWater';
    if (kind.water) assert.ok(water, 'fish only in water');
    if (kind.land) assert.ok(!water, 'berries only on land');
    assert.ok(n.uses >= kind.uses[0] && n.uses <= kind.uses[1]);
    assert.equal(a.resourceAt(n), n);
    counts[n.resource]++;
  }
  assert.equal(a.resourceAt(a.sanctuary), null);
  const share = a.resourceNodes.length / a.cells.length;
  assert.ok(share > 0.04 && share < 0.15, `node share ${share.toFixed(3)}`);
  for (const k of RESOURCE_KINDS) assert.ok(counts[k] > 20, `${k}: ${counts[k]} nodes`);
  // Forests hold more wood than grassland; rocky ground more stone.
  const rate = (terrain, res) => {
    const tiles = a.cells.filter((h) => a.tileAt(h).terrain === terrain);
    return tiles.filter((h) => a.resourceAt(h)?.resource === res).length / tiles.length;
  };
  assert.ok(rate('forest', 'wood') > rate('grassland', 'wood'));
  assert.ok(rate('rocky', 'stone') > rate('grassland', 'stone'));
});

test('placement is a pure function of (seed, tile): order- and map-size-independent', () => {
  const seed = seedToNumber('everwake');
  const big = createWorld('everwake', 40);
  const small = createWorld('everwake', 12);
  for (const h of small.cells) {
    if (hexDistance(h, small.sanctuary) === 0 || hexDistance(h, big.sanctuary) === 0) continue;
    assert.deepEqual(small.resourceAt(h), big.resourceAt(h), hexKey(h));
    assert.deepEqual(nodeForTile(seed, big.tileAt(h)), big.resourceAt(h));
  }
});

test('placement golden fingerprint (bump RESOURCE_LAYOUT_VERSION if this changes on purpose)', () => {
  const w = createWorld('everwake', 40);
  assert.equal(w.resourceLayoutVersion, RESOURCE_LAYOUT_VERSION);
  const fp = hashString(w.resourceNodes.map((n) => `${n.q},${n.r},${n.kind},${n.uses}`).join(';'));
  assert.equal(`${w.resourceNodes.length}:${fp}`, GOLDEN);
});
const GOLDEN = '490:2841906290';

// ---------------------------------------------------------------- gather action

test('gathering costs one turn, fills the inventory, logs, and depletes the node', () => {
  const { game, turns } = setup();
  const r1 = turns.perform(game, { type: 'gather', at: hex(1, 0) });
  assert.equal(r1.ok, true);
  assert.equal(r1.cost, 1);
  assert.equal(game.clock.turn, 1);
  assert.equal(countOf(game.player.inventory, 'wood'), 2);
  assert.deepEqual(r1.events, [{ type: 'gathered', at: hex(1, 0), kind: 'deadfall', resource: 'wood', amount: 2, left: 1, total: 2 }]);
  assert.deepEqual(game.log, r1.events);
  assert.deepEqual(game.player.position, hex(0, 0), 'gathering never moves you');

  const r2 = turns.perform(game, { type: 'gather', at: hex(1, 0) });
  assert.equal(r2.ok, true);
  assert.equal(r2.events[0].left, 0);
  assert.equal(countOf(game.player.inventory, 'wood'), 4);
  assert.equal(nodeState(game, hex(1, 0)).left, 0);

  // Spent: refused, and nothing changes.
  const before = snapshot(game);
  const r3 = turns.perform(game, { type: 'gather', at: hex(1, 0) });
  assert.deepEqual(r3, { ok: false, action: { type: 'gather', at: hex(1, 0) }, reason: 'depleted' });
  assert.equal(snapshot(game), before);
  // The generated baseline is untouched: depletion is a world change.
  assert.equal(game.world.resourceAt(hex(1, 0)).uses, 2);
  assert.deepEqual(game.changes.serialize(), { version: 2, gathered: [[1, 0, 2]], pois: [] });
});

test('invalid gathers cost no turn and change nothing', () => {
  const { game, turns } = setup();
  const cases = [
    [{ type: 'gather', at: hex(2, 0) }, 'tooFar'],
    [{ type: 'gather', at: hex(0, 1) }, 'noNode'],
    [{ type: 'gather', at: hex(0, 0) }, 'noNode'],
    [{ type: 'gather', at: hex(6, 1) }, 'unexplored'],
    [{ type: 'gather', at: hex(-5, 0) }, 'outside'],
    [{ type: 'gather' }, 'badTarget'],
    [{ type: 'gather', at: { q: 1.5, r: 0 } }, 'badTarget'],
  ];
  assert.equal(game.memory.isKnown(hex(6, 1)), false, 'the cut-off shoal is beyond sight');
  const before = snapshot(game);
  for (const [action, reason] of cases) {
    const r = turns.perform(game, action);
    assert.equal(r.ok, false, JSON.stringify(action));
    assert.equal(r.reason, reason, JSON.stringify(action));
  }
  assert.equal(snapshot(game), before);
});

test('nodes are gathered from their hex or a neighbour, including impassable ones', () => {
  const { game, world, turns } = setup();
  turns.perform(game, { type: 'move', to: hex(1, 0) });
  // Standing on the deadfall, next to the mountain stone and the herbs.
  assert.equal(checkGather(game, hex(1, 0)).ok, true, 'own hex');
  assert.equal(checkGather(game, hex(1, 1)).ok, true, 'adjacent mountain');
  assert.equal(checkGather(game, hex(2, 0)).ok, true, 'adjacent forest');
  const opts = gatherOptions(game);
  assert.deepEqual(opts.map((o) => [hexKey(o.at), o.direction]), [['1,0', null], ['2,0', 0], ['1,1', 5]],
    'own hex first, then neighbours in direction order');
  const r = turns.perform(game, { type: 'gather', at: hex(1, 1) });
  assert.equal(r.ok, true);
  assert.equal(countOf(game.player.inventory, 'stone'), NODE_KINDS.looseStone.yield);
  assert.equal(world.isWalkable(hex(1, 1)), false);
  assert.deepEqual(game.player.position, hex(1, 0));
});

test('a spent node stays spent when you leave and come back', () => {
  const { game, turns } = setup();
  turns.perform(game, { type: 'gather', at: hex(1, 0) });
  turns.perform(game, { type: 'gather', at: hex(1, 0) });
  for (const to of [hex(0, 1), hex(0, 2), hex(1, 2), hex(2, 2), hex(3, 1), hex(3, 0), hex(2, 0), hex(1, 0)]) {
    assert.equal(turns.perform(game, { type: 'move', to }).ok, true, hexKey(to));
  }
  assert.equal(nodeState(game, hex(1, 0)).left, 0);
  assert.equal(checkGather(game, hex(1, 0)).reason, 'depleted');
  assert.equal(gatherOptions(game).some((o) => hexKey(o.at) === '1,0'), false, 'not offered');
});

test('a gather crossing a day-part boundary: gather event first, then the clock', () => {
  const { game, turns } = setup();
  game.clock.turn = 11;
  const r = turns.perform(game, { type: 'gather', at: hex(1, 0) });
  assert.deepEqual(r.events.map((e) => e.type), ['gathered', 'dayPart']);
  assert.equal(clockText.describeEvents(r.events), 'Gathered 2 wood from deadfall · 1 gather left · The sun passes noon');
});

// ---------------------------------------------------------------- world changes and inventory

test('world changes: save round trip and malformed saves', () => {
  const c = createWorldChanges();
  c.recordGather(hex(3, -2));
  c.recordGather(hex(3, -2), 2);
  c.recordGather(hex(-1, 4));
  assert.equal(c.gathersTaken(hex(3, -2)), 3);
  assert.equal(c.gathersTaken(hex(0, 0)), 0);
  const saved = c.serialize();
  assert.deepEqual(saved, { version: 2, gathered: [[3, -2, 3], [-1, 4, 1]], pois: [] });
  const back = restoreWorldChanges(JSON.parse(JSON.stringify(saved)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.changes.serialize(), saved);
  // A Task 07 (version 1) save still loads, with no POI uses.
  const v1 = restoreWorldChanges({ version: 1, gathered: [[3, -2, 3]] });
  assert.equal(v1.ok, true);
  assert.deepEqual(v1.changes.serialize(), { version: 2, gathered: [[3, -2, 3]], pois: [] });
  for (const bad of [null, 5, { version: 3, gathered: [], pois: [] }, { version: 2, gathered: [] }, { version: 1 }, { version: 1, gathered: [[1, 2]] },
    { version: 1, gathered: [[1, 2, 0]] }, { version: 1, gathered: [[1, 2, 1], [1, 2, 3]] }, { version: 1, gathered: [['a', 2, 1]] }]) {
    assert.equal(restoreWorldChanges(bad).ok, false, JSON.stringify(bad));
  }
  assert.throws(() => c.recordGather(hex(0, 0), 0), RangeError);
});

test('inventory counts', () => {
  const inv = createInventory();
  assert.equal(countOf(inv, 'wood'), 0);
  assert.equal(countOf(inv, 'constructor'), 0);
  assert.equal(addItem(inv, 'wood', 2), 2);
  assert.equal(addItem(inv, 'wood', 1), 3);
  assert.throws(() => addItem(inv, 'wood', 0), RangeError);
  assert.throws(() => addItem(inv, '', 1), TypeError);
});

// ---------------------------------------------------------------- taps on nodes

test('taps on impassable nodes: in reach, approach route, blocked', () => {
  const { game, world, turns } = setup();
  const knowsAll = () => true;
  const liveNode = (h) => { const s = nodeState(game, h); return s && s.left > 0 ? s : null; };
  const tapFrom = (position, h, preview = null, extra = {}) =>
    decideTap(world, { position, preview, travelling: null, knows: knowsAll, nodeAt: liveNode, ...extra }, h);

  // Adjacent mountain stone: in reach, nothing moves.
  assert.deepEqual(tapFrom(hex(1, 0), hex(1, 1)).action, { kind: 'node', at: hex(1, 1) });

  // Far shoal: preview a route to a hex next to it; the second tap travels.
  const first = tapFrom(hex(0, 0), hex(5, 0)).action;
  assert.equal(first.kind, 'approach');
  assert.deepEqual(first.preview.target, hex(5, 0));
  assert.equal(hexDistance(first.preview.destination, hex(5, 0)), 1);
  assert.ok(world.isWalkable(first.preview.destination));
  assert.equal(first.preview.path.length, 4);
  const second = tapFrom(hex(0, 0), hex(5, 0), first.preview).action;
  assert.equal(second.kind, 'travel');
  assert.deepEqual(second.preview.path, first.preview.path);

  // Shoal with no shore: blocked.
  assert.deepEqual(tapFrom(hex(0, 0), hex(6, 1)).action, { kind: 'blocked', at: hex(6, 1) });
  assert.equal(planApproach(world, hex(0, 0), hex(6, 1)), null);

  // A spent mountain node is plain impassable terrain again.
  turns.perform(game, { type: 'move', to: hex(1, 0) });
  for (let i = 0; i < 3; i++) assert.equal(turns.perform(game, { type: 'gather', at: hex(1, 1) }).ok, true);
  assert.equal(nodeState(game, hex(1, 1)).left, 0);
  assert.deepEqual(tapFrom(hex(0, 0), hex(1, 1)).action, { kind: 'impassable', at: hex(1, 1) });

  // While walking to a node, tapping that node only stops.
  const t = decideTap(world, { position: hex(2, 0), preview: null, travelling: first.preview.destination,
    travelTarget: hex(5, 0), knows: knowsAll, nodeAt: liveNode }, hex(5, 0));
  assert.deepEqual(t, { stop: true, action: null });

  // Unmapped nodes are never revealed by a tap.
  const fog = decideTap(world, { position: hex(0, 0), preview: null, travelling: null, knows: game.memory.isKnown, nodeAt: liveNode }, hex(6, 1));
  assert.deepEqual(fog.action, { kind: 'unexplored', at: hex(6, 1) });
});

test('walkable node hexes keep normal movement taps', () => {
  const { game, world } = setup();
  const liveNode = (h) => nodeState(game, h);
  const tap = (h) => decideTap(world, { position: hex(0, 0), preview: null, travelling: null, nodeAt: liveNode }, h).action;
  assert.deepEqual(tap(hex(1, 0)), { kind: 'step', to: hex(1, 0) });
  assert.equal(tap(hex(2, 0)).kind, 'preview');
});

// ---------------------------------------------------------------- text

test('gather text', () => {
  const { game } = setup();
  const s = nodeState(game, hex(1, 0));
  assert.equal(G.describeNode(s), 'Deadfall (wood) · 2 gathers left');
  assert.equal(G.nodeNote(s), ' · Deadfall (wood) · 2 gathers left');
  assert.equal(G.nodeNote(null), '');
  assert.equal(G.describeNode({ ...s, left: 1 }), 'Deadfall (wood) · 1 gather left');
  assert.equal(G.describeNode({ ...s, left: 0 }), 'Deadfall (wood) · picked clean');
  assert.equal(G.describeGathered({ amount: 2, resource: 'wood', left: 0 }, NODE_KINDS.deadfall), 'Gathered 2 wood from deadfall · deadfall is spent');
  assert.equal(G.describeGatherRefused('tooFar', 'Forest · q 2, r 0'), 'Forest · q 2, r 0 · too far to gather: stand on it or next to it');
  assert.equal(G.describeGatherRefused('depleted', 'X'), 'X · picked clean, nothing left to gather');
  assert.equal(G.describeInReach('Mountains · q 1, r 1', nodeState(game, hex(1, 1))), 'Mountains · q 1, r 1 · Loose stone (stone) · 3 gathers left · in reach: tap Gather');
  assert.equal(G.describeApproach('Deep water · q 5, r 0', nodeState(game, hex(5, 0)), 4, 6),
    'Route next to Deep water · q 5, r 0 · Fish shoal (food) · 2 gathers left · 4 steps, terrain cost 6 · tap it again to travel');
  assert.equal(G.describeNodeBlocked('Deep water · q 6, r 1', nodeState(game, hex(6, 1))),
    'Deep water · q 6, r 1 · Fish shoal (food) · 2 gathers left · blocked: no route to a hex next to it');
  assert.deepEqual(G.gatherButton({ ...s, direction: null }), { text: 'Gather wood', where: 'here', label: 'Gather wood from deadfall here (2 gathers left)' });
  assert.deepEqual(G.gatherButton({ ...nodeState(game, hex(1, 1)), direction: 5 }),
    { text: 'Gather stone', where: '↘', label: 'Gather stone from loose stone to the south-east (3 gathers left)' });
  const inv = createInventory();
  addItem(inv, 'herbs', 3);
  assert.equal(G.describeInventory(inv), 'Wood 0 · Stone 0 · Herbs 3 · Food 0');
});
