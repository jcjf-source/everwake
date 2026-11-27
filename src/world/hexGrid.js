/**
 * A bounded, hexagon-shaped grid of hexes centred on axial (0, 0).
 * The grid only answers "which hexes exist"; terrain comes from
 * world/worldGen.js via world/world.js.
 */
import { hex, hexDistance, hexesInRange } from './hex.js';

const ORIGIN = Object.freeze(hex(0, 0));

/** @param {number} radius non-negative integer */
export function createHexGrid(radius) {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(`Grid radius must be a non-negative integer, got ${radius}`);
  }
  const cells = Object.freeze(hexesInRange(ORIGIN, radius).map(Object.freeze));
  return Object.freeze({
    radius,
    cells,
    /** @param {{ q: number, r: number } | null | undefined} h */
    has(h) {
      return !!h && Number.isInteger(h.q) && Number.isInteger(h.r) && hexDistance(h, ORIGIN) <= radius;
    },
  });
}
