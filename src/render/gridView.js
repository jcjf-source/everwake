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

/**
 * A view that fits every hex in `hexes` inside a width x height box, with
 * `margin` CSS pixels clear on each side, centred. The hex size is capped
 * at `maxSize` so a small explored area is not blown up to fill the box.
 * Used by the map overview.
 * @param {Array<{q:number,r:number}>} hexes non-empty
 * @returns {GridView}
 */
export function fitView(hexes, width, height, { margin = 12, maxSize = 10, minSize = 0.5 } = {}) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const h of hexes) {
    const p = hexToPixel(h, 1);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Unit-size extents plus one hex's half-width / half-height on each side.
  const spanX = maxX - minX + SQRT3;
  const spanY = maxY - minY + 2;
  const fit = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY);
  const size = Math.max(minSize, Math.min(maxSize, fit));
  return {
    originX: width / 2 - ((minX + maxX) / 2) * size,
    originY: height / 2 - ((minY + maxY) / 2) * size,
    size,
  };
}
