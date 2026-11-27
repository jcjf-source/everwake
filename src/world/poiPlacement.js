/**
 * Point-of-interest placement: part of the generated *world definition*.
 *
 * The plane is divided into axial cells of CELL × CELL hexes. Each cell, from
 * hashes of (seed, cell) alone, may propose one POI: it samples a few hexes
 * in the cell, scores every POI type on each from the local terrain (the
 * tile and its six neighbours, see `poiSuitability`), and proposes the best
 * (type, hex) if it scores well enough. A proposal is then dropped if a
 * higher-priority proposal from a nearby cell sits within MIN_SPACING hexes,
 * or a same-type one within SAME_TYPE_SPACING. Those rules read only the
 * proposals of cells at most two away, so the result is independent of
 * generation order and works per chunk later.
 *
 * Terrain rules (why things are where they are):
 *  - ruins: high, defensible ground (hills, rocky ground, hilltops);
 *  - camps: grassland or forest beside water;
 *  - chests: tucked away in woods, rocks and dunes;
 *  - shrines: forest clearings and rises;
 *  - caves: rocky ground or hills at the foot of mountains.
 * POIs sit only on walkable land (never water), never on a resource node,
 * and never within SANCTUARY_CLEARANCE of the sanctuary.
 *
 * This is the baseline only: what has been searched or opened lives in the
 * persistent world changes (worldChanges.js), never here.
 */
import { POI_TYPES, POI_TYPE_IDS } from '../data/pois.js';
import { pickWeighted } from '../data/items.js';
import { TERRAIN } from '../data/terrain.js';
import { hashInts, toUnit } from '../core/rng.js';
import { hexDistance, hexNeighbors } from './hex.js';

/** Bump when placement output changes (a golden test guards it). */
export const POI_LAYOUT_VERSION = 1;

/** Cell size in hexes (axial). Must exceed MIN_SPACING. */
export const CELL = 7;
/** No two POIs closer than this (hex distance). */
export const MIN_SPACING = 4;
/** No two POIs of the same type closer than this. At most 2·CELL. */
export const SAME_TYPE_SPACING = 9;
/** Hexes around the sanctuary kept clear. */
export const SANCTUARY_CLEARANCE = 3;

const CANDIDATES = 6;
const CELL_CHANCE = 0.7;
const MIN_SCORE = 0.45;
const SALT = 0x9013a1e5;

/** Relative frequency of each type, applied to its terrain score. */
const TYPE_WEIGHT = Object.freeze({ ruins: 1, camp: 1, chest: 0.8, shrine: 0.88, cave: 1.6 });

const isWater = (t) => t === 'deepWater' || t === 'shallowWater';

/**
 * How well each POI type suits a hex, from 0 (never) upward. Pure.
 * @param {{ terrain: string, elevation: number }} tile
 * @param {Array<{ terrain: string, elevation: number } | null>} neighbours six tiles (null off the map)
 * @returns {Record<string, number>}
 */
export function poiSuitability(tile, neighbours) {
  const t = tile.terrain;
  const out = { ruins: 0, camp: 0, chest: 0, shrine: 0, cave: 0 };
  if (!TERRAIN[t].walkable || isWater(t)) return out;
  const present = neighbours.filter(Boolean);
  const count = (pred) => present.reduce((n, x) => n + (pred(x) ? 1 : 0), 0);
  const mountains = count((x) => x.terrain === 'mountains');
  const water = count((x) => isWater(x.terrain));
  const woods = count((x) => x.terrain === 'forest' || x.terrain === 'denseForest');
  const hilltop = present.length === 6 && present.every((x) => x.elevation <= tile.elevation);

  out.ruins = ({ hills: 1, rocky: 0.8, grassland: 0.5, forest: 0.3, sand: 0.2, denseForest: 0.15 }[t] ?? 0) + (hilltop ? 0.4 : 0);
  out.camp = ({ grassland: 0.7, forest: 0.8, hills: 0.4, sand: 0.3 }[t] ?? 0) * (water > 0 ? 1.4 : 0.35);
  out.chest = { denseForest: 1, forest: 0.7, rocky: 0.5, hills: 0.5, sand: 0.5, grassland: 0.3 }[t] ?? 0;
  out.shrine = ({ grassland: 0.5, hills: 0.7, forest: 0.35, sand: 0.3 }[t] ?? 0)
    + (t === 'grassland' && woods >= 3 ? 0.6 : 0) + (hilltop ? 0.3 : 0);
  out.cave = (t === 'rocky' || t === 'hills') && mountains > 0 ? 1 + 0.15 * Math.min(3, mountains) : 0;
  return out;
}

/**
 * The POI a cell proposes, or null. Pure in (seed, cell, terrain).
 * @param {number} s salted seed
 * @param {{ tileAt: Function, allowed: (h: {q:number,r:number}) => boolean }} ctx
 */
function cellProposal(s, cq, cr, ctx) {
  if (toUnit(hashInts(s, cq, cr, 0)) >= CELL_CHANCE) return null;
  let best = null;
  for (let i = 0; i < CANDIDATES; i++) {
    const hq = hashInts(s, cq, cr, 1 + i);
    const h = { q: cq * CELL + (hq % CELL), r: cr * CELL + ((hq >>> 12) % CELL) };
    if (!ctx.allowed(h)) continue;
    const suit = poiSuitability(ctx.tileAt(h), hexNeighbors(h).map(ctx.tileAt));
    POI_TYPE_IDS.forEach((id, ti) => {
      if (suit[id] <= 0) return;
      const jitter = 0.6 + 0.8 * toUnit(hashInts(s, h.q, h.r, 16 + ti));
      const score = suit[id] * TYPE_WEIGHT[id] * jitter;
      if (!best || score > best.score) best = { q: h.q, r: h.r, type: id, score };
    });
  }
  if (!best || best.score < MIN_SCORE) return null;
  return { ...best, cq, cr, priority: hashInts(s, cq, cr, 99) };
}

/** Does proposal `o` outrank `c`? (priority, then cell order as a tiebreak) */
const outranks = (o, c) => o.priority > c.priority
  || (o.priority === c.priority && (o.cr < c.cr || (o.cr === c.cr && o.cq < c.cq)));

/**
 * POIs for a bounded map.
 * @param {number} seedNumber
 * @param {{
 *   radius: number,
 *   has: (h: {q:number,r:number}) => boolean,
 *   tileAt: (h: {q:number,r:number}) => object | null,
 *   isWalkable: (h: {q:number,r:number}) => boolean,
 *   resourceAt: (h: {q:number,r:number}) => object | null,
 *   indexOf: (h: {q:number,r:number}) => number,
 *   sanctuary: {q:number,r:number},
 * }} ctx
 * @returns {{ poiAt: (h: {q:number,r:number}) => object | null, pois: ReadonlyArray<object> }}
 */
export function placePois(seedNumber, ctx) {
  const s = (seedNumber ^ SALT) >>> 0;
  const allowed = (h) => ctx.has(h) && ctx.isWalkable(h) && !isWater(ctx.tileAt(h).terrain)
    && !ctx.resourceAt(h) && hexDistance(h, ctx.sanctuary) >= SANCTUARY_CLEARANCE;
  const pctx = { tileAt: ctx.tileAt, allowed };

  const lo = Math.floor(-ctx.radius / CELL) - 2;
  const hi = Math.floor(ctx.radius / CELL) + 2;
  const proposals = new Map();
  for (let cr = lo; cr <= hi; cr++) {
    for (let cq = lo; cq <= hi; cq++) {
      const p = cellProposal(s, cq, cr, pctx);
      if (p) proposals.set(`${cq},${cr}`, p);
    }
  }

  const kept = [];
  for (const c of proposals.values()) {
    let ok = true;
    for (let dr = -2; dr <= 2 && ok; dr++) {
      for (let dq = -2; dq <= 2 && ok; dq++) {
        if (dq === 0 && dr === 0) continue;
        const o = proposals.get(`${c.cq + dq},${c.cr + dr}`);
        if (!o || !outranks(o, c)) continue;
        const d = hexDistance(o, c);
        if (d < MIN_SPACING || (o.type === c.type && d < SAME_TYPE_SPACING)) ok = false;
      }
    }
    if (ok) kept.push(c);
  }
  kept.sort((a, b) => a.r - b.r || a.q - b.q);

  const byIndex = new Map();
  const list = kept.map((c) => {
    const def = POI_TYPES[c.type];
    const [ulo, uhi] = def.uses;
    const poi = Object.freeze({
      q: c.q, r: c.r, type: c.type,
      name: def.names[hashInts(s, c.q, c.r, 40) % def.names.length],
      uses: ulo + (hashInts(s, c.q, c.r, 41) % (uhi - ulo + 1)),
    });
    byIndex.set(ctx.indexOf(c), poi);
    return poi;
  });

  return {
    poiAt(h) {
      const i = ctx.indexOf(h);
      return i < 0 ? null : byIndex.get(i) ?? null;
    },
    pois: Object.freeze(list),
  };
}

/**
 * The find from one use of a POI (0-based `useIndex`): a weighted roll of
 * its type's find table, from hashes of (seed, hex, use). Pure, so what a
 * chest holds is part of the world definition, not chosen when opened.
 * @returns {Record<string, number> | null} null for types without finds
 */
export function rollFind(seedNumber, poi, useIndex) {
  const def = POI_TYPES[poi.type];
  if (def.effect !== 'finds') return null;
  const s = (seedNumber ^ SALT) >>> 0;
  return pickWeighted(def.finds, hashInts(s, poi.q, poi.r, 64 + useIndex));
}
