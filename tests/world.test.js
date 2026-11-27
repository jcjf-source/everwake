import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashInts, hashString, toUnit } from '../src/core/rng.js';
import { createNoise2D, fbm } from '../src/world/noise.js';
import { normalizeSeed, randomSeed, seedToNumber, MAX_SEED_LENGTH } from '../src/world/seed.js';
import { createTerrainGenerator, GENERATOR_VERSION } from '../src/world/worldGen.js';
import { createWorld, floodWalkable } from '../src/world/world.js';
import { TERRAIN, TERRAIN_IDS, RESOURCE_KINDS, validateTerrainDef } from '../src/data/terrain.js';
import { hex, hexDistance, hexNeighbors, hexesInRange } from '../src/world/hex.js';

const R = 40;
const SEEDS = Array.from({ length: 24 }, (_, i) => `test-seed-${i}`);
const worlds = new Map();
/** Cached world per seed (generation is deterministic, so sharing is safe). */
function worldFor(seed, radius = R) {
  const key = `${seed}|${radius}`;
  if (!worlds.has(key)) worlds.set(key, createWorld(seed, radius));
  return worlds.get(key);
}
const terrainString = (w) => w.cells.map((h) => w.tileAt(h).terrain).join(',');
const isWater = (t) => t === 'deepWater' || t === 'shallowWater';

// ---------------------------------------------------------------- PRNG ----

test('rng: same seed gives the same sequence, different seeds differ', () => {
  const a = createRng(123);
  const b = createRng(123);
  const c = createRng(124);
  const seqA = Array.from({ length: 50 }, () => a.nextUint32());
  const seqB = Array.from({ length: 50 }, () => b.nextUint32());
  const seqC = Array.from({ length: 50 }, () => c.nextUint32());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test('rng: floats in [0,1), ints in range, roughly uniform', () => {
  const rng = createRng(7);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
    bins[Math.floor(v * 10)]++;
    const n = rng.int(-3, 3);
    assert.ok(Number.isInteger(n) && n >= -3 && n <= 3);
  }
  for (const b of bins) assert.ok(b > 1700 && b < 2300, `bin count ${b}`);
});

test('coordinate hash is stateless, seed-dependent, and well spread', () => {
  assert.equal(hashInts(1, 5, -7, 2), hashInts(1, 5, -7, 2));
  assert.notEqual(hashInts(1, 5, -7), hashInts(2, 5, -7));
  assert.notEqual(hashInts(1, 5, -7), hashInts(1, -7, 5));
  const seen = new Set();
  for (let q = -30; q <= 30; q++) for (let r = -30; r <= 30; r++) seen.add(hashInts(99, q, r));
  assert.equal(seen.size, 61 * 61, 'no collisions in a small block');
  assert.ok(toUnit(0xffffffff) < 1);
  assert.equal(hashString('everwake'), hashString('everwake'));
  assert.notEqual(hashString('everwake'), hashString('Everwake'));
});

test('noise: deterministic, bounded, and continuous', () => {
  const n1 = createNoise2D(42);
  const n2 = createNoise2D(42);
  const n3 = createNoise2D(43);
  let differs = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (i * 0.731) % 50 - 25;
    const y = (i * 1.379) % 50 - 25;
    const v = n1(x, y);
    assert.equal(v, n2(x, y));
    assert.ok(v >= -1.0001 && v <= 1.0001, `noise ${v}`);
    if (Math.abs(v - n3(x, y)) > 1e-9) differs++;
    // Small step → small change (spatial coherence, no speckle).
    assert.ok(Math.abs(n1(x + 0.01, y) - v) < 0.05);
    const f = fbm(n1, x, y, 4);
    assert.ok(f >= -1.0001 && f <= 1.0001);
  }
  assert.ok(differs > 1900, 'a different seed gives different noise');
});

// ---------------------------------------------------------------- seeds ---

test('seed normalisation and validation', () => {
  assert.deepEqual(normalizeSeed('  misty   tarn  '), { ok: true, seed: 'misty tarn' });
  assert.deepEqual(normalizeSeed('Ash-Vale_2.0'), { ok: true, seed: 'Ash-Vale_2.0' });
  assert.deepEqual(normalizeSeed('Ödmark 7'), { ok: true, seed: 'Ödmark 7' });
  assert.equal(normalizeSeed('').ok, false);
  assert.equal(normalizeSeed('   ').ok, false);
  assert.equal(normalizeSeed('x'.repeat(MAX_SEED_LENGTH)).ok, true);
  assert.equal(normalizeSeed('x'.repeat(MAX_SEED_LENGTH + 1)).ok, false);
  assert.equal(normalizeSeed('<script>').ok, false);
  assert.equal(normalizeSeed(42).ok, false);
  assert.equal(seedToNumber('abc'), seedToNumber('abc'));
});

test('random seeds are valid, memorable, and vary', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = randomSeed();
    assert.match(s, /^[a-z]+-[a-z]+-\d{3}$/);
    assert.equal(normalizeSeed(s).ok, true);
    seen.add(s);
  }
  assert.ok(seen.size > 150);
  // Injectable entropy makes it deterministic for tests.
  assert.equal(randomSeed(() => 0), randomSeed(() => 0));
});

// ---------------------------------------------------- terrain definitions -

test('every terrain definition is valid', () => {
  assert.equal(TERRAIN_IDS.length, 9);
  for (const id of TERRAIN_IDS) {
    const def = TERRAIN[id];
    assert.equal(def.id, id);
    assert.deepEqual(validateTerrainDef(def), [], id);
    assert.ok(Object.isFrozen(def) && Object.isFrozen(def.resources));
    assert.deepEqual(Object.keys(def.resources).sort(), [...RESOURCE_KINDS].sort());
  }
  // Sanity of the design intent.
  assert.equal(TERRAIN.deepWater.walkable, false);
  assert.equal(TERRAIN.mountains.walkable, false);
  assert.equal(TERRAIN.grassland.moveCost, 1);
  assert.ok(TERRAIN.denseForest.moveCost > TERRAIN.forest.moveCost);
  assert.ok(TERRAIN.hills.sightModifier > 0 && TERRAIN.forest.sightModifier < 0);
  assert.ok(TERRAIN.forest.resources.wood > TERRAIN.grassland.resources.wood);
  assert.ok(TERRAIN.rocky.resources.stone > TERRAIN.grassland.resources.stone);
});

test('the validator rejects bad definitions', () => {
  const good = TERRAIN.grassland;
  assert.ok(validateTerrainDef({ ...good, moveCost: 0 }).length > 0);
  assert.ok(validateTerrainDef({ ...good, moveCost: 1.5 }).length > 0);
  assert.ok(validateTerrainDef({ ...good, walkable: false }).length > 0, 'unwalkable needs Infinity cost');
  assert.ok(validateTerrainDef({ ...good, resources: { ...good.resources, wood: 2 } }).length > 0);
  assert.ok(validateTerrainDef({ ...good, resources: { wood: 1 } }).length > 0);
  assert.ok(validateTerrainDef({ ...good, sightModifier: 0.5 }).length > 0);
});

test('every generated tile has a valid terrain and finite fields', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    const w = worldFor(seed);
    for (const h of w.cells) {
      const t = w.tileAt(h);
      assert.ok(TERRAIN[t.terrain], `${seed} ${h.q},${h.r}: ${t.terrain}`);
      assert.equal(t.q, h.q);
      assert.equal(t.r, h.r);
      assert.ok(Number.isFinite(t.elevation) && t.elevation >= 0 && t.elevation <= 1.5);
      assert.ok(Number.isFinite(t.moisture) && t.moisture >= 0 && t.moisture <= 1);
      assert.equal(typeof t.river, 'boolean');
      if (t.river) assert.equal(t.terrain, 'shallowWater');
    }
    assert.equal(w.tileAt(hex(R + 1, 0)), null, 'outside the map is null');
  }
});

// ---------------------------------------------------------- determinism ---

test('same seed yields the same map', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const a = createWorld(seed, R);
    const b = createWorld(seed, R);
    assert.equal(terrainString(a), terrainString(b));
    assert.deepEqual(a.sanctuary, b.sanctuary);
    for (const h of a.cells) assert.deepEqual(a.tileAt(h), b.tileAt(h));
  }
});

test('generation is independent of order and map size (chunk-ready)', () => {
  const seedNumber = seedToNumber('order-check');
  const coords = hexesInRange(hex(0, 0), 15);
  const forward = createTerrainGenerator(seedNumber);
  const expected = coords.map((h) => forward.tileAt(h.q, h.r));

  const backward = createTerrainGenerator(seedNumber);
  const reversed = [...coords].reverse().map((h) => backward.tileAt(h.q, h.r)).reverse();
  assert.deepEqual(reversed, expected);

  // Shuffled with a seeded PRNG, on a fresh generator.
  const rng = createRng(5);
  const order = coords.map((h, i) => [rng.next(), i]).sort((x, y) => x[0] - y[0]).map(([, i]) => i);
  const shuffledGen = createTerrainGenerator(seedNumber);
  const shuffled = new Array(coords.length);
  for (const i of order) shuffled[i] = shuffledGen.tileAt(coords[i].q, coords[i].r);
  assert.deepEqual(shuffled, expected);

  // A tile is the same whether the map is small or large, and far-away
  // coordinates (a future chunk) generate without a map at all.
  const small = createWorld('order-check', 10);
  const large = createWorld('order-check', R);
  for (const h of small.cells) assert.deepEqual(small.tileAt(h), large.tileAt(h));
  const far = createTerrainGenerator(seedNumber).tileAt(1000, -2500);
  assert.deepEqual(far, createTerrainGenerator(seedNumber).tileAt(1000, -2500));
  assert.ok(TERRAIN[far.terrain]);
});

test('golden fingerprint (bump GENERATOR_VERSION if this changes on purpose)', () => {
  const w = createWorld('everwake', R);
  const sig = hashString(w.cells.map((h) => w.tileAt(h).terrain[0] + w.tileAt(h).terrain.length).join(''));
  assert.equal(GENERATOR_VERSION, 1);
  assert.equal(sig, 3479629727);
  assert.deepEqual(w.sanctuary, hex(-1, 1));
});

test('different seeds noticeably differ', () => {
  for (let i = 0; i < 8; i++) {
    const a = worldFor(SEEDS[i]);
    const b = worldFor(SEEDS[i + 1]);
    let diff = 0;
    for (const h of a.cells) if (a.tileAt(h).terrain !== b.tileAt(h).terrain) diff++;
    assert.ok(diff / a.cells.length > 0.4, `${SEEDS[i]} vs ${SEEDS[i + 1]}: only ${diff} tiles differ`);
  }
});

// --------------------------------------------------------- plausibility ---

test('terrain is coherent: no speckles, sensible mix, plausible transitions', () => {
  const totals = Object.fromEntries(TERRAIN_IDS.map((id) => [id, 0]));
  let cells = 0;
  for (const seed of SEEDS) {
    const w = worldFor(seed);
    let speckles = 0;
    let deepPairs = 0;
    let deepLand = 0;
    let peakPairs = 0;
    let peakLowland = 0;
    const counts = {};
    for (const h of w.cells) {
      const t = w.tileAt(h).terrain;
      counts[t] = (counts[t] ?? 0) + 1;
      totals[t]++;
      cells++;
      let same = false;
      for (const n of hexNeighbors(h)) {
        const u = w.tileAt(n);
        if (!u) continue;
        if (u.terrain === t) same = true;
        if (t === 'deepWater') { deepPairs++; if (!isWater(u.terrain)) deepLand++; }
        if (t === 'mountains') {
          peakPairs++;
          if (isWater(u.terrain) || ['grassland', 'sand', 'forest', 'denseForest'].includes(u.terrain)) peakLowland++;
        }
      }
      if (!same) speckles++;
    }
    assert.ok(speckles / w.cells.length < 0.01, `${seed}: ${speckles} isolated tiles`);
    assert.ok(deepPairs === 0 || deepLand / deepPairs < 0.01, `${seed}: deep water touches land too often`);
    assert.ok(peakPairs === 0 || peakLowland / peakPairs < 0.1, `${seed}: mountains rise straight out of lowland`);
    const water = (counts.deepWater ?? 0) + (counts.shallowWater ?? 0);
    assert.ok(water / w.cells.length > 0.03 && water / w.cells.length < 0.4, `${seed}: water share`);
    const walkable = w.cells.filter(w.isWalkable).length;
    assert.ok(walkable / w.cells.length > 0.6, `${seed}: mostly explorable`);
  }
  // Across seeds every terrain occurs and none dominates.
  for (const id of TERRAIN_IDS) {
    const share = totals[id] / cells;
    assert.ok(share > 0.01 && share < 0.5, `${id} share ${share.toFixed(3)}`);
  }
});

test('water forms connected bodies and rivers are continuous', () => {
  for (const seed of SEEDS.slice(0, 12)) {
    const w = worldFor(seed);
    const water = new Set(w.cells.filter((h) => isWater(w.tileAt(h).terrain)).map((h) => `${h.q},${h.r}`));
    const seen = new Set();
    let tiny = 0;
    for (const k of water) {
      if (seen.has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      const stack = [hex(q, r)];
      seen.add(k);
      let size = 0;
      let clipped = false; // touches the map edge, so it continues off-map
      while (stack.length) {
        const h = stack.pop();
        size++;
        if (hexDistance(h, hex(0, 0)) === R) clipped = true;
        for (const n of hexNeighbors(h)) {
          const nk = `${n.q},${n.r}`;
          if (water.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(n); }
        }
      }
      if (size <= 2 && !clipped) tiny++;
    }
    assert.ok(tiny <= 3, `${seed}: ${tiny} ponds of 1–2 hexes`);
    let rivers = 0;
    let cutOff = 0;
    for (const h of w.cells) {
      const t = w.tileAt(h);
      if (!t.river) continue;
      rivers++;
      if (!hexNeighbors(h).some((n) => w.tileAt(n) && isWater(w.tileAt(n).terrain))) cutOff++;
    }
    assert.ok(cutOff <= Math.max(1, rivers * 0.01), `${seed}: ${cutOff}/${rivers} river hexes cut off`);
  }
});

// ----------------------------------------------------------- sanctuary ----

test('sanctuary is safe, accessible, central, and deterministic', () => {
  for (const seed of SEEDS) {
    const w = worldFor(seed);
    const s = w.sanctuary;
    assert.ok(w.has(s), `${seed}: sanctuary on the map`);
    assert.equal(w.tileAt(s).terrain, 'grassland', `${seed}: sanctuary on open ground`);
    assert.ok(hexNeighbors(s).every(w.isWalkable), `${seed}: every neighbour walkable`);
    assert.ok(hexDistance(s, hex(0, 0)) <= Math.floor(R * 0.75), `${seed}: away from the map edge`);
    const reachable = floodWalkable(s, w.isWalkable).length;
    assert.equal(reachable, w.reachableFromSanctuary);
    const walkable = w.cells.filter(w.isWalkable).length;
    assert.ok(reachable / walkable > 0.8, `${seed}: sanctuary reaches ${reachable}/${walkable} walkable hexes`);
    assert.deepEqual(createWorld(seed, R).sanctuary, s);
  }
});

test('floodWalkable stays within walkable hexes', () => {
  const walk = (h) => hexDistance(h, hex(0, 0)) <= 2 && !(h.q === 1 && h.r === 0);
  const region = floodWalkable(hex(0, 0), walk);
  assert.equal(region.length, 18);
  assert.ok(region.every(walk));
});
