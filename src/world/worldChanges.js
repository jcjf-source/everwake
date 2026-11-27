/**
 * Persistent world changes: how the world differs from its generated
 * baseline. Survives death and expeditions (see "State model" in
 * docs/TECHNICAL.md); saved with the game in Task 13.
 *
 * So far it records gathers taken from resource nodes, keyed by hex. The
 * generated node (world.resourceAt) is never modified: a node's remaining
 * gathers are `node.uses − gathersTaken(hex)`. Only hexes that changed are
 * stored, so the save stays small.
 *
 * Simulation only (no DOM).
 */
import { hexKey } from './hex.js';

export const WORLD_CHANGES_VERSION = 1;

export function createWorldChanges() {
  /** hexKey → { q, r, taken } */
  const gathered = new Map();
  return {
    /** Gathers already taken from the node at `h` (0 if untouched). */
    gathersTaken(h) {
      return gathered.get(hexKey(h))?.taken ?? 0;
    },
    /** Record `n` more gathers from the node at `h`. */
    recordGather(h, n = 1) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`gather count must be a positive integer, got ${n}`);
      const k = hexKey(h);
      const e = gathered.get(k);
      if (e) e.taken += n;
      else gathered.set(k, { q: h.q, r: h.r, taken: n });
    },
    /** Number of nodes that have been gathered from. */
    get gatheredCount() {
      return gathered.size;
    },
    /** Save form: `{ version, gathered: [[q, r, taken], …] }`, sorted by r then q. */
    serialize() {
      const list = [...gathered.values()]
        .sort((a, b) => a.r - b.r || a.q - b.q)
        .map((e) => [e.q, e.r, e.taken]);
      return { version: WORLD_CHANGES_VERSION, gathered: list };
    },
  };
}

/**
 * Validate and rebuild saved world changes. Never throws, never half-applies.
 * @returns {{ ok: true, changes: ReturnType<typeof createWorldChanges> } | { ok: false, error: string }}
 */
export function restoreWorldChanges(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'world changes save is not an object' };
  if (data.version !== WORLD_CHANGES_VERSION) return { ok: false, error: `unsupported world changes version ${data.version}` };
  if (!Array.isArray(data.gathered)) return { ok: false, error: 'gathered must be a list' };
  const seen = new Set();
  for (const e of data.gathered) {
    const ok = Array.isArray(e) && e.length === 3 && e.every(Number.isSafeInteger) && e[2] >= 1;
    if (!ok) return { ok: false, error: 'each gathered entry must be [q, r, taken ≥ 1]' };
    const k = `${e[0]},${e[1]}`;
    if (seen.has(k)) return { ok: false, error: `duplicate gathered entry ${k}` };
    seen.add(k);
  }
  const changes = createWorldChanges();
  for (const [q, r, taken] of data.gathered) changes.recordGather({ q, r }, taken);
  return { ok: true, changes };
}
