/**
 * Procedural vector details drawn on top of the terrain fills: trees,
 * peaks, hill contours, pebbles, ripples, grass tufts, and the sanctuary.
 *
 * Each kind of mark is collected into a single path and filled or stroked
 * once per frame, so cost stays proportional to the visible tiles. All
 * jitter comes from coordinate hashes, so a hex always looks the same.
 */
import { hashCoords } from '../core/hash.js';
import { hexToScreen } from './gridView.js';

/** Below this on-screen hex size, details are skipped (they become noise). */
export const DETAIL_MIN_SIZE = 11;
/**
 * Below this size only a simplified set is drawn (one or two trees, plain
 * peaks), which keeps the zoomed-out overview, with thousands of hexes on
 * screen, as cheap as the plain grid.
 */
export const FULL_DETAIL_SIZE = 18;
/** Grass tufts are finer still. */
const TUFT_MIN_SIZE = 22;

// Fill paths are left unclosed on purpose: fill() closes subpaths implicitly,
// and closePath() on a Path2D with thousands of subpaths is slow in Chrome.

// Slot layouts in units of hex size (pointy-top hex spans about ±0.87 x, ±1 y).
const TREE_SLOTS = {
  forest: [[-0.34, 0.12], [0.3, 0.2], [0.0, -0.3]],
  denseForest: [[-0.4, 0.05], [0.0, 0.3], [0.38, 0.06], [-0.16, -0.36], [0.22, -0.32]],
};
const SIMPLE_TREE_SLOTS = {
  forest: [[0, 0.05]],
  denseForest: [[-0.25, 0.08], [0.25, 0.0]],
};
const PEBBLE_SLOTS = [[-0.3, 0.18], [0.28, -0.1], [0.02, 0.36], [-0.12, -0.3]];
const DOT_SLOTS = [[-0.36, -0.12], [0.18, -0.32], [0.32, 0.22], [-0.1, 0.34], [0.0, 0.0]];
const TUFT_SLOTS = [[-0.32, 0.22], [0.3, -0.06], [-0.05, -0.34]];

function jitter(q, r, i, salt, amount) {
  return (hashCoords(q * 7 + i, r * 13 - i, salt) - 0.5) * amount;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./gridView.js').GridView} view
 * @param {Array<import('../world/worldGen.js').Tile>} tiles visible tiles
 */
export function drawTerrainDetails(ctx, view, tiles) {
  const s = view.size;
  if (s < DETAIL_MIN_SIZE) return;
  const simple = s < FULL_DETAIL_SIZE;

  const trees = { forest: [], denseForest: [] };
  const peaks = [];
  // Finer marks, only drawn at full detail.
  const fine = { hills: [], rocky: [], shallowWater: [], deepWater: [], sand: [], grassland: [] };
  for (const t of tiles) {
    if (t.terrain === 'forest' || t.terrain === 'denseForest') trees[t.terrain].push(t);
    else if (t.terrain === 'mountains') peaks.push(t);
    else if (!simple) fine[t.terrain]?.push(t);
  }
  const hills = fine.hills;
  const pebbles = fine.rocky;
  const water = fine.shallowWater.concat(fine.deepWater);
  const sand = fine.sand;
  const grass = fine.grassland;

  // Conifers: a dark triangle per slot, then a lighter left flank.
  for (const kind of ['forest', 'denseForest']) {
    const list = trees[kind];
    if (!list.length) continue;
    const slots = (simple ? SIMPLE_TREE_SLOTS : TREE_SLOTS)[kind];
    const grow = simple ? 1.35 : 1;
    const w = s * (kind === 'denseForest' ? 0.2 : 0.22) * grow;
    const h = s * (kind === 'denseForest' ? 0.42 : 0.46) * grow;
    const dark = new Path2D();
    const light = new Path2D();
    for (const t of list) {
      const c = hexToScreen(view, t);
      slots.forEach(([sx, sy], i) => {
        const x = c.x + (sx + jitter(t.q, t.r, i, 11, 0.12)) * s;
        const y = c.y + (sy + jitter(t.q, t.r, i, 12, 0.1)) * s;
        const k = 0.85 + hashCoords(t.q + i, t.r, 13) * 0.3;
        dark.moveTo(x, y - h * k * 0.6);
        dark.lineTo(x + w * k, y + h * k * 0.4);
        dark.lineTo(x - w * k, y + h * k * 0.4);
        light.moveTo(x, y - h * k * 0.6);
        light.lineTo(x, y + h * k * 0.4);
        light.lineTo(x - w * k, y + h * k * 0.4);
      });
    }
    ctx.fillStyle = kind === 'denseForest' ? 'rgb(22,36,28)' : 'rgb(32,50,36)';
    ctx.fill(dark);
    ctx.fillStyle = kind === 'denseForest' ? 'rgba(80,110,84,0.35)' : 'rgba(100,130,96,0.35)';
    ctx.fill(light);
  }

  // Mountains: a peak with a lit west face, shaded east face, and snow cap.
  if (peaks.length) {
    const lit = new Path2D();
    const shade = new Path2D();
    const snow = new Path2D();
    for (const t of peaks) {
      const c = hexToScreen(view, t);
      const k = 0.85 + hashCoords(t.q, t.r, 21) * 0.3;
      const top = c.y - s * 0.55 * k;
      const base = c.y + s * 0.42;
      const half = s * 0.62;
      const px = c.x + jitter(t.q, t.r, 0, 22, 0.16) * s;
      lit.moveTo(px, top); lit.lineTo(px, base); lit.lineTo(c.x - half, base);
      shade.moveTo(px, top); shade.lineTo(c.x + half, base); shade.lineTo(px, base);
      const capY = top + (base - top) * 0.3;
      const capL = px + (c.x - half - px) * 0.3;
      const capR = px + (c.x + half - px) * 0.3;
      snow.moveTo(px, top); snow.lineTo(capR, capY); snow.lineTo(px + (capR - px) * 0.2, capY - s * 0.04);
      snow.lineTo(capL, capY);
    }
    ctx.fillStyle = 'rgb(138,138,130)';
    ctx.fill(lit);
    ctx.fillStyle = 'rgb(72,74,72)';
    ctx.fill(shade);
    ctx.fillStyle = 'rgba(222,220,210,0.85)';
    ctx.fill(snow);
  }

  // Hills: two soft contour arcs.
  if (hills.length) {
    const p = new Path2D();
    for (const t of hills) {
      const c = hexToScreen(view, t);
      const dx = jitter(t.q, t.r, 0, 31, 0.14) * s;
      p.moveTo(c.x - s * 0.55 + dx, c.y + s * 0.12);
      p.quadraticCurveTo(c.x - s * 0.22 + dx, c.y - s * 0.38, c.x + s * 0.1 + dx, c.y + s * 0.12);
      p.moveTo(c.x - s * 0.02 - dx, c.y + s * 0.42);
      p.quadraticCurveTo(c.x + s * 0.26 - dx, c.y + s * 0.02, c.x + s * 0.56 - dx, c.y + s * 0.42);
    }
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(48,48,34,0.55)';
    ctx.stroke(p);
  }

  // Rocky ground: a few pale pebbles.
  if (pebbles.length) {
    const p = new Path2D();
    for (const t of pebbles) {
      const c = hexToScreen(view, t);
      PEBBLE_SLOTS.forEach(([sx, sy], i) => {
        const x = c.x + (sx + jitter(t.q, t.r, i, 41, 0.14)) * s;
        const y = c.y + (sy + jitter(t.q, t.r, i, 42, 0.12)) * s;
        const rad = s * (0.06 + hashCoords(t.q, t.r + i, 43) * 0.05);
        p.moveTo(x + rad, y);
        p.ellipse(x, y, rad, rad * 0.7, 0, 0, Math.PI * 2);
      });
    }
    ctx.fillStyle = 'rgba(150,146,134,0.8)';
    ctx.fill(p);
  }

  // Water: short ripple lines.
  if (water.length) {
    const p = new Path2D();
    for (const t of water) {
      const c = hexToScreen(view, t);
      for (let i = 0; i < 2; i++) {
        const x = c.x + (i ? 0.18 : -0.22) * s + jitter(t.q, t.r, i, 51, 0.2) * s;
        const y = c.y + (i ? 0.24 : -0.18) * s;
        p.moveTo(x - s * 0.18, y);
        p.quadraticCurveTo(x, y - s * 0.08, x + s * 0.18, y);
      }
    }
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(150,176,180,0.28)';
    ctx.stroke(p);
  }

  // Sand: fine dots.
  if (sand.length) {
    const p = new Path2D();
    const rad = Math.max(0.6, s * 0.03);
    for (const t of sand) {
      const c = hexToScreen(view, t);
      DOT_SLOTS.forEach(([sx, sy], i) => {
        const x = c.x + (sx + jitter(t.q, t.r, i, 61, 0.16)) * s;
        const y = c.y + (sy + jitter(t.q, t.r, i, 62, 0.16)) * s;
        p.moveTo(x + rad, y);
        p.arc(x, y, rad, 0, Math.PI * 2);
      });
    }
    ctx.fillStyle = 'rgba(70,62,44,0.5)';
    ctx.fill(p);
  }

  // Grassland: small tufts when zoomed in.
  if (grass.length && s >= TUFT_MIN_SIZE) {
    const p = new Path2D();
    for (const t of grass) {
      const c = hexToScreen(view, t);
      TUFT_SLOTS.forEach(([sx, sy], i) => {
        if (hashCoords(t.q, t.r, 70 + i) < 0.35) return;
        const x = c.x + (sx + jitter(t.q, t.r, i, 71, 0.16)) * s;
        const y = c.y + (sy + jitter(t.q, t.r, i, 72, 0.16)) * s;
        const h = s * 0.12;
        p.moveTo(x - h * 0.6, y - h); p.lineTo(x, y);
        p.lineTo(x + h * 0.6, y - h);
        p.moveTo(x, y); p.lineTo(x, y - h * 1.2);
      });
    }
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(132,150,104,0.55)';
    ctx.stroke(p);
  }
}

/**
 * The sanctuary: a warm glow, a ring of standing stones, and a hearth.
 * Drawn at every zoom level so the start is always findable.
 */
export function drawSanctuary(ctx, view, h) {
  const c = hexToScreen(view, h);
  const s = view.size;

  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, s * 1.6);
  glow.addColorStop(0, 'rgba(214,170,90,0.45)');
  glow.addColorStop(1, 'rgba(214,170,90,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(c.x, c.y, s * 1.6, 0, Math.PI * 2);
  ctx.fill();

  if (s < DETAIL_MIN_SIZE) {
    // Small: a gold ring with a bright centre.
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(3, s * 0.45), 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(232,200,128,0.95)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(1.5, s * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(240,206,130)';
    ctx.fill();
    return;
  }

  // Standing stones around the hearth.
  const stones = new Path2D();
  const ring = s * 0.52;
  const sw = s * 0.11;
  const sh = s * 0.24;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    const x = c.x + Math.cos(a) * ring;
    const y = c.y + Math.sin(a) * ring * 0.8;
    stones.rect(x - sw / 2, y - sh, sw, sh);
  }
  ctx.fillStyle = 'rgb(176,170,150)';
  ctx.fill(stones);
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = 'rgba(30,30,26,0.7)';
  ctx.stroke(stones);

  // Hearth flame.
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - s * 0.3);
  ctx.quadraticCurveTo(c.x + s * 0.16, c.y - s * 0.04, c.x, c.y + s * 0.08);
  ctx.quadraticCurveTo(c.x - s * 0.16, c.y - s * 0.04, c.x, c.y - s * 0.3);
  ctx.fillStyle = 'rgb(236,190,104)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + s * 0.1, s * 0.2, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,44,30,0.9)';
  ctx.fill();
}
