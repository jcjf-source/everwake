import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexKey, hexCorners, hexesInRange, hexNeighbors } from '../src/world/hex.js';
import { createMapMemory, restoreMapMemory, canSee, FOG, SIGHT_RADIUS, MAP_MEMORY_VERSION } from '../src/world/mapMemory.js';
import { createWorld } from '../src/world/world.js';
import { createGame, createTurnSystem } from '../src/core/game.js';
import { planRoute } from '../src/systems/movement.js';
import { decideTap } from '../src/ui/moveIntent.js';
import * as text from '../src/ui/travelText.js';
import { fitView, hexToScreen, visibleHexes } from '../src/render/gridView.js';
import { drawGrid, REMEMBERED_VEIL, WALKED_DEBUG_FILL } from '../src/render/gridRenderer.js';
import { TERRAIN_PALETTE } from '../src/render/terrainStyle.js';
import { asciiWorld } from './helpers/asciiMap.js';
import { giveStride } from './helpers/stride.js';

const ORIGIN = hex(0, 0);
const keys = (hexes) => new Set(hexes.map(hexKey));

/** Every map hex (radius R) with its fog state. */
function states(memory, R) {
  const out = { [FOG.UNKNOWN]: [], [FOG.REMEMBERED]: [], [FOG.VISIBLE]: [] };
  for (const h of hexesInRange(ORIGIN, R)) out[memory.stateAt(h)].push(h);
  return out;
}

test('a new map memory knows nothing', () => {
  const m = createMapMemory(6);
  for (const h of hexesInRange(ORIGIN, 6)) assert.equal(m.stateAt(h), FOG.UNKNOWN);
  assert.equal(m.knownCount, 0);
  assert.equal(m.totalCount, 127);
  assert.deepEqual(m.knownHexes(), []);
  assert.throws(() => createMapMemory(-1), RangeError);
});

test('observe reveals exactly the hexes within sight radius (hex distance)', () => {
  const R = 12;
  for (const radius of [0, 1, 3, SIGHT_RADIUS]) {
    const m = createMapMemory(R);
    const at = hex(2, -1);
    const { revealed } = m.observe(at, radius);
    const s = states(m, R);
    assert.equal(revealed, 1 + 3 * radius * (radius + 1), `radius ${radius}: hexagon of hexes`);
    assert.equal(s[FOG.VISIBLE].length, revealed);
    assert.equal(s[FOG.REMEMBERED].length, 0);
    for (const h of s[FOG.VISIBLE]) assert.ok(hexDistance(h, at) <= radius, `${hexKey(h)} inside`);
    for (const h of s[FOG.UNKNOWN]) assert.ok(hexDistance(h, at) > radius, `${hexKey(h)} outside`);
    // The boundary itself: distance R is seen, distance R+1 is not.
    for (const h of hexesInRange(at, radius + 1)) {
      const d = hexDistance(h, at);
      if (d === radius) assert.ok(m.isVisible(h), `ring ${radius} visible`);
      if (d === radius + 1) assert.ok(!m.isKnown(h), `ring ${radius + 1} unknown`);
    }
  }
});

test('moving updates sight: new hexes revealed, old ones remembered, nothing forgotten', () => {
  const R = 12;
  const m = createMapMemory(R);
  const a = hex(0, 0);
  const b = hex(1, 0); // one step east
  m.observe(a);
  const first = keys(m.knownHexes());
  const { revealed } = m.observe(b);
  assert.equal(revealed, 2 * SIGHT_RADIUS + 1, 'one step reveals one new edge row of the hexagon');
  for (const h of hexesInRange(ORIGIN, R)) {
    const da = hexDistance(h, a);
    const db = hexDistance(h, b);
    const want = db <= SIGHT_RADIUS ? FOG.VISIBLE : da <= SIGHT_RADIUS ? FOG.REMEMBERED : FOG.UNKNOWN;
    assert.equal(m.stateAt(h), want, hexKey(h));
  }
  for (const k of first) assert.ok(keys(m.knownHexes()).has(k), 'explored terrain stays known');
  // Standing still reveals nothing new.
  assert.equal(m.observe(b).revealed, 0);
  assert.equal(m.knownCount, first.size + revealed);
});

test('sight is clipped at the map edge', () => {
  const R = 5;
  const m = createMapMemory(R);
  m.observe(hex(5, 0), 2);
  for (const h of m.knownHexes()) assert.ok(hexDistance(h, ORIGIN) <= R);
  assert.ok(!m.isKnown(hex(6, 0)) && m.stateAt(hex(6, 0)) === FOG.UNKNOWN, 'off-map hexes are never known');
  assert.equal(m.knownCount, m.knownHexes().length);
  assert.equal(m.stateAt(null), FOG.UNKNOWN);
  assert.equal(m.stateAt({ q: 0.5, r: 0 }), FOG.UNKNOWN);
});

test('landmarks stay shown once known; mobile entities only while visible', () => {
  const m = createMapMemory(10);
  m.observe(hex(0, 0));
  const near = hex(2, 0);
  const far = hex(9, 0);
  assert.ok(canSee(m, { at: near, kind: 'landmark' }));
  assert.ok(canSee(m, { at: near, kind: 'mobile' }));
  assert.ok(!canSee(m, { at: far, kind: 'landmark' }), 'unseen POI hidden');
  assert.ok(!canSee(m, { at: far, kind: 'mobile' }), 'unseen enemy hidden');
  m.observe(hex(8, 0)); // walk away: near is now remembered
  assert.equal(m.stateAt(near), FOG.REMEMBERED);
  assert.ok(canSee(m, { at: near, kind: 'landmark' }), 'a remembered landmark stays on the map');
  assert.ok(!canSee(m, { at: near, kind: 'mobile' }), 'an enemy on a remembered hex is not shown');
  assert.ok(canSee(m, { at: far, kind: 'mobile' }), 'now in sight');
});

test('serialize / restore round trip; malformed data rejected', () => {
  const R = 40;
  const m = createMapMemory(R);
  for (const at of [hex(0, 0), hex(3, -1), hex(-20, 10), hex(40, -40)]) m.observe(at);
  const saved = JSON.parse(JSON.stringify(m.serialize()));
  assert.equal(saved.version, MAP_MEMORY_VERSION);
  assert.equal(saved.radius, R);
  assert.ok(saved.known.length < 900, `compact: ${saved.known.length} chars`);
  const back = restoreMapMemory(saved, R);
  assert.ok(back.ok);
  assert.deepEqual(back.memory.knownHexes(), m.knownHexes());
  assert.equal(back.memory.knownCount, m.knownCount);
  for (const h of back.memory.knownHexes()) assert.equal(back.memory.stateAt(h), FOG.REMEMBERED, 'restored as remembered');
  back.memory.observe(hex(40, -40));
  assert.ok(back.memory.isVisible(hex(40, -40)));

  assert.equal(restoreMapMemory(null, R).ok, false);
  assert.equal(restoreMapMemory({ ...saved, version: 99 }, R).ok, false);
  assert.equal(restoreMapMemory(saved, 39).ok, false);
  assert.equal(restoreMapMemory({ ...saved, known: '###' }, R).ok, false);
  assert.equal(restoreMapMemory({ ...saved, known: 'AAAA' }, R).ok, false);
  const empty = restoreMapMemory(createMapMemory(R).serialize(), R);
  assert.ok(empty.ok && empty.memory.knownCount === 0);
});

// Routes and taps respect what the player knows.
const MAP = [
  'S . . . . G',
  '. M M M M .',
  '. . . . . .',
];

test('planRoute with knowledge: unmapped destinations and hexes are never used', () => {
  const { world, marks } = asciiWorld(MAP);
  const known = new Set(['0,0', '1,0', '2,0', '3,0', '0,1', '0,2', '1,2', '2,2']);
  const knows = (h) => known.has(hexKey(h));
  assert.deepEqual(planRoute(world, marks.S, marks.G, { knows }), { status: 'unexplored' });
  assert.deepEqual(planRoute(world, marks.S, hex(2, 1), { knows: () => true }), { status: 'impassable' });
  // An unmapped mountain is not reported as impassable: that would leak it.
  assert.deepEqual(planRoute(world, marks.S, hex(9, 9), { knows }), { status: 'outside' });
  const ok = planRoute(world, marks.S, hex(3, 0), { knows });
  assert.equal(ok.status, 'ok');
  for (const h of ok.path) assert.ok(knows(h), 'route stays on mapped hexes');
  // (2,2) is mapped and reachable only through mapped hexes along the bottom.
  const bottom = planRoute(world, marks.S, hex(2, 2), { knows });
  assert.equal(bottom.status, 'ok');
  // Known destination whose only routes cross unmapped land: unreachable.
  known.add('5,2');
  assert.deepEqual(planRoute(world, marks.S, hex(5, 2), { knows }), { status: 'unreachable' });
  assert.equal(planRoute(world, marks.S, hex(5, 2)).status, 'ok', 'without fog the route exists');
});

test('decideTap: unmapped hexes are explained, never routed to', () => {
  const { world, marks } = asciiWorld(MAP);
  const m = createMapMemory(10);
  m.observe(marks.S, 2);
  const idle = { position: marks.S, preview: null, travelling: null, knows: m.isKnown };
  assert.deepEqual(decideTap(world, idle, marks.G).action, { kind: 'unexplored', at: marks.G });
  assert.deepEqual(decideTap(world, idle, hex(4, 1)).action, { kind: 'unexplored', at: hex(4, 1) }, 'unmapped mountain is not named');
  assert.equal(decideTap(world, idle, hex(2, 0)).action.kind, 'preview');
  assert.equal(decideTap(world, idle, hex(1, 1)).action.kind, 'impassable', 'a mapped mountain is');
  assert.deepEqual(decideTap(world, idle, hex(1, 0)).action, { kind: 'step', to: hex(1, 0) });
  // While travelling, a tap on unmapped land stops, then explains.
  const moving = { ...idle, travelling: hex(2, 0) };
  assert.deepEqual(decideTap(world, moving, marks.G), { stop: true, action: { kind: 'unexplored', at: marks.G } });
  assert.equal(text.describeUnexplored(hex(3, -2)), 'Unexplored · q 3, r −2 · not on your map yet');
  assert.equal(text.describeExplored(61, 4921), '61 hexes mapped of 4921 · 1% explored');
  assert.equal(text.describeExplored(1, 7), '1 hex mapped of 7 · 14% explored');
});

test('exploring a generated world: start reveals only nearby hexes; walking reveals the path corridor', () => {
  const world = createWorld('everwake', 40);
  const game = giveStride(createGame(world));
  const { player, memory: m } = game;
  const turns = createTurnSystem();
  assert.deepEqual(keys(m.knownHexes()), keys(hexesInRange(world.sanctuary, SIGHT_RADIUS)), 'only nearby tiles at start');

  // Step to the edge of sight repeatedly, as the game does: one move action
  // per hex, and the turn pipeline updates visibility.
  const visited = [player.position];
  for (let leg = 0; leg < 4; leg++) {
    const target = m.knownHexes()
      .filter((h) => hexDistance(h, player.position) === SIGHT_RADIUS && world.isWalkable(h))
      .map((h) => ({ h, r: planRoute(world, player.position, h, { knows: m.isKnown }) }))
      .find((x) => x.r.status === 'ok');
    assert.ok(target, `leg ${leg}: a mapped target at the edge of sight`);
    for (const step of target.r.path) {
      assert.ok(m.isKnown(step), 'every route hex was already mapped');
      assert.ok(turns.perform(game, { type: 'move', to: step }).ok);
      visited.push(player.position);
    }
  }
  const expected = new Set();
  for (const p of visited) for (const h of hexesInRange(p, SIGHT_RADIUS)) if (world.has(h)) expected.add(hexKey(h));
  assert.deepEqual(keys(m.knownHexes()), expected, 'known = union of sight around every hex stood on');
  assert.ok(expected.size > 61);
  const vis = m.knownHexes().filter(m.isVisible);
  assert.deepEqual(keys(vis), keys(hexesInRange(player.position, SIGHT_RADIUS)), 'only the current neighbourhood is visible');
});

test('fitView frames every hex inside the box and caps hex size', () => {
  const hexes = hexesInRange(hex(5, -3), 4);
  for (const [w, h] of [[400, 300], [300, 500], [900, 400]]) {
    const v = fitView(hexes, w, h, { margin: 10, maxSize: 1000 });
    for (const hh of hexes) {
      const c = hexToScreen(v, hh);
      for (const p of hexCorners(c.x, c.y, v.size)) {
        assert.ok(p.x >= 10 - 1e-6 && p.x <= w - 10 + 1e-6 && p.y >= 10 - 1e-6 && p.y <= h - 10 + 1e-6, `${w}x${h} corner inside`);
      }
    }
  }
  assert.equal(fitView([hex(0, 0)], 400, 300, { maxSize: 10 }).size, 10, 'a single hex is not blown up');
  const centred = fitView([hex(3, 3)], 400, 300);
  const c = hexToScreen(centred, hex(3, 3));
  assert.ok(Math.abs(c.x - 200) < 1e-9 && Math.abs(c.y - 150) < 1e-9, 'centred');
});

/** A fake 2D context that records each fill: its style and the subpath start points. */
function recordingContext() {
  const fills = [];
  const gradients = [];
  let starts = [];
  const target = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    beginPath() { starts = []; },
    moveTo(x, y) { starts.push({ x, y }); },
    fill() { fills.push({ style: this.fillStyle, starts: starts.slice() }); },
    createRadialGradient(...args) { gradients.push(args); return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const ctx = new Proxy(target, {
    get(t, k) { return k in t ? t[k] : () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, fills, gradients };
}

test('renderer: unknown hexes are not drawn, remembered hexes are veiled, landmarks need knowledge', () => {
  const world = createWorld('everwake', 40);
  const m = createMapMemory(world.radius);
  const start = world.sanctuary;
  m.observe(start);
  // Walk 6 hexes away (as the crow flies) so the sanctuary becomes remembered.
  const away = hexesInRange(start, 6).find((h) => hexDistance(h, start) === 6 && world.isWalkable(h));
  m.observe(away);
  const width = 1200;
  const height = 900;
  const size = 10; // below detail size: plain fills only (no Path2D in Node)
  const centre = hexToScreen({ originX: 0, originY: 0, size }, start);
  const view = { originX: width / 2 - centre.x, originY: height / 2 - centre.y, size };
  const cells = visibleHexes(view, width, height, world.has);

  const draw = (sanctuary) => {
    const rec = recordingContext();
    drawGrid(rec.ctx, { width, height, view, cells, has: world.has, tileAt: world.tileAt, sanctuary, ui: { hovered: null, selected: null, showCoords: false }, fog: m });
    return rec;
  };
  const rec = draw(world.sanctuary);
  // Each hex subpath starts at its first corner: recover the hex centre from it.
  const inset = Math.max(0.5, Math.min(1.5, size * 0.03));
  const corner0 = hexCorners(0, 0, size - inset)[0];
  const centreKey = (p) => {
    const hit = cells.find((h) => { const c = hexToScreen(view, h); return Math.abs(c.x + corner0.x - p.x) < 1e-6 && Math.abs(c.y + corner0.y - p.y) < 1e-6; });
    return hit ? hexKey(hit) : null;
  };
  const terrainDrawn = new Set(rec.fills.filter((f) => TERRAIN_PALETTE.includes(f.style)).flatMap((f) => f.starts.map(centreKey)));
  const veiled = new Set(rec.fills.filter((f) => f.style === REMEMBERED_VEIL).flatMap((f) => f.starts.map(centreKey)));
  const onScreen = (s) => cells.filter((h) => m.stateAt(h) === s).map(hexKey);
  assert.deepEqual(terrainDrawn, new Set([...onScreen(FOG.VISIBLE), ...onScreen(FOG.REMEMBERED)]), 'terrain drawn for known hexes only');
  assert.deepEqual(veiled, new Set(onScreen(FOG.REMEMBERED)), 'veil over remembered hexes only');
  assert.ok(onScreen(FOG.UNKNOWN).length > 1000, 'most of the screen is still unknown');

  const sanctuaryGlow = (r) => r.gradients.some((g) => Math.abs(g[0] - width / 2) < 1e-6 && Math.abs(g[1] - height / 2) < 1e-6 && g[2] === 0);
  assert.ok(sanctuaryGlow(rec), 'remembered sanctuary still drawn (landmark)');
  const unseen = hexesInRange(start, 30).find((h) => world.has(h) && !m.isKnown(h) && Math.abs(hexToScreen(view, h).x - width / 2) < 300 && Math.abs(hexToScreen(view, h).y - height / 2) < 300);
  const recHidden = draw(unseen);
  const hc = hexToScreen(view, unseen);
  assert.ok(!recHidden.gradients.some((g) => Math.abs(g[0] - hc.x) < 1e-6 && Math.abs(g[1] - hc.y) < 1e-6), 'a landmark on an unknown hex is not drawn');
});

test('fog edge: clouds go on unknown hexes bordering the map, and one ring beyond', async () => {
  const { fogFrontier } = await import('../src/render/fogArt.js');
  const R = 12;
  const m = createMapMemory(R);
  m.observe(hex(0, 0), 2);
  const cells = hexesInRange(ORIGIN, R);
  const { edge, outer } = fogFrontier(cells, m.stateAt);
  assert.deepEqual(keys(edge.map((e) => e.hex)), keys(cells.filter((h) => hexDistance(h, ORIGIN) === 3)), 'edge = first unknown ring');
  assert.deepEqual(keys(outer), keys(cells.filter((h) => hexDistance(h, ORIGIN) === 4)), 'outer = the ring after it');
  for (const e of edge) {
    assert.ok(e.known >= 1 && e.known <= 2, 'each edge hex touches 1-2 known hexes on a hexagonal reveal');
    // The summed direction points back toward the mapped area.
    const toward = { q: e.hex.q + Math.sign(e.dq), r: e.hex.r + Math.sign(e.dr) };
    assert.ok(hexDistance(toward, ORIGIN) < hexDistance(e.hex, ORIGIN) || e.known === 2, `direction for ${hexKey(e.hex)}`);
  }
  // Nothing known: no clouds anywhere. Everything known: none either.
  assert.deepEqual(fogFrontier(cells, createMapMemory(R).stateAt), { edge: [], outer: [] });
  assert.deepEqual(fogFrontier(cells, () => FOG.VISIBLE), { edge: [], outer: [] });
});

// ---------------------------------------------------------------- walked ground (G01)

/** Small deterministic generator for the fuzz tests. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('walked ground: seeing is not walking; only known map hexes can be walked', () => {
  const R = 8;
  const m = createMapMemory(R);
  assert.equal(m.walkedCount(), 0);
  assert.deepEqual(m.walkedHexes(), []);
  assert.equal(m.markWalked(hex(1, 1)), false, 'an unknown hex cannot be walked');
  m.observe(hex(0, 0), 3);
  m.reveal(hex(5, -2), 1);
  for (const h of hexesInRange(ORIGIN, R)) assert.equal(m.isWalked(h), false, 'observe and reveal walk nothing');
  assert.equal(m.markWalked(hex(0, 0)), true);
  assert.equal(m.markWalked(hex(0, 0)), false, 'a second visit is not new');
  assert.equal(m.markWalked(hex(5, -2)), true, 'remembered ground can be walked');
  assert.equal(m.markWalked(hex(R + 1, 0)), false, 'off the map');
  assert.equal(m.markWalked(null), false);
  assert.equal(m.isWalked(hex(R + 1, 0)), false);
  assert.equal(m.walkedCount(), 2);
  assert.deepEqual(m.walkedHexes(), [hex(5, -2), hex(0, 0)], 'row by row');
  // Walking changes no fog state.
  assert.equal(m.stateAt(hex(5, -2)), FOG.REMEMBERED);
  assert.equal(m.knownCount, hexesInRange(ORIGIN, 3).length + 7);
});

test('walked ground: version 2 round trip; version 1 loads with nothing walked; malformed walked data rejected', () => {
  const R = 40;
  const m = createMapMemory(R);
  for (const at of [hex(0, 0), hex(3, -1), hex(-20, 10), hex(40, -40)]) { m.observe(at); m.markWalked(at); }
  m.markWalked(hex(1, 0));
  const saved = JSON.parse(JSON.stringify(m.serialize()));
  assert.equal(saved.version, 2);
  assert.ok(saved.walked.length < 900, `compact: ${saved.walked.length} chars`);
  const back = restoreMapMemory(saved, R);
  assert.ok(back.ok, back.error);
  assert.equal(back.version, 2);
  assert.deepEqual(back.memory.walkedHexes(), m.walkedHexes());
  assert.equal(back.memory.walkedCount(), 5);
  assert.deepEqual(back.memory.knownHexes(), m.knownHexes());

  const v1 = { version: 1, radius: R, known: saved.known };
  const old = restoreMapMemory(v1, R);
  assert.ok(old.ok, old.error);
  assert.equal(old.version, 1);
  assert.equal(old.memory.walkedCount(), 0);
  assert.deepEqual(old.memory.knownHexes(), m.knownHexes());

  const reject = (data, pattern) => {
    const r = restoreMapMemory(data, R);
    assert.equal(r.ok, false, JSON.stringify(data).slice(0, 80));
    assert.match(r.error, pattern);
  };
  reject({ ...saved, walked: undefined }, /walked ground/);
  reject({ ...saved, walked: '###' }, /walked ground is not valid base64/);
  reject({ ...saved, walked: 'AAAA' }, /walked ground has the wrong length/);
  reject({ ...saved, version: 3 }, /unsupported/);
  // A walked hex that is not known.
  const ghost = createMapMemory(R);
  ghost.observe(hex(0, 0), 0);
  ghost.markWalked(hex(0, 0));
  reject({ ...saved, walked: ghost.serialize().walked, known: createMapMemory(R).serialize().known }, /not on the map/);
});

test('walked ground fuzz: random walks round-trip exactly; scrambled walked bits never load with a walked hex unknown', () => {
  const R = 12;
  const rand = lcg(1234);
  for (let trial = 0; trial < 40; trial++) {
    const m = createMapMemory(R);
    const all = hexesInRange(ORIGIN, R);
    for (let i = 0; i < 1 + Math.floor(rand() * 30); i++) {
      const at = all[Math.floor(rand() * all.length)];
      m.observe(at, Math.floor(rand() * 4));
      if (rand() < 0.7) m.markWalked(at);
    }
    for (const h of m.walkedHexes()) assert.ok(m.isKnown(h), 'walked is always known');
    const saved = JSON.parse(JSON.stringify(m.serialize()));
    const back = restoreMapMemory(saved, R);
    assert.ok(back.ok, back.error);
    assert.deepEqual(back.memory.walkedHexes(), m.walkedHexes());
    assert.equal(back.memory.walkedCount(), m.walkedCount());

    // Flip random bits of the walked set: either refused, or every walked hex known.
    const bytes = Uint8Array.from(atob(saved.walked), (c) => c.charCodeAt(0));
    for (let k = 0; k < 3; k++) bytes[Math.floor(rand() * bytes.length)] ^= 1 << Math.floor(rand() * 8);
    const flipped = { ...saved, walked: btoa(String.fromCharCode(...bytes)) };
    const r = restoreMapMemory(flipped, R);
    if (r.ok) for (const h of r.memory.walkedHexes()) assert.ok(r.memory.isKnown(h));
    else assert.match(r.error, /walked ground/);
  }
});

test('walked ground in play: a route marks exactly the hexes entered (and the start), never what was only seen', () => {
  const world = createWorld('everwake', 40);
  const game = giveStride(createGame(world));
  const { memory: m } = game;
  const turns = createTurnSystem();
  assert.deepEqual(m.walkedHexes(), [world.sanctuary], 'the start is walked');
  const entered = [world.sanctuary];
  for (let leg = 0; leg < 3; leg++) {
    const target = m.knownHexes()
      .filter((h) => hexDistance(h, game.player.position) === SIGHT_RADIUS && world.isWalkable(h))
      .map((h) => planRoute(world, game.player.position, h, { knows: m.isKnown }))
      .find((r) => r.status === 'ok');
    assert.ok(target, `leg ${leg}`);
    for (const step of target.path) {
      assert.ok(turns.perform(game, { type: 'move', to: step }).ok);
      entered.push(step);
    }
  }
  assert.ok(turns.perform(game, { type: 'wait' }).ok, 'standing still walks nothing new');
  assert.deepEqual(keys(m.walkedHexes()), keys(entered));
  assert.equal(m.walkedCount(), keys(entered).size);
  assert.ok(m.knownCount > 4 * m.walkedCount(), 'far more seen than walked');
  // A refused move marks nothing.
  const before = m.walkedCount();
  assert.equal(turns.perform(game, { type: 'move', to: hex(99, 0) }).ok, false);
  assert.equal(m.walkedCount(), before);
});

test('renderer: walked footprints are drawn only when asked (debug), on walked known hexes', () => {
  const world = createWorld('everwake', 40);
  const game = createGame(world);
  const m = game.memory;
  const step = hexNeighbors(world.sanctuary).find(world.isWalkable);
  assert.ok(createTurnSystem().perform(game, { type: 'move', to: step }).ok);
  const width = 800;
  const height = 600;
  const size = 10;
  const centre = hexToScreen({ originX: 0, originY: 0, size }, world.sanctuary);
  const view = { originX: width / 2 - centre.x, originY: height / 2 - centre.y, size };
  const cells = visibleHexes(view, width, height, world.has);
  const base = { width, height, view, cells, has: world.has, tileAt: world.tileAt, sanctuary: world.sanctuary, ui: { hovered: null, selected: null, showCoords: false }, fog: m };
  const footprints = (frame) => {
    const rec = recordingContext();
    drawGrid(rec.ctx, frame);
    return rec.fills.filter((f) => f.style === WALKED_DEBUG_FILL).flatMap((f) => f.starts);
  };
  assert.equal(footprints(base).length, 0, 'off by default');
  assert.equal(footprints({ ...base, walked: null }).length, 0);
  assert.equal(footprints({ ...base, walked: m.isWalked }).length, 4, 'two prints on each of the two walked hexes');
});
