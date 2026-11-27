/**
 * 2D camera for the hex view.
 *
 * World space is hex pixel space at a fixed BASE_HEX_SIZE (hexToPixel with
 * size = BASE_HEX_SIZE). The camera stores the world point shown at the
 * centre of the viewport plus a zoom factor:
 *
 *   screen = viewportCentre + (world - camera.centre) * zoom
 *
 * `cameraToView` turns a camera into the `{ originX, originY, size }`
 * GridView that both rendering and hit-testing consume, so they cannot
 * disagree. All functions are pure and return new camera objects.
 * Units: CSS pixels (device pixel ratio is handled by the canvas surface).
 */
import { hexToPixel, hexDimensions } from '../world/hex.js';

export const BASE_HEX_SIZE = 32;

/**
 * @typedef {{
 *   x: number, y: number, zoom: number,
 *   minZoom: number, maxZoom: number,
 *   bounds: { minX: number, maxX: number, minY: number, maxY: number } | null,
 * }} Camera
 */

/** @param {Partial<Camera>} [opts] @returns {Camera} */
export function createCamera(opts = {}) {
  const cam = {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.4,
    maxZoom: 2.5,
    bounds: null,
    ...opts,
  };
  if (!(cam.minZoom > 0) || !(cam.maxZoom >= cam.minZoom)) {
    throw new RangeError(`Invalid zoom bounds ${cam.minZoom}..${cam.maxZoom}`);
  }
  return clampCamera(cam);
}

/** Keep zoom within bounds and the centre within the world bounds. */
export function clampCamera(cam) {
  const zoom = Math.min(cam.maxZoom, Math.max(cam.minZoom, cam.zoom));
  let { x, y } = cam;
  if (cam.bounds) {
    x = Math.min(cam.bounds.maxX, Math.max(cam.bounds.minX, x));
    y = Math.min(cam.bounds.maxY, Math.max(cam.bounds.minY, y));
  }
  return { ...cam, x, y, zoom };
}

/** @returns {import('./gridView.js').GridView} */
export function cameraToView(cam, width, height) {
  return {
    originX: width / 2 - cam.x * cam.zoom,
    originY: height / 2 - cam.y * cam.zoom,
    size: BASE_HEX_SIZE * cam.zoom,
  };
}

export function screenToWorld(cam, width, height, sx, sy) {
  return {
    x: cam.x + (sx - width / 2) / cam.zoom,
    y: cam.y + (sy - height / 2) / cam.zoom,
  };
}

export function worldToScreen(cam, width, height, wx, wy) {
  return {
    x: width / 2 + (wx - cam.x) * cam.zoom,
    y: height / 2 + (wy - cam.y) * cam.zoom,
  };
}

/** Move the view so content follows a drag of (dx, dy) screen pixels. */
export function panBy(cam, dx, dy) {
  return clampCamera({ ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom });
}

/**
 * Multiply zoom by `factor`, keeping the world point under screen
 * position (sx, sy) fixed (cursor- or pinch-anchored zoom).
 */
export function zoomAt(cam, factor, sx, sy, width, height) {
  if (!(factor > 0) || !Number.isFinite(factor)) return cam;
  const anchor = screenToWorld(cam, width, height, sx, sy);
  const zoom = Math.min(cam.maxZoom, Math.max(cam.minZoom, cam.zoom * factor));
  // Solve for the centre that puts `anchor` back under (sx, sy) at the new zoom.
  const x = anchor.x - (sx - width / 2) / zoom;
  const y = anchor.y - (sy - height / 2) / zoom;
  return clampCamera({ ...cam, zoom, x, y });
}

/** Centre the camera on a world point (follow-ready positioning). */
export function centerOn(cam, wx, wy) {
  return clampCamera({ ...cam, x: wx, y: wy });
}

/** Centre the camera on a hex. */
export function centerOnHex(cam, h) {
  const p = hexToPixel(h, BASE_HEX_SIZE);
  return centerOn(cam, p.x, p.y);
}

/**
 * World-space bounds of a hexagon-shaped grid of `radius` around (0,0),
 * suitable for `camera.bounds`. The camera centre may reach the outermost
 * hex centres, so the edge of the map can be brought to mid-screen but the
 * map can never be lost entirely.
 */
export function gridWorldBounds(radius) {
  const { width } = hexDimensions(BASE_HEX_SIZE);
  return {
    minX: -width * radius,
    maxX: width * radius,
    minY: -1.5 * BASE_HEX_SIZE * radius,
    maxY: 1.5 * BASE_HEX_SIZE * radius,
  };
}

/**
 * A comfortable starting zoom: about `hexesAcross` hexes across the shorter
 * viewport dimension, clamped to the camera's zoom bounds.
 */
export function initialZoom(width, height, { hexesAcross = 11, minZoom = 0.4, maxZoom = 2.5 } = {}) {
  const { width: hexW } = hexDimensions(BASE_HEX_SIZE);
  const zoom = Math.min(width, height) / (hexW * hexesAcross);
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}
