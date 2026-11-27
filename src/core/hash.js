/**
 * Small deterministic integer hashes for cosmetic variation.
 * NOT the world-generation PRNG (that arrives in Task 03).
 */

/** Hash an integer to [0, 1). */
export function hash01(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Hash a pair of integers (e.g. hex coordinates) to [0, 1). */
export function hashCoords(a, b, salt = 0) {
  return hash01(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(salt, 83492791));
}
