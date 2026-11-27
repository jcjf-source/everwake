/**
 * Resource node placement: part of the generated *world definition*.
 *
 * Every hex independently may hold one node. Whether it does, which resource
 * it yields and how many gathers it holds come from stateless coordinate
 * hashes of the world seed, weighted by the terrain's resource suitability
 * (src/data/terrain.js). So placement is reproducible from (seed, q, r)
 * alone, independent of generation order, and ready for chunks.
 *
 * This is the baseline only: what has been gathered lives in the persistent
 * world changes (worldChanges.js), never here.
 */
import { TERRAIN, RESOURCE_KINDS } from '../data/terrain.js';
import { nodeKindFor } from '../data/resources.js';
import { hashInts, toUnit } from '../core/rng.js';

/** Bump when placement output changes (a golden test guards it). */
export const RESOURCE_LAYOUT_VERSION = 1;

/** Chance of a node on a hex whose best suitability is 1. */
export const NODE_DENSITY = 0.15;

const SALT = 0x5eed7a11;

/**
 * The node at one hex, or null. Pure in (seedNumber, tile, isSanctuary).
 * @param {number} seedNumber
 * @param {{ q: number, r: number, terrain: string }} tile
 * @returns {{ q: number, r: number, kind: string, resource: string, uses: number } | null}
 */
export function nodeForTile(seedNumber, tile) {
  const suit = TERRAIN[tile.terrain].resources;
  let total = 0;
  let best = 0;
  for (const k of RESOURCE_KINDS) {
    total += suit[k];
    if (suit[k] > best) best = suit[k];
  }
  if (best <= 0) return null;
  const s = (seedNumber ^ SALT) >>> 0;
  if (toUnit(hashInts(s, tile.q, tile.r, 1)) >= NODE_DENSITY * best) return null;

  // Resource weighted by suitability.
  let pick = toUnit(hashInts(s, tile.q, tile.r, 2)) * total;
  let resource = RESOURCE_KINDS[RESOURCE_KINDS.length - 1];
  for (const k of RESOURCE_KINDS) {
    if (suit[k] <= 0) continue;
    if (pick < suit[k]) { resource = k; break; }
    pick -= suit[k];
  }
  const kind = nodeKindFor(resource, tile.terrain);
  if (!kind) return null;
  const [lo, hi] = kind.uses;
  const uses = lo + (hashInts(s, tile.q, tile.r, 3) % (hi - lo + 1));
  return Object.freeze({ q: tile.q, r: tile.r, kind: kind.id, resource, uses });
}

/**
 * Nodes for a bounded map. The sanctuary hex never holds one.
 * @param {number} seedNumber
 * @param {Array<{q:number,r:number}>} cells
 * @param {(h: {q:number,r:number}) => object | null} tileAt
 * @param {(h: {q:number,r:number}) => number} indexOf dense index of a map hex (-1 if off the map)
 * @param {{q:number,r:number}} sanctuary
 */
export function placeResourceNodes(seedNumber, cells, tileAt, indexOf, sanctuary) {
  const byIndex = new Map();
  const list = [];
  for (const h of cells) {
    if (h.q === sanctuary.q && h.r === sanctuary.r) continue;
    const node = nodeForTile(seedNumber, tileAt(h));
    if (!node) continue;
    byIndex.set(indexOf(h), node);
    list.push(node);
  }
  return {
    /** The generated node at `h`, or null. */
    nodeAt(h) {
      const i = indexOf(h);
      return i < 0 ? null : byIndex.get(i) ?? null;
    },
    nodes: Object.freeze(list),
  };
}
