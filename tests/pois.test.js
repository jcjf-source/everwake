import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexKey, hexNeighbors, hexesInRange } from '../src/world/hex.js';
import { TERRAIN } from '../src/data/terrain.js';
import { POI_TYPES, POI_TYPE_IDS, validatePoiType } from '../src/data/pois.js';
import {
  placePois, poiSuitability, rollFind, POI_LAYOUT_VERSION, MIN_SPACING, SAME_TYPE_SPACING, SANCTUARY_CLEARANCE,
} from '../src/world/poiPlacement.js';
import { poiState, checkInteract, interactOptions, discoverIn, INTERACT_REACH } from '../src/systems/pois.js';
import { createJournal, restoreJournal } from '../src/systems/journal.js';
import { createWorldChanges, restoreWorldChanges } from '../src/world/worldChanges.js';
import { countOf } from '../src/systems/inventory.js';
import { createGame, createTurnSystem } from '../src/core/game.js';
import { createTravel } from '../src/systems/travel.js';
import { createWorld } from '../src/world/world.js';
import { createMapMemory, FOG } from '../src/world/mapMemory.js';
import { hashString } from '../src/core/rng.js';
import * as P from '../src/ui/poiText.js';
import * as clockText from '../src/ui/clockText.js';
import { asciiGame } from './helpers/asciiMap.js';

// A long open strip. S at (0,0); sight radius 4 maps everything within 4.
const MAP = [
  'S . . . . . . . . . . .',
  '. . . . . . . . . . . .',
  '. . . . . . . . . . . .',
];

/** POIs: a chest next to S, ruins three hexes away, a shrine next to S, a camp out of sight (but within the shrine's reach), a cave beyond both. */
function setup() {
  const { game, world } = asciiGame(MAP);
  world.setPoi(hex(1, 0), 'chest', 1, 'Mossy strongbox');
  world.setPoi(hex(3, 0), 'ruins', 3, 'Broken chapel');
  world.setPoi(hex(0, 1), 'shrine', 1, 'Wayshrine');
  world.setPoi(hex(7, 1), 'camp', 1, 'Cold hearth');
  world.setPoi(hex(11, 2), 'cave', 1, 'Dark hollow');
  return { game, world, turns: createTurnSystem() };
}

/** Everything an interaction could change. */
const snapshot = (game) => JSON.stringify({
  position: game.player.position,
  turn: game.clock.turn,
  log: game.log,
  journal: game.journal.serialize(),
  items: game.player.inventory.items,
  changes: game.changes.serialize(),
  known: game.memory.serialize().known,
});

/** Manual timer: scheduled steps run only when the test ticks. */
function manualTimer() {
  const queue = [];
  return {
    schedule: (fn) => { const t = { fn, live: true }; queue.push(t); return t; },
    cancel: (t) => { t.live = false; },
    tick() {
      const t = queue.find((x) => x.live);
      if (!t) return false;
      t.live = false;
      t.fn();
      return true;
    },
  };
}

// ---------------------------------------------------------------- data

test('POI type definitions are valid, and broken ones are caught', () => {
  assert.deepEqual([...POI_TYPE_IDS].sort(), ['camp', 'cave', 'chest', 'ruins', 'shrine']);
  for (const d of Object.values(POI_TYPES)) assert.deepEqual(validatePoiType(d), [], d.id);
  const ok = POI_TYPES.chest;
  for (const bad of [
    { ...ok, uses: [0, 1] },
    { ...ok, names: [] },
    { ...ok, finds: [] },
    { ...ok, finds: [[1, {}]] },
    { ...ok, finds: [[1, { gold: 1 }]] },
    { ...ok, finds: [[0, { wood: 1 }]] },
    { ...ok, effect: 'teleport' },
    { ...POI_TYPES.shrine, revealRadius: 0 },
  ]) assert.ok(validatePoiType(bad).length > 0, JSON.stringify(bad));
});

// ---------------------------------------------------------------- placement

test('suitability follows the terrain rules', () => {
  const t = (terrain, elevation = 0.5) => ({ terrain, elevation });
  const ring = (terrain, elevation = 0.5) => Array.from({ length: 6 }, () => t(terrain, elevation));
  const zero = { ruins: 0, camp: 0, chest: 0, shrine: 0, cave: 0 };
  assert.deepEqual(poiSuitability(t('shallowWater'), ring('grassland')), zero, 'never in water');
  assert.deepEqual(poiSuitability(t('mountains'), ring('rocky')), zero, 'never on impassable ground');
  // Caves only at the foot of mountains, on rocky ground or hills.
  assert.equal(poiSuitability(t('rocky'), ring('rocky')).cave, 0);
  assert.ok(poiSuitability(t('rocky'), [t('mountains'), ...ring('rocky').slice(1)]).cave > 1);
  assert.equal(poiSuitability(t('grassland'), [t('mountains'), ...ring('grassland').slice(1)]).cave, 0);
  // Camps want water nearby.
  const dry = poiSuitability(t('grassland'), ring('grassland')).camp;
  const wet = poiSuitability(t('grassland'), [t('shallowWater'), ...ring('grassland').slice(1)]).camp;
  assert.ok(wet > dry * 3);
  // Ruins favour high ground: a hilltop scores more than a hollow.
  assert.ok(poiSuitability(t('hills', 0.7), ring('hills', 0.6)).ruins > poiSuitability(t('hills', 0.5), ring('hills', 0.6)).ruins);
  // Shrines favour forest clearings.
  assert.ok(poiSuitability(t('grassland'), ring('forest')).shrine > poiSuitability(t('grassland'), ring('grassland')).shrine);
});

test('placement: deterministic, terrain-appropriate, spaced, off nodes and clear of the sanctuary', () => {
  const a = createWorld('everwake', 40);
  assert.deepEqual(a.pois, createWorld('everwake', 40).pois, 'same seed, same POIs');
  assert.notDeepEqual(createWorld('other-seed', 40).pois, a.pois, 'another seed differs');
  for (const seed of ['everwake', 'shore-42', 'island-133', 'mossy fen 12']) {
    const w = createWorld(seed, 40);
    for (const p of w.pois) {
      const t = w.tileAt(p);
      assert.ok(TERRAIN[t.terrain].walkable && t.terrain !== 'shallowWater', `${seed} ${hexKey(p)} on dry land`);
      assert.equal(w.resourceAt(p), null, 'never on a resource node');
      assert.ok(hexDistance(p, w.sanctuary) >= SANCTUARY_CLEARANCE, 'clear of the sanctuary');
      assert.equal(w.poiAt(p), p);
      assert.ok(POI_TYPES[p.type].names.includes(p.name));
      const [lo, hi] = POI_TYPES[p.type].uses;
      assert.ok(p.uses >= lo && p.uses <= hi);
      if (p.type === 'cave') {
        assert.ok(['rocky', 'hills'].includes(t.terrain) && hexNeighbors(p).some((n) => w.tileAt(n)?.terrain === 'mountains'),
          `${seed} cave ${hexKey(p)} at a mountain foot`);
      }
      for (const o of w.pois) {
        if (o === p) continue;
        const d = hexDistance(o, p);
        assert.ok(d >= MIN_SPACING, `${seed}: ${hexKey(o)} and ${hexKey(p)} ${d} apart`);
        if (o.type === p.type) assert.ok(d >= SAME_TYPE_SPACING, `${seed}: two ${p.type} ${d} apart`);
      }
    }
  }
});

test('placement: every type appears, in plausible numbers, across seeds', () => {
  const totals = Object.fromEntries(POI_TYPE_IDS.map((id) => [id, 0]));
  for (let i = 0; i < 20; i++) {
    const w = createWorld(`poi-${i}`, 40);
    assert.ok(w.pois.length >= 30 && w.pois.length <= 70, `poi-${i}: ${w.pois.length} POIs`);
    const types = new Set(w.pois.map((p) => p.type));
    assert.ok(types.size >= 4, `poi-${i}: ${[...types].join(', ')}`);
    for (const p of w.pois) totals[p.type]++;
  }
  for (const id of POI_TYPE_IDS) assert.ok(totals[id] >= 40, `${id}: ${totals[id]} over 20 seeds`);
});

test('placement does not depend on how far the cell scan reaches', () => {
  const w = createWorld('everwake', 40);
  const indexOf = (h) => (w.has(h) ? (h.r + 40) * 81 + (h.q + 40) : -1);
  const wider = placePois(w.seedNumber, {
    radius: 60, has: w.has, tileAt: w.tileAt, isWalkable: w.isWalkable, resourceAt: w.resourceAt, indexOf, sanctuary: w.sanctuary,
  });
  assert.deepEqual(wider.pois, w.pois);
});

test('placement golden fingerprint (bump POI_LAYOUT_VERSION if this changes on purpose)', () => {
  const w = createWorld('everwake', 40);
  assert.equal(w.poiLayoutVersion, POI_LAYOUT_VERSION);
  const fp = hashString(w.pois.map((p) => `${p.q},${p.r},${p.type},${p.name},${p.uses}`).join(';'));
  assert.equal(`${w.pois.length}:${fp}`, GOLDEN);
});
const GOLDEN = '50:806017141';

test('finds are fixed by the seed and come from the type table', () => {
  const poi = { q: 3, r: -2, type: 'ruins' };
  for (let use = 0; use < 3; use++) {
    const f = rollFind(77, poi, use);
    assert.deepEqual(f, rollFind(77, poi, use), 'same seed, hex and use: same find');
    assert.ok(POI_TYPES.ruins.finds.some(([, items]) => JSON.stringify(items) === JSON.stringify(f)));
  }
  assert.equal(rollFind(77, { q: 0, r: 0, type: 'shrine' }, 0), null, 'shrines have no finds');
  const seen = new Set();
  for (let q = 0; q < 40; q++) seen.add(JSON.stringify(rollFind(5, { q, r: 0, type: 'chest' }, 0)));
  assert.equal(seen.size, POI_TYPES.chest.finds.length, 'every chest find occurs');
});

// ---------------------------------------------------------------- map memory

test('observe lists newly seen hexes; reveal maps without sight', () => {
  const m = createMapMemory(10);
  const first = m.observe(hex(0, 0), 2);
  assert.equal(first.newly.length, 19);
  assert.equal(first.revealed, 19);
  assert.deepEqual(m.observe(hex(0, 0), 2).newly, [], 'nothing new the second time');
  const r = m.reveal(hex(5, 0), 2);
  assert.equal(r.revealed, r.newly.length);
  assert.ok(r.newly.every((h) => m.stateAt(h) === FOG.REMEMBERED), 'revealed hexes are mapped, not in sight');
  assert.equal(m.stateAt(hex(0, 0)), FOG.VISIBLE, 'reveal leaves what is in sight visible');
  assert.equal(m.knownCount, 19 + r.revealed);
  assert.equal(m.reveal(hex(5, 0), 2).revealed, 0);
});

// ---------------------------------------------------------------- discovery

test('POIs in sight at the start are discovered at turn 0', () => {
  const { world } = asciiGame(MAP);
  world.setPoi(hex(2, 0), 'chest');
  world.setPoi(hex(9, 0), 'ruins', 2);
  const game = createGame(world);
  assert.deepEqual(game.log, [{ type: 'discovered', at: hex(2, 0), poi: 'chest', name: 'Test chest', from: hex(0, 0) }]);
  assert.deepEqual(game.journal.entries, [{ turn: 0, ...game.log[0] }]);
});

test('a POI coming into sight is discovered once, logged, journalled, and interrupts', () => {
  const { game, turns } = setup();
  for (let q = 1; q <= 3; q++) {
    const r = turns.perform(game, { type: 'move', to: hex(q, 0) });
    assert.equal(r.interrupt, null, `step ${q}: nothing new`);
  }
  const r = turns.perform(game, { type: 'move', to: hex(4, 0) });
  assert.deepEqual(r.events, [{ type: 'discovered', at: hex(7, 1), poi: 'camp', name: 'Cold hearth', from: hex(4, 0) }]);
  assert.deepEqual(r.interrupt, { reason: 'discovery' });
  assert.deepEqual(game.journal.entries.at(-1), { turn: 4, ...r.events[0] });
  assert.equal(clockText.describeEvents(r.events), 'Discovered Cold hearth (abandoned camp) · 4 hexes east');
  // Walking on past it, or back and forth, never discovers it again.
  const before = game.journal.entries.length;
  for (const to of [hex(5, 0), hex(4, 0), hex(5, 0)]) assert.equal(turns.perform(game, { type: 'move', to }).interrupt, null);
  assert.equal(game.journal.entries.length, before);
});

test('travel stops when a POI is sighted, and one tap resumes', () => {
  const { game, turns } = setup();
  const timer = manualTimer();
  const events = [];
  const travel = createTravel({
    step: (to) => turns.perform(game, { type: 'move', to }),
    onEvent: (e) => events.push(e),
    schedule: timer.schedule,
    cancel: timer.cancel,
  });
  const path = [1, 2, 3, 4, 5, 6].map((q) => hex(q, 0));
  travel.start(path);
  while (timer.tick()) { /* */ }
  const e = events.at(-1);
  assert.deepEqual([e.type, e.reason, e.done, hexKey(e.at)], ['interrupted', 'discovery', 4, '4,0']);
  assert.equal(game.clock.turn, 4);
  travel.start(path.slice(4));
  while (timer.tick()) { /* */ }
  assert.equal(events.at(-1).type, 'arrived');
  assert.deepEqual(game.player.position, hex(6, 0));
});

test('discoverIn: nearest first, only POI hexes', () => {
  const { game } = setup();
  const found = discoverIn(game, [hex(11, 2), hex(5, 2), hex(7, 1)]);
  assert.deepEqual(found.map((e) => hexKey(e.at)), ['7,1', '11,2']);
});

// ---------------------------------------------------------------- interaction

test('opening a chest: one turn, the seeded find, opened for good', () => {
  const { game, world, turns } = setup();
  const find = rollFind(world.seedNumber, world.poiAt(hex(1, 0)), 0);
  const had = { ...game.player.inventory.items };
  const r = turns.perform(game, { type: 'interact', at: hex(1, 0) });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(game.player.position, hex(0, 0), 'interacting never moves you');
  assert.deepEqual(r.events, [{ type: 'interacted', at: hex(1, 0), poi: 'chest', name: 'Mossy strongbox', use: 1, left: 0, found: find }]);
  for (const [id, n] of Object.entries(find)) assert.equal(countOf(game.player.inventory, id), (had[id] ?? 0) + n);
  assert.deepEqual(game.journal.entries.at(-1), { turn: 1, ...r.events[0] });
  assert.equal(poiState(game, hex(1, 0)).left, 0);
  assert.equal(world.poiAt(hex(1, 0)).uses, 1, 'the generated baseline is untouched');
  assert.deepEqual(game.changes.serialize().pois, [[1, 0, 1]]);

  // Opened: refused, and nothing changes.
  const before = snapshot(game);
  const again = turns.perform(game, { type: 'interact', at: hex(1, 0) });
  assert.deepEqual(again, { ok: false, action: { type: 'interact', at: hex(1, 0) }, reason: 'spent' });
  assert.equal(snapshot(game), before);
});

test('ruins hold several searches, each with its own find', () => {
  const { game, world, turns } = setup();
  for (const to of [hex(1, 0), hex(2, 0)]) turns.perform(game, { type: 'move', to });
  const poi = world.poiAt(hex(3, 0));
  const had = { ...game.player.inventory.items };
  const finds = [];
  for (let i = 0; i < 3; i++) {
    const r = turns.perform(game, { type: 'interact', at: hex(3, 0) });
    assert.equal(r.ok, true);
    assert.equal(r.events[0].use, i + 1);
    assert.equal(r.events[0].left, 2 - i);
    assert.deepEqual(r.events[0].found, rollFind(world.seedNumber, poi, i));
    finds.push(r.events[0].found);
  }
  assert.equal(checkInteract(game, hex(3, 0)).reason, 'spent');
  const total = {};
  for (const f of finds) for (const [id, n] of Object.entries(f)) total[id] = (total[id] ?? 0) + n;
  for (const [id, n] of Object.entries(total)) assert.equal(countOf(game.player.inventory, id), (had[id] ?? 0) + n);
  assert.equal(game.clock.turn, 5, 'two steps and three searches');
});

test('reading a shrine maps the land around it and discovers what is there', () => {
  const { game, turns } = setup();
  assert.equal(game.memory.isKnown(hex(7, 1)), false);
  const knownBefore = game.memory.knownCount;
  const r = turns.perform(game, { type: 'interact', at: hex(0, 1) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.map((e) => e.type), ['interacted', 'discovered']);
  assert.equal(r.events[0].revealed, game.memory.knownCount - knownBefore);
  assert.ok(r.events[0].revealed > 0);
  assert.equal(r.events[0].found, undefined);
  assert.deepEqual(r.events[1].at, hex(7, 1), 'the camp six hexes from the shrine');
  assert.equal(game.memory.stateAt(hex(7, 1)), FOG.REMEMBERED, 'mapped, not in sight');
  assert.equal(game.memory.isKnown(hex(11, 2)), false, 'the cave is beyond the shrine\'s reach');
  assert.equal(r.interrupt, null, 'knowledge, not sight: nothing to interrupt');
  assert.deepEqual(game.journal.entries.slice(-2).map((e) => [e.type, e.turn]), [['interacted', 1], ['discovered', 1]]);
  assert.match(clockText.describeEvents(r.events), /^Read Wayshrine \(shrine\): the land around is revealed \(\d+ hexes mapped\) · Discovered Cold hearth \(abandoned camp\) · 8 hexes east$/, 'bearing from where you stand');
  assert.equal(turns.perform(game, { type: 'interact', at: hex(0, 1) }).reason, 'spent');
});

test('invalid interactions cost no turn and change nothing', () => {
  const { game, turns } = setup();
  const cases = [
    [{ type: 'interact' }, 'badTarget'],
    [{ type: 'interact', at: { q: 1.5, r: 0 } }, 'badTarget'],
    [{ type: 'interact', at: hex(-5, 0) }, 'outside'],
    [{ type: 'interact', at: hex(11, 2) }, 'unexplored'],
    [{ type: 'interact', at: hex(2, 1) }, 'noPoi'],
    [{ type: 'interact', at: hex(3, 0) }, 'tooFar'],
  ];
  const before = snapshot(game);
  for (const [action, reason] of cases) {
    const r = turns.perform(game, action);
    assert.equal(r.ok, false, JSON.stringify(action));
    assert.equal(r.reason, reason, JSON.stringify(action));
  }
  assert.equal(snapshot(game), before);
});

test('interact options: own hex first, then neighbours in direction order; used-up POIs drop out', () => {
  const { game, world, turns } = setup();
  world.setPoi(hex(0, 0), 'camp', 1, 'Underfoot camp');
  const opts = interactOptions(game);
  assert.deepEqual(opts.map((o) => [hexKey(o.at), o.direction]), [['0,0', null], ['1,0', 0], ['0,1', 5]]);
  assert.ok(opts.every((o) => hexDistance(o.at, game.player.position) <= INTERACT_REACH));
  turns.perform(game, { type: 'interact', at: hex(1, 0) });
  assert.deepEqual(interactOptions(game).map((o) => hexKey(o.at)), ['0,0', '0,1']);
});

test('a used POI stays used when you leave and come back, and survives a save round trip', () => {
  const { game, turns } = setup();
  turns.perform(game, { type: 'interact', at: hex(1, 0) });
  const path = [hex(1, 0), hex(2, 0), hex(3, 0), hex(4, 0), hex(5, 0), hex(4, 0), hex(3, 0), hex(2, 0), hex(1, 0)];
  for (const to of path) assert.equal(turns.perform(game, { type: 'move', to }).ok, true, hexKey(to));
  assert.equal(poiState(game, hex(1, 0)).left, 0);
  assert.equal(checkInteract(game, hex(1, 0)).reason, 'spent');
  assert.equal(interactOptions(game).some((o) => hexKey(o.at) === '1,0'), false, 'not offered');

  const back = restoreWorldChanges(JSON.parse(JSON.stringify(game.changes.serialize())));
  assert.equal(back.ok, true);
  assert.equal(back.changes.poiUsesTaken(hex(1, 0)), 1);
});

test('world changes: POI uses are counted per hex and validated on restore', () => {
  const c = createWorldChanges();
  c.recordPoiUse(hex(2, 3));
  c.recordPoiUse(hex(2, 3), 2);
  c.recordPoiUse(hex(-4, 1));
  assert.equal(c.poiUsesTaken(hex(2, 3)), 3);
  assert.equal(c.poiUsedCount, 2);
  assert.deepEqual(c.serialize(), { version: 2, gathered: [], pois: [[-4, 1, 1], [2, 3, 3]] });
  for (const bad of [{ version: 2, gathered: [], pois: [[1, 2, 0]] }, { version: 2, gathered: [], pois: [[1, 2, 1], [1, 2, 1]] }, { version: 2, gathered: [], pois: 'x' }]) {
    assert.equal(restoreWorldChanges(bad).ok, false, JSON.stringify(bad));
  }
  assert.throws(() => c.recordPoiUse(hex(0, 0), -1), RangeError);
});

// ---------------------------------------------------------------- journal

test('journal keeps only discoveries and POI uses, and round-trips', () => {
  const j = createJournal();
  j.record([
    { type: 'dayPart', turn: 12, day: 1, part: 'afternoon' },
    { type: 'discovered', at: hex(3, 0), poi: 'ruins', name: 'Broken chapel', from: hex(0, 0) },
    { type: 'gathered', at: hex(1, 0), kind: 'deadfall', resource: 'wood', amount: 2, left: 1, total: 2 },
  ], 5);
  j.record([{ type: 'interacted', at: hex(3, 0), poi: 'ruins', name: 'Broken chapel', use: 1, left: 2, found: { stone: 3 } }], 9);
  assert.deepEqual(j.entries.map((e) => [e.turn, e.type]), [[5, 'discovered'], [9, 'interacted']]);
  const saved = JSON.parse(JSON.stringify(j.serialize()));
  const back = restoreJournal(saved);
  assert.equal(back.ok, true);
  assert.deepEqual(back.journal.serialize(), j.serialize());
  for (const bad of [
    null, { version: 2, entries: [] }, { version: 1 }, { version: 1, entries: [5] },
    { version: 1, entries: [{ turn: 1, type: 'gathered', at: hex(0, 0), poi: 'x', name: 'y' }] },
    { version: 1, entries: [{ turn: 3, type: 'discovered', at: hex(0, 0), poi: 'x', name: 'y' }, { turn: 2, type: 'discovered', at: hex(0, 0), poi: 'x', name: 'y' }] },
    { version: 1, entries: [{ turn: 1, type: 'discovered', at: { q: 'a', r: 0 }, poi: 'x', name: 'y' }] },
  ]) assert.equal(restoreJournal(bad).ok, false, JSON.stringify(bad));
});

// ---------------------------------------------------------------- text

test('POI text: names, states, outcomes, bearings and buttons', () => {
  assert.equal(P.poiName('ruins', 'Broken chapel'), 'Broken chapel (ruins)');
  assert.equal(P.poiName('camp', 'Abandoned camp'), 'Abandoned camp', 'no repeated type');
  const state = (type, uses, left, name = 'X') => ({ poi: { type, name, uses }, def: POI_TYPES[type], left });
  assert.equal(P.describePoi(state('ruins', 3, 2, 'Sunken hall')), 'Sunken hall (ruins) · 2 searches left');
  assert.equal(P.describePoi(state('ruins', 3, 1, 'Sunken hall')), 'Sunken hall (ruins) · 1 search left');
  assert.equal(P.describePoi(state('ruins', 3, 0, 'Sunken hall')), 'Sunken hall (ruins) · searched');
  assert.equal(P.describePoi(state('chest', 1, 1, 'Mossy strongbox')), 'Mossy strongbox (chest) · not yet opened');
  assert.equal(P.describePoi(state('chest', 1, 0, 'Mossy strongbox')), 'Mossy strongbox (chest) · opened');
  assert.equal(P.describePoi(state('shrine', 1, 0, 'Wayshrine')), 'Wayshrine (shrine) · read');
  assert.equal(P.poiNote(null), '');

  // Bearings: each of the six directions, by screen sector.
  const names = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];
  [[2, 0], [2, -2], [0, -2], [-2, 0], [-2, 2], [0, 2]].forEach(([q, r], i) => {
    assert.equal(P.bearing(hex(0, 0), hex(q, r)), `2 hexes ${names[i]}`);
  });
  assert.equal(P.bearing(hex(0, 0), hex(1, 0)), '1 hex east');
  assert.equal(P.bearing(hex(4, 4), hex(4, 4)), 'here');

  assert.equal(P.describeFound({ herbs: 1, stone: 3 }), '3 stone, 1 herbs', 'fixed resource order');
  const searched = { type: 'interacted', at: hex(3, 0), poi: 'ruins', name: 'Broken chapel', use: 1, left: 2, found: { stone: 3 } };
  assert.equal(P.describeInteracted(searched), 'Searched Broken chapel (ruins): found 3 stone · 2 searches left');
  assert.equal(P.describeInteracted({ ...searched, poi: 'chest', name: 'Mossy strongbox', left: 0, found: { food: 3, herbs: 2 } }),
    'Opened Mossy strongbox (chest): found 2 herbs, 3 food');
  assert.equal(P.describeInteracted({ type: 'interacted', at: hex(0, 1), poi: 'shrine', name: 'Wayshrine', use: 1, left: 0, revealed: 0 }),
    'Read Wayshrine (shrine): the land around is already on your map');
  assert.equal(P.describeInteractRefused('spent', 'Forest · q 1, r 0'), 'Forest · q 1, r 0 · nothing more to find here');

  const btn = P.interactButton({ ...state('chest', 1, 1, 'Mossy strongbox'), direction: 1 });
  assert.deepEqual(btn, { text: 'Open chest', where: '↗', label: 'Open Mossy strongbox to the north-east (not yet opened)' });
  assert.equal(P.interactButton({ ...state('ruins', 2, 2, 'Sunken hall'), direction: null }).where, 'here');

  assert.equal(P.journalWhen(13), 'Day 1 · afternoon');
  assert.equal(P.journalText({ turn: 3, type: 'discovered', at: hex(3, -2), poi: 'cave', name: 'Dark hollow', from: hex(0, 0) }),
    'Discovered Dark hollow (cave) at q 3, r −2');
  assert.equal(P.describeJournalSummary([]), 'Nothing recorded yet. Explore to discover places.');
  assert.equal(P.describeJournalSummary([
    { type: 'discovered', at: hex(1, 0) }, { type: 'discovered', at: hex(3, 0) }, { type: 'interacted', at: hex(3, 0) }, { type: 'interacted', at: hex(3, 0) },
  ]), '2 places discovered · 1 explored');
});

test('every type has a button verb and readable states for each use count', () => {
  for (const id of POI_TYPE_IDS) {
    const def = POI_TYPES[id];
    for (let left = 0; left <= def.uses[1]; left++) {
      const text = P.describePoi({ poi: { type: id, name: def.names[0], uses: def.uses[1] }, def, left });
      assert.ok(!/undefined|NaN/.test(text), text);
    }
    assert.match(P.interactButton({ poi: { type: id, name: def.names[0], uses: 1 }, def, left: 1, direction: 0 }).text, /^(Search|Open|Read) \w+$/);
  }
});

test('the everwake start has a discovery in sight and POIs within a short walk', () => {
  const w = createWorld('everwake', 40);
  const game = createGame(w);
  assert.ok(game.journal.entries.length >= 1);
  assert.ok(new Set(w.pois.filter((p) => hexDistance(p, w.sanctuary) <= 12).map((p) => p.type)).size >= 3);
  // Nothing about unmapped POIs leaks: every journal entry is on a known hex.
  for (const e of game.journal.entries) assert.ok(game.memory.isKnown(e.at));
  assert.equal(hexesInRange(w.sanctuary, 4).filter((h) => w.poiAt(h)).length, game.journal.entries.length);
});
