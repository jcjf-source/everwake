/**
 * Seeded randomness for world generation.
 *
 * Two tools, both deterministic and free of Math.random():
 *  - `createRng(seed)`: a sequential PRNG (mulberry32). Use it where values
 *    are drawn in a fixed order, e.g. deriving per-layer seeds.
 *  - `hashInts(seed, a, b, c)`: a stateless coordinate hash. Use it for
 *    anything spatial, so the result for a coordinate never depends on the
 *    order in which coordinates are generated (or drawn).
 * All values are unsigned 32-bit integers unless noted.
 */

const UINT32 = 4294967296;

/** Murmur3 finaliser: avalanche a 32-bit integer. */
export function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over UTF-16 code units, then mixed. Same string → same number. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Stateless hash of a seed and up to three integers. */
export function hashInts(seed, a, b = 0, c = 0) {
  let h = mix32((seed >>> 0) ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul(a | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(b | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(c | 0, 0x2545f491));
  return h;
}

/** Map a uint32 to [0, 1). */
export function toUnit(u32) {
  return u32 / UINT32;
}

/** Sequential seeded PRNG (mulberry32). */
export function createRng(seed) {
  let state = seed >>> 0;
  function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  return {
    nextUint32,
    /** Float in [0, 1). */
    next: () => nextUint32() / UINT32,
    /** Integer in [min, max] inclusive. */
    int(min, max) {
      return min + Math.floor((nextUint32() / UINT32) * (max - min + 1));
    },
  };
}
