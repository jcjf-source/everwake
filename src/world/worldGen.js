/**
 * Deterministic terrain generation.
 *
 * `createTerrainGenerator(seedNumber).tileAt(q, r)` is a pure function of the
 * seed and the coordinate: it samples continuous noise fields at the hex's
 * position, so generation order, draw order, map size, and chunking never
 * change a tile. Layers, in order:
 *   1. elevation: broad fractal noise plus ridged noise in masked bands
 *      (mountain ridges with hills and rocky ground on their flanks);
 *   2. water: low elevation becomes lakes (deep, then shallow margins), and
 *      rivers follow the zero contour of a separate noise field. The contour
 *      is marked on the negative side wherever a neighbour is positive, which
 *      makes each river a connected, one-hex-wide line on the hex grid;
 *   3. moisture: its own noise, wetter near rivers and on low ground;
 *   4. classification into terrain ids from src/data/terrain.js;
 *   5. local rules that read only the neighbours' *raw* (layers 1–4) values,
 *      so they stay order-independent: a tile matching none of its six
 *      neighbours takes the most common neighbouring terrain (no speckles);
 *      deep water next to land becomes a shallow margin; and a river hex
 *      with no water neighbour (a clipped stub) reverts to its ground.
 */
import { createRng } from '../core/rng.js';
import { createNoise2D, fbm } from './noise.js';
import { DIRECTIONS } from './hex.js';

/** Bump when generation output changes, so saves can detect old worlds. */
export const GENERATOR_VERSION = 1;

// Thresholds (elevation is roughly 0..1).
const DEEP = 0.315;
const SHALLOW = 0.36;
const BEACH = 0.39;
const HILLS = 0.6;
const ROCKY = 0.68;
const MOUNTAIN = 0.73;
const RIVER_MAX_ELEVATION = MOUNTAIN; // rivers run through hills and rise at the peaks

const SQRT3 = Math.sqrt(3);

/** Unit-size pointy-top hex centre (one hex ≈ 1.7 units across). */
function samplePoint(q, r) {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/**
 * @typedef {{ q: number, r: number, terrain: string, elevation: number, moisture: number, river: boolean }} Tile
 */

export function createTerrainGenerator(seedNumber) {
  // Per-layer seeds come from a sequential PRNG in a fixed order.
  const rng = createRng(seedNumber);
  const elevationNoise = createNoise2D(rng.nextUint32());
  const ridgeNoise = createNoise2D(rng.nextUint32());
  const ridgeMaskNoise = createNoise2D(rng.nextUint32());
  const moistureNoise = createNoise2D(rng.nextUint32());
  const riverNoise = createNoise2D(rng.nextUint32());
  const detailNoise = createNoise2D(rng.nextUint32());

  // Memo of raw classifications. Purely a speed-up: every value is a pure
  // function of (seed, q, r), so the cache can never change a result.
  const rawCache = new Map();

  function elevationAt(x, y) {
    const base = fbm(elevationNoise, x / 34, y / 34, 4) * 0.5 + 0.5;
    const ridge = 1 - Math.abs(fbm(ridgeNoise, x / 26, y / 26, 3));
    const mask = smoothstep(-0.05, 0.35, fbm(ridgeMaskNoise, x / 60, y / 60, 2));
    return base * 0.85 + Math.pow(ridge, 4) * mask * 0.48;
  }

  const riverAt = (x, y) => fbm(riverNoise, x / 64, y / 64, 3);

  function isRiver(q, r, here, e) {
    if (e >= RIVER_MAX_ELEVATION || e < SHALLOW || here >= 0) return false;
    for (const d of DIRECTIONS) {
      const p = samplePoint(q + d.q, r + d.r);
      if (riverAt(p.x, p.y) >= 0) return true;
    }
    return false;
  }

  /** Layers 1–4 for one coordinate. @returns {Tile} */
  function rawTile(q, r) {
    const key = `${q},${r}`;
    const cached = rawCache.get(key);
    if (cached) return cached;

    const { x, y } = samplePoint(q, r);
    const e = elevationAt(x, y);
    const riverValue = riverAt(x, y);
    const nearRiver = 1 - smoothstep(0, 0.1, Math.abs(riverValue));
    const m = clamp01(
      fbm(moistureNoise, x / 22, y / 22, 3) * 0.5 + 0.5
      + nearRiver * 0.15
      + (0.5 - e) * 0.25,
    );
    const detail = fbm(detailNoise, x / 6, y / 6, 2) * 0.06; // softens band edges
    const river = isRiver(q, r, riverValue, e);

    // What the tile would be without a river (used if a river stub is dropped).
    let ground;
    if (e < DEEP) ground = 'deepWater';
    else if (e < SHALLOW) ground = 'shallowWater';
    else if (e >= MOUNTAIN) ground = 'mountains';
    else if (e >= ROCKY + detail) ground = m > 0.55 ? 'hills' : 'rocky';
    else if (e >= HILLS + detail) ground = m < 0.32 ? 'rocky' : 'hills';
    else if (e < BEACH + detail * 0.5) ground = 'sand';
    else if (m + detail > 0.68) ground = 'denseForest';
    else if (m + detail > 0.54) ground = 'forest';
    else if (m + detail < 0.2) ground = 'sand'; // dry scrub
    else ground = 'grassland';
    const terrain = river ? 'shallowWater' : ground;

    const tile = Object.freeze({ q, r, terrain, ground, elevation: e, moisture: m, river });
    rawCache.set(key, tile);
    return tile;
  }

  /**
   * Final tile: layer 5 rules, each reading only raw neighbour values.
   * @returns {Tile}
   */
  function tileAt(q, r) {
    const raw = rawTile(q, r);
    const neighbours = DIRECTIONS.map((d) => rawTile(q + d.q, r + d.r));
    const { elevation, moisture } = raw;
    const out = (terrain, river) => Object.freeze({ q, r, terrain, elevation, moisture, river });

    if (raw.river) {
      // Rivers are deliberately one hex wide; keep them unless cut off
      // (a stub where the channel was clipped by high or low ground).
      if (neighbours.some((n) => isWater(n.terrain))) return out('shallowWater', true);
      return out(raw.ground, false);
    }

    let terrain = raw.terrain;
    // No same-terrain neighbour: take the most common neighbouring terrain
    // (ties broken by DIRECTIONS order, so the result is stable).
    if (!neighbours.some((n) => n.terrain === terrain)) {
      const counts = new Map();
      for (const n of neighbours) counts.set(n.terrain, (counts.get(n.terrain) ?? 0) + 1);
      let bestCount = 0;
      for (const [t, c] of counts) if (c > bestCount) { terrain = t; bestCount = c; }
    }
    // Deep water always has a shallow margin before land.
    if (terrain === 'deepWater' && neighbours.some((n) => !isWater(n.terrain))) terrain = 'shallowWater';
    return out(terrain, false);
  }

  return { tileAt };
}

function isWater(terrain) {
  return terrain === 'deepWater' || terrain === 'shallowWater';
}

function smoothstep(a, b, t) {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
