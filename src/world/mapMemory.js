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
 * Separately, map memory records **walked ground** (G01): every hex the
 * player has stood on, on any expedition. Seeing a hex never marks it as
 * walked: the turn pipeline (core/game.js) marks the hex the player ends
 * each turn on, and where each expedition starts. A walked hex is always
 * known. Stride costs (G03) and card finds (G06) will read it.
 *
 * This is *player persistent state* (map knowledge survives death; see
 * TECHNICAL.md "State model"). Only "known or not" and "walked or not" need
 * saving: what is visible is recomputed from the player's position, so
 * `serialize()` stores two bitsets and `restoreMapMemory` rebuilds from them.
 *
 * Simulation only: no rendering or DOM.
 */
import { hexDistance, hexesInRange } from './hex.js';

export const FOG = Object.freeze({ UNKNOWN: 0, REMEMBERED: 1, VISIBLE: 2 });

/** Base sight radius in hexes. */
export const SIGHT_RADIUS = 4;

/** Version of the `serialize()` format (2 adds walked ground, G01; version 1 still loads). */
export const MAP_MEMORY_VERSION = 2;

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
  /** Walked ground (G01): 1 where the player has stood. Same layout as `state`. */
  const walked = new Uint8Array(span * span);
  let walkedCount = 0;
  /** Sight radius of the last observe (null before the first). */
  let sight = null;

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
      sight = Math.max(0, sightRadius);
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
     * Record that the player stands on `h` (walked ground, G01). Only a known
     * hex can be walked, so an unknown or off-map hex is ignored.
     * @returns {boolean} whether `h` was walked for the first time
     */
    markWalked(h) {
      if (stateAt(h) === FOG.UNKNOWN) return false;
      const i = indexOf(h);
      if (walked[i]) return false;
      walked[i] = 1;
      walkedCount++;
      return true;
    },
    /** Has the player ever stood on `h`? */
    isWalked: (h) => inMap(h) && walked[indexOf(h)] === 1,
    /** Number of hexes ever stood on. */
    walkedCount: () => walkedCount,
    /** Every walked hex, in a stable order (row by row). */
    walkedHexes() {
      return cellOrder(radius).filter((i) => walked[i]).map((i) => ({ q: (i % span) - radius, r: Math.floor(i / span) - radius }));
    },

    /** The sight radius of the last `observe` or `showSight` (null before either). Saved with the game (Task 13). */
    get sight() { return sight; },

    /**
     * Restore what is in sight after loading (Task 13): known hexes within
     * `sightRadius` of `center` become VISIBLE, everything else visible
     * becomes REMEMBERED. Unlike `observe`, nothing new is mapped, so a
     * reload never reveals land or discovers places.
     */
    showSight(center, sightRadius) {
      for (const i of visible) state[i] = FOG.REMEMBERED;
      visible = [];
      sight = Math.max(0, sightRadius);
      for (const h of hexesInRange(center, sight)) {
        if (!inMap(h)) continue;
        const i = indexOf(h);
        if (state[i] === FOG.UNKNOWN) continue;
        state[i] = FOG.VISIBLE;
        visible.push(i);
      }
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
     * Save form: `{ version: 2, radius, known, walked }`. `known` and `walked`
     * are base64 bitsets over every map hex, row by row (about 820 characters
     * each for radius 40).
     */
    serialize() {
      const cells = cellOrder(radius);
      return {
        version: MAP_MEMORY_VERSION, radius,
        known: toBitset(cells, (i) => state[i] !== FOG.UNKNOWN),
        walked: toBitset(cells, (i) => walked[i] === 1),
      };
    },

    /** @internal used by restoreMapMemory */
    _markKnown(i) {
      if (state[i] === FOG.UNKNOWN) { state[i] = FOG.REMEMBERED; knownCount++; }
    },
    /** @internal used by restoreMapMemory */
    _markWalked(i) {
      if (!walked[i]) { walked[i] = 1; walkedCount++; }
    },
  };
}

/**
 * Rebuild map memory from `serialize()` output. Everything known comes
 * back REMEMBERED; call `observe(playerPosition)` afterwards to restore
 * what is visible. Malformed data is reported, never half-applied.
 *
 * Version 1 (before walked ground) still loads, with nothing walked; the
 * caller marks the player's hex (systems/persistence.js). In version 2 every
 * walked hex must also be known.
 * @returns {{ ok: true, memory: ReturnType<typeof createMapMemory>, version: number } | { ok: false, error: string }}
 */
export function restoreMapMemory(data, radius) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'map memory missing' };
  if (data.version !== 1 && data.version !== MAP_MEMORY_VERSION) return { ok: false, error: `unsupported map memory version ${data.version}` };
  if (data.radius !== radius) return { ok: false, error: `map radius ${data.radius} does not match world radius ${radius}` };
  const cells = cellOrder(radius);
  const known = fromBitset(data.known, cells.length, 'map memory');
  if (!known.ok) return known;
  const walked = data.version === 1 ? null : fromBitset(data.walked, cells.length, 'walked ground');
  if (walked && !walked.ok) return walked;
  if (walked && walked.bits.some((bit) => !hasBit(known.bytes, bit))) return { ok: false, error: 'walked ground includes hexes that are not on the map' };
  const memory = createMapMemory(radius);
  cells.forEach((i, bit) => { if (hasBit(known.bytes, bit)) memory._markKnown(i); });
  if (walked) for (const bit of walked.bits) memory._markWalked(cells[bit]);
  return { ok: true, memory, version: data.version };
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

/** A base64 bitset over `cells` (bit n is cells[n]), set where `test(index)` holds. */
function toBitset(cells, test) {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  cells.forEach((i, bit) => { if (test(i)) bytes[bit >> 3] |= 1 << (bit & 7); });
  return toBase64(bytes);
}

const hasBit = (bytes, bit) => (bytes[bit >> 3] & (1 << (bit & 7))) !== 0;

/**
 * Decode a saved bitset of `count` bits.
 * @returns {{ ok: true, bytes: Uint8Array, bits: number[] } | { ok: false, error: string }} `bits`: the set ones
 */
function fromBitset(text, count, name) {
  let bytes;
  try {
    bytes = fromBase64(String(text));
  } catch {
    return { ok: false, error: `${name} is not valid base64` };
  }
  if (bytes.length !== Math.ceil(count / 8)) return { ok: false, error: `${name} has the wrong length` };
  const bits = [];
  for (let bit = 0; bit < count; bit++) if (hasBit(bytes, bit)) bits.push(bit);
  return { ok: true, bytes, bits };
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
