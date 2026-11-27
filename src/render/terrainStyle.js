/**
 * Terrain presentation: base colours and shading. Gameplay properties live
 * in src/data/terrain.js; this file is purely visual.
 */
import { TERRAIN_IDS } from '../data/terrain.js';
import { hashCoords } from '../core/hash.js';

/** Muted base colour per terrain id (moss, slate, earth, desaturated blue). */
export const TERRAIN_COLORS = Object.freeze({
  deepWater: [30, 48, 60],
  shallowWater: [52, 78, 86],
  sand: [128, 118, 88],
  grassland: [84, 100, 70],
  forest: [56, 78, 58],
  denseForest: [38, 56, 44],
  hills: [100, 100, 74],
  rocky: [104, 100, 90],
  mountains: [112, 112, 108],
});

/** Brightness steps; the middle one is the base colour. */
export const SHADES = Object.freeze([0.84, 0.92, 1, 1.08, 1.16]);

/** One CSS colour per (terrain, shade) bucket, in TERRAIN_IDS order. */
export const TERRAIN_PALETTE = Object.freeze(
  TERRAIN_IDS.flatMap((id) => {
    const [r, g, b] = TERRAIN_COLORS[id];
    return SHADES.map((s) => `rgb(${Math.min(255, Math.round(r * s))},${Math.min(255, Math.round(g * s))},${Math.min(255, Math.round(b * s))})`);
  }),
);

const TERRAIN_INDEX = Object.freeze(Object.fromEntries(TERRAIN_IDS.map((id, i) => [id, i])));

/**
 * Palette bucket for a tile: terrain colour, shaded by elevation (relief)
 * plus a little per-hex variation. Deterministic per tile.
 */
export function tilePaletteIndex(tile) {
  const relief = (tile.elevation - 0.5) * 5; // roughly -2.5..2.5
  const jitter = hashCoords(tile.q, tile.r, 3) - 0.5;
  const shade = Math.max(0, Math.min(SHADES.length - 1, Math.round(2 + relief * 0.6 + jitter)));
  return TERRAIN_INDEX[tile.terrain] * SHADES.length + shade;
}
