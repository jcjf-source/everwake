/**
 * Persistent world changes: how the world differs from its generated
 * baseline. Survives death and expeditions (see "State model" in
 * docs/TECHNICAL.md); saved with the game in Task 13.
 *
 * It records, keyed by hex:
 *  - gathers taken from resource nodes: a node's remaining gathers are
 *    `node.uses − gathersTaken(hex)` (Task 07);
 *  - uses of points of interest (searches, chests opened, shrines read):
 *    a POI's remaining uses are `poi.uses − poiUsesTaken(hex)` (Task 08).
 * The generated world (world.resourceAt, world.poiAt) is never modified.
 * Only hexes that changed are stored, so the save stays small.
 *
 * Simulation only (no DOM).
 */
import { hexKey } from './hex.js';

export const WORLD_CHANGES_VERSION = 2;

/** A hexKey → { q, r, taken } counter with sorted save form. */
function createCounter(what) {
  const map = new Map();
  return {
    get: (h) => map.get(hexKey(h))?.taken ?? 0,
    add(h, n) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`${what} count must be a positive integer, got ${n}`);
      const k = hexKey(h);
      const e = map.get(k);
      if (e) e.taken += n;
      else map.set(k, { q: h.q, r: h.r, taken: n });
    },
    get size() { return map.size; },
    list: () => [...map.values()].sort((a, b) => a.r - b.r || a.q - b.q).map((e) => [e.q, e.r, e.taken]),
  };
}

export function createWorldChanges() {
  const gathered = createCounter('gather');
  const poiUses = createCounter('POI use');
  return {
    /** Gathers already taken from the node at `h` (0 if untouched). */
    gathersTaken: gathered.get,
    /** Record `n` more gathers from the node at `h`. */
    recordGather(h, n = 1) { gathered.add(h, n); },
    /** Number of nodes that have been gathered from. */
    get gatheredCount() { return gathered.size; },
    /** Uses already taken from the POI at `h` (0 if untouched). */
    poiUsesTaken: poiUses.get,
    /** Record `n` more uses of the POI at `h`. */
    recordPoiUse(h, n = 1) { poiUses.add(h, n); },
    /** Number of POIs that have been used at least once. */
    get poiUsedCount() { return poiUses.size; },
    /** Save form: `{ version, gathered: [[q, r, taken], …], pois: [[q, r, taken], …] }`, each sorted by r then q. */
    serialize() {
      return { version: WORLD_CHANGES_VERSION, gathered: gathered.list(), pois: poiUses.list() };
    },
  };
}

/** Problem with one `[[q, r, taken], …]` list, or null. */
function checkCounts(list, name) {
  if (!Array.isArray(list)) return `${name} must be a list`;
  const seen = new Set();
  for (const e of list) {
    const ok = Array.isArray(e) && e.length === 3 && e.every(Number.isSafeInteger) && e[2] >= 1;
    if (!ok) return `each ${name} entry must be [q, r, taken ≥ 1]`;
    const k = `${e[0]},${e[1]}`;
    if (seen.has(k)) return `duplicate ${name} entry ${k}`;
    seen.add(k);
  }
  return null;
}

/**
 * Validate and rebuild saved world changes. Never throws, never half-applies.
 * Version 1 (Task 07, gathers only) is accepted and read as having no POI uses.
 * @returns {{ ok: true, changes: ReturnType<typeof createWorldChanges> } | { ok: false, error: string }}
 */
export function restoreWorldChanges(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'world changes save is not an object' };
  if (data.version !== 1 && data.version !== WORLD_CHANGES_VERSION) return { ok: false, error: `unsupported world changes version ${data.version}` };
  const pois = data.version === 1 ? [] : data.pois;
  const problem = checkCounts(data.gathered, 'gathered') ?? checkCounts(pois, 'pois');
  if (problem) return { ok: false, error: problem };
  const changes = createWorldChanges();
  for (const [q, r, taken] of data.gathered) changes.recordGather({ q, r }, taken);
  for (const [q, r, taken] of pois) changes.recordPoiUse({ q, r }, taken);
  return { ok: true, changes };
}
