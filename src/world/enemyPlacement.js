/**
 * Enemy spawn placement: part of the generated *world definition* (where
 * each enemy lives). Where enemies are now, and their health, is live game
 * state (src/systems/enemies.js), never stored here.
 *
 * Two kinds of spawn, both from hashes of (seed, coordinates) only, so the
 * result does not depend on generation order and works per chunk later:
 *  - roaming beasts: the plane is divided into axial cells of CELL × CELL
 *    hexes; a cell may hold one, at the best of a few sampled hexes in its
 *    interior, as the archetype whose habitat suits that terrain best
 *    (wolves in woods and hills, boars in grassland and forest);
 *  - ruin guards: a skeleton beside most ruins (POIs, poiPlacement.js).
 * Spawns sit on walkable dry land, never on a POI, and at least CLEARANCE
 * hexes from the sanctuary, so nothing notices you at the start. Sampling
 * only a cell's interior keeps beasts from neighbouring cells apart, and a
 * beast within GUARD_SPACING of a ruin guard is dropped.
 */
import { ENEMY_TYPES, ENEMY_TYPE_IDS } from '../data/enemies.js';
import { hashInts, toUnit } from '../core/rng.js';
import { pickWeighted } from '../data/items.js';
import { hexDistance, hexNeighbor } from './hex.js';

/** Bump when placement output changes (a golden test guards it). */
export const ENEMY_LAYOUT_VERSION = 1;

/** Cell size in hexes (axial). */
export const CELL = 8;
/** No spawn closer than this to the sanctuary: nothing within sight of the start (4) can notice you there. */
export const CLEARANCE = 10;
/** Beasts closer than this to a ruin guard are dropped. */
export const GUARD_SPACING = 3;

const CELL_CHANCE = 0.45;
const GUARD_CHANCE = 0.8;
const CANDIDATES = 5;
const MIN_SCORE = 0.2;
const SALT = 0x3e1d07c5;

const isWater = (t) => t === 'deepWater' || t === 'shallowWater';

/**
 * Enemy spawns for a bounded map.
 * @param {number} seedNumber
 * @param {{
 *   radius: number,
 *   has: (h: {q:number,r:number}) => boolean,
 *   tileAt: (h: {q:number,r:number}) => { terrain: string } | null,
 *   isWalkable: (h: {q:number,r:number}) => boolean,
 *   poiAt: (h: {q:number,r:number}) => object | null,
 *   pois: ReadonlyArray<{ q: number, r: number, type: string }>,
 *   sanctuary: {q:number,r:number},
 * }} ctx
 * @returns {ReadonlyArray<{ id: number, type: string, q: number, r: number }>}
 *   in map row order; `id` is the index.
 */
export function placeEnemies(seedNumber, ctx) {
  const s = (seedNumber ^ SALT) >>> 0;
  const allowed = (h) => ctx.has(h) && ctx.isWalkable(h) && !isWater(ctx.tileAt(h).terrain)
    && !ctx.poiAt(h) && hexDistance(h, ctx.sanctuary) >= CLEARANCE;

  // Ruin guards.
  const guards = [];
  for (const p of ctx.pois) {
    if (p.type !== 'ruins' || toUnit(hashInts(s, p.q, p.r, 1)) >= GUARD_CHANCE) continue;
    const start = hashInts(s, p.q, p.r, 2) % 6;
    for (let i = 0; i < 6; i++) {
      const h = hexNeighbor(p, (start + i) % 6);
      if (allowed(h)) { guards.push({ type: 'skeleton', q: h.q, r: h.r }); break; }
    }
  }

  // Roaming beasts, one cell at a time.
  const beasts = [];
  const lo = Math.floor(-ctx.radius / CELL) - 1;
  const hi = Math.floor(ctx.radius / CELL) + 1;
  for (let cr = lo; cr <= hi; cr++) {
    for (let cq = lo; cq <= hi; cq++) {
      if (toUnit(hashInts(s, cq, cr, 0)) >= CELL_CHANCE) continue;
      let best = null;
      for (let i = 0; i < CANDIDATES; i++) {
        const hq = hashInts(s, cq, cr, 10 + i);
        const h = { q: cq * CELL + 1 + (hq % (CELL - 2)), r: cr * CELL + 1 + ((hq >>> 12) % (CELL - 2)) };
        if (!allowed(h)) continue;
        const terrain = ctx.tileAt(h).terrain;
        ENEMY_TYPE_IDS.forEach((id, ti) => {
          const suit = ENEMY_TYPES[id].habitat[terrain] ?? 0;
          if (suit <= 0) return;
          const score = suit * (0.6 + 0.8 * toUnit(hashInts(s, h.q, h.r, 20 + ti)));
          if (!best || score > best.score) best = { type: id, q: h.q, r: h.r, score };
        });
      }
      if (!best || best.score < MIN_SCORE) continue;
      if (guards.some((g) => hexDistance(g, best) < GUARD_SPACING)) continue;
      beasts.push({ type: best.type, q: best.q, r: best.r });
    }
  }

  const all = [...guards, ...beasts].sort((a, b) => a.r - b.r || a.q - b.q);
  return Object.freeze(all.map((e, id) => Object.freeze({ id, type: e.type, q: e.q, r: e.r })));
}

/**
 * What `enemy` leaves when it falls: one roll of its type's loot table from
 * hashes of (seed, home hex), so it is part of the world definition, like a
 * chest's contents. Pure.
 * @param {{ type: string, home: {q:number,r:number} }} enemy
 * @returns {Record<string, number>}
 */
export function rollLoot(seedNumber, enemy) {
  const s = (seedNumber ^ SALT) >>> 0;
  return pickWeighted(ENEMY_TYPES[enemy.type].loot, hashInts(s, enemy.home.q, enemy.home.r, 77));
}
