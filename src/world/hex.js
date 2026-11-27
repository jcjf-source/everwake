/**
 * Hex grid geometry.
 *
 * Coordinates: axial (q, r). The third cube coordinate is s = -q - r.
 * Orientation: POINTY-TOP (a vertex points up; rows are horizontal and
 * every other row is offset by half a hex). All pixel formulas below assume
 * pointy-top; do not mix in flat-top formulas.
 *
 * `size` is the hex radius: centre to any corner, in pixels.
 *   width  = sqrt(3) * size   (flat side to flat side)
 *   height = 2 * size         (point to point)
 *
 * Pixel space has +x to the right and +y downward (canvas convention).
 * Axial (0, 0) sits at pixel (0, 0).
 */

const SQRT3 = Math.sqrt(3);

/**
 * The six axial neighbour offsets, in order:
 * east, north-east, north-west, west, south-west, south-east.
 */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 }),
]);

/** @typedef {{ q: number, r: number }} Hex */

/** Create an axial hex. `+ 0` normalises -0 to 0. */
export function hex(q, r) {
  return { q: q + 0, r: r + 0 };
}

export function hexEquals(a, b) {
  return a.q === b.q && a.r === b.r;
}

/** Stable string key for maps and sets, e.g. "3,-2". */
export function hexKey(h) {
  return `${h.q},${h.r}`;
}

export function hexAdd(a, b) {
  return hex(a.q + b.q, a.r + b.r);
}

export function hexSubtract(a, b) {
  return hex(a.q - b.q, a.r - b.r);
}

/** @param {Hex} h @param {number} direction 0..5, see DIRECTIONS */
export function hexNeighbor(h, direction) {
  const d = DIRECTIONS[((direction % 6) + 6) % 6];
  return hexAdd(h, d);
}

/** All six neighbours, in DIRECTIONS order. */
export function hexNeighbors(h) {
  return DIRECTIONS.map((d) => hexAdd(h, d));
}

/** @returns {{ x: number, y: number, z: number }} cube coordinates (x=q, z=r, y=s). */
export function axialToCube(h) {
  return { x: h.q + 0, y: -h.q - h.r + 0, z: h.r + 0 };
}

export function cubeToAxial(c) {
  return hex(c.x, c.z);
}

/** Number of steps between two hexes. */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Round fractional axial coordinates to the nearest hex (cube rounding).
 * The component with the largest rounding error is recomputed from the
 * other two so that q + r + s = 0 always holds.
 */
export function hexRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  let s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }
  return hex(q, r);
}

/** Centre of a hex in pixel space (pointy-top). */
export function hexToPixel(h, size) {
  return {
    x: size * SQRT3 * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** The hex containing a pixel-space point (pointy-top). */
export function pixelToHex(x, y, size) {
  const fq = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const fr = ((2 / 3) * y) / size;
  return hexRound(fq, fr);
}

/**
 * The six corner points of a hex centred at (cx, cy), clockwise from the
 * upper-right corner. Pointy-top corners sit at -30°, 30°, 90°, … (y down).
 */
export function hexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return corners;
}

/** Every hex within `radius` steps of `center` (a hexagon-shaped region). */
export function hexesInRange(center, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rMin = Math.max(-radius, -dq - radius);
    const rMax = Math.min(radius, -dq + radius);
    for (let dr = rMin; dr <= rMax; dr++) {
      out.push(hex(center.q + dq, center.r + dr));
    }
  }
  return out;
}

/** Pixel dimensions of a hex: `width` flat-to-flat, `height` point-to-point. */
export function hexDimensions(size) {
  return { width: SQRT3 * size, height: 2 * size };
}
