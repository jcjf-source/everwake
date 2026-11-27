/**
 * Fog of war and map memory.
 *
 * Every hex of the bounded map is in one of three states:
 *  - UNKNOWN: never seen; its terrain and anything on it are hidden;
 *  - REMEMBERED: seen before; terrain stays mapped (drawn dim), but things
 *    that move are not shown because they cannot be seen now;
 *  - VISIBLE: within sight of the player right now.
 *
 * Sight is a plain hex radius around the observer (hex distance, no line
 * of sight yet). Terrain `sightModifier` / `blocksSight` and upgrades such
 * as Cartographer are later modifiers; they would change the radius or the
 * set passed to `observe`, not this storage.
 *
 * This is *player persistent state* (map knowledge survives death; see
 * TECHNICAL.md "State model"). Only "known or not" needs saving: what is
 * visible is recomputed from the player's position, so `serialize()` stores
 * a bitset of known hexes and `restoreMapMemory` rebuilds from it.
 *
 * Simulation only: no rendering or DOM.
 */
import { hexDistance, hexesInRange } from './hex.js';

export const FOG = Object.freeze({ UNKNOWN: 0, REMEMBERED: 1, VISIBLE: 2 });

/** Base sight radius in hexes. */
export const SIGHT_RADIUS = 4;

/** Version of the `serialize()` format. */
export const MAP_MEMORY_VERSION = 1;

const ORIGIN = Object.freeze({ q: 0, r: 0 });

/**
 * @param {number} radius map radius, as in createWorld
 */
export function createMapMemory(radius) {
  if (!Number.isInteger(radius) || radius < 0) throw new RangeError(`bad map radius ${radius}`);
  // Same dense layout as world.js: index = (r+R)*(2R+1) + (q+R).
  const span = 2 * radius + 1;
  const state = new Uint8Array(span * span);
  /** Indices currently VISIBLE, so the next observe can demote them. */
  let visible = [];
  let knownCount = 0;

  const inMap = (h) => !!h && Number.isInteger(h.q) && Number.isInteger(h.r) && hexDistance(h, ORIGIN) <= radius;
  const indexOf = (h) => (h.r + radius) * span + (h.q + radius);

  function stateAt(h) {
    return inMap(h) ? state[indexOf(h)] : FOG.UNKNOWN;
  }

  return {
    radius,
    stateAt,
    isKnown: (h) => stateAt(h) !== FOG.UNKNOWN,
    isVisible: (h) => stateAt(h) === FOG.VISIBLE,
    /** Number of hexes ever seen (remembered or visible). */
    get knownCount() { return knownCount; },
    /** Number of hexes on the map (for "explored n of m"). */
    get totalCount() { return 1 + 3 * radius * (radius + 1); },

    /**
     * Look around from `center`: hexes within `sightRadius` (hex distance)
     * become VISIBLE, and hexes that were visible but are now out of range
     * become REMEMBERED. Call on start and after every move.
     * @returns {{ revealed: number, newly: Array<{q:number,r:number}> }}
     *   `revealed`: how many hexes were seen for the first time; `newly`:
     *   those hexes (discovery of POIs reads them).
     */
    observe(center, sightRadius = SIGHT_RADIUS) {
      for (const i of visible) state[i] = FOG.REMEMBERED;
      visible = [];
      const newly = [];
      for (const h of hexesInRange(center, Math.max(0, sightRadius))) {
        if (!inMap(h)) continue;
        const i = indexOf(h);
        if (state[i] === FOG.UNKNOWN) { newly.push(h); knownCount++; }
        state[i] = FOG.VISIBLE;
        visible.push(i);
      }
      return { revealed: newly.length, newly };
    },

    /**
     * Map the hexes within `radius` of `center` without seeing them: unknown
     * hexes become REMEMBERED (drawn dim); visible ones stay visible. Used
     * for knowledge gained without sight (a shrine shows the land around).
     * @returns {{ revealed: number, newly: Array<{q:number,r:number}> }}
     */
    reveal(center, radius) {
      const newly = [];
      for (const h of hexesInRange(center, Math.max(0, radius))) {
        if (!inMap(h)) continue;
        const i = indexOf(h);
        if (state[i] !== FOG.UNKNOWN) continue;
        state[i] = FOG.REMEMBERED;
        knownCount++;
        newly.push(h);
      }
      return { revealed: newly.length, newly };
    },

    /** Every known hex, in a stable order (row by row). */
    knownHexes() {
      const out = [];
      for (let r = -radius; r <= radius; r++) {
        for (let q = Math.max(-radius, -r - radius); q <= Math.min(radius, -r + radius); q++) {
          if (state[(r + radius) * span + (q + radius)] !== FOG.UNKNOWN) out.push({ q, r });
        }
      }
      return out;
    },

    /**
     * Save form: `{ version, radius, known }`, where `known` is a base64
     * bitset over knownHexes() order (about 820 characters for radius 40).
     */
    serialize() {
      const cells = cellOrder(radius);
      const bytes = new Uint8Array(Math.ceil(cells.length / 8));
      cells.forEach((i, bit) => { if (state[i] !== FOG.UNKNOWN) bytes[bit >> 3] |= 1 << (bit & 7); });
      return { version: MAP_MEMORY_VERSION, radius, known: toBase64(bytes) };
    },

    /** @internal used by restoreMapMemory */
    _markKnown(i) {
      if (state[i] === FOG.UNKNOWN) { state[i] = FOG.REMEMBERED; knownCount++; }
    },
  };
}

/**
 * Rebuild map memory from `serialize()` output. Everything known comes
 * back REMEMBERED; call `observe(playerPosition)` afterwards to restore
 * what is visible. Malformed data is reported, never half-applied.
 * @returns {{ ok: true, memory: ReturnType<typeof createMapMemory> } | { ok: false, error: string }}
 */
export function restoreMapMemory(data, radius) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'map memory missing' };
  if (data.version !== MAP_MEMORY_VERSION) return { ok: false, error: `unsupported map memory version ${data.version}` };
  if (data.radius !== radius) return { ok: false, error: `map radius ${data.radius} does not match world radius ${radius}` };
  const cells = cellOrder(radius);
  let bytes;
  try {
    bytes = fromBase64(String(data.known));
  } catch {
    return { ok: false, error: 'map memory is not valid base64' };
  }
  if (bytes.length !== Math.ceil(cells.length / 8)) return { ok: false, error: 'map memory has the wrong length' };
  const memory = createMapMemory(radius);
  cells.forEach((i, bit) => { if (bytes[bit >> 3] & (1 << (bit & 7))) memory._markKnown(i); });
  return { ok: true, memory };
}

/**
 * Whether an entity may be drawn or reported, given what the player knows.
 * Landmarks (the sanctuary, later discovered POIs) stay on the map once
 * their hex is known; anything that can move (enemies, Task 09) is shown
 * only while its hex is visible.
 * @param {{ isKnown: (h: any) => boolean, isVisible: (h: any) => boolean }} memory
 * @param {{ at: {q:number,r:number}, kind: 'landmark' | 'mobile' }} entity
 */
export function canSee(memory, entity) {
  return entity.kind === 'landmark' ? memory.isKnown(entity.at) : memory.isVisible(entity.at);
}

/** Dense indices of every map hex, row by row (the bitset order). */
function cellOrder(radius) {
  const span = 2 * radius + 1;
  const out = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = Math.max(-radius, -r - radius); q <= Math.min(radius, -r + radius); q++) {
      out.push((r + radius) * span + (q + radius));
    }
  }
  return out;
}

function toBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
