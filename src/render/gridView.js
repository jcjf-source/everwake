/**
 * Screen <-> hex helpers for a GridView `{ originX, originY, size }`.
 *
 * A GridView is produced by `cameraToView` (camera.js) and is the single
 * source of truth for where hexes appear on screen: rendering and
 * hit-testing both use the same view, so they cannot disagree. All values
 * are CSS pixels; device pixel ratio is handled by the canvas surface.
 */
import { hex, hexToPixel, pixelToHex } from '../world/hex.js';

/** @typedef {{ originX: number, originY: number, size: number }} GridView */

const SQRT3 = Math.sqrt(3);

/** Screen-space centre of a hex. */
export function hexToScreen(view, h) {
  const p = hexToPixel(h, view.size);
  return { x: view.originX + p.x, y: view.originY + p.y };
}

/** The hex under a screen-space point. */
export function screenToHex(view, x, y) {
  return pixelToHex(x - view.originX, y - view.originY, view.size);
}

/**
 * Every hex that overlaps (or is within `padding` hexes of) the viewport
 * rectangle [0,width] x [0,height], filtered by `include`. Work is
 * proportional to the number of on-screen hexes, not the grid size.
 * Pointy-top: rows are horizontal, so iterate rows (r) then the q-span of
 * each row.
 * @param {GridView} view
 * @param {number} width
 * @param {number} height
 * @param {(h: {q:number,r:number}) => boolean} include
 * @param {number} [padding] extra hexes beyond the edges
 */
export function visibleHexes(view, width, height, include, padding = 1) {
  const { originX, originY, size } = view;
  const rowHeight = 1.5 * size;
  const hexWidth = SQRT3 * size;
  // A hex's extent from its centre: size vertically, hexWidth/2 horizontally.
  const rMin = Math.floor((0 - originY - size) / rowHeight) - padding;
  const rMax = Math.ceil((height - originY + size) / rowHeight) + padding;
  const out = [];
  for (let r = rMin; r <= rMax; r++) {
    // centre x = originX + hexWidth * (q + r/2)
    const qMin = Math.floor((0 - originX - hexWidth / 2) / hexWidth - r / 2) - padding;
    const qMax = Math.ceil((width - originX + hexWidth / 2) / hexWidth - r / 2) + padding;
    for (let q = qMin; q <= qMax; q++) {
      const h = hex(q, r);
      if (include(h)) out.push(h);
    }
  }
  return out;
}
