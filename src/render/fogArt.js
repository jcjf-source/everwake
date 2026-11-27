/**
 * Soft fog edge: banks of cloud along the boundary between mapped and
 * unknown hexes, so the explored area fades into mist instead of ending in
 * hard hexagon edges.
 *
 * Cloud puffs are stamped from a few pre-rendered sprites (built once on an
 * offscreen canvas), placed over unknown hexes that border known ones, and
 * nudged toward the known side so they spill about half a hex over it. A
 * fainter second ring gives depth. Every puff's offset, size and sprite
 * come from coordinate hashes, so the clouds are stable while panning;
 * nothing animates (rendering stays on demand).
 *
 * Only *which hexes are known* decides where clouds go, so they reveal
 * nothing about hidden terrain.
 */
import { DIRECTIONS } from '../world/hex.js';
import { hashCoords } from '../core/hash.js';
import { hexToScreen } from './gridView.js';
import { FOG } from '../world/mapMemory.js';

/** Below this hex size clouds are skipped (they would be noise). */
export const FOG_EDGE_MIN_SIZE = 6;

const SPRITE_PX = 128;
const SPRITE_VARIANTS = 4;
/** Mist tint: cool grey-green, a little lighter than the dark background. */
const MIST = [108, 124, 120];

/**
 * Unknown hexes next to known ones (`edge`, with the summed direction
 * toward their known neighbours) and unknown hexes next to those (`outer`).
 * Work is driven from the known cells, so a mostly unexplored screen (the
 * usual case when zoomed out) stays cheap. Pure; unit tested.
 * @param {Array<{q:number,r:number}>} cells candidate hexes (on screen)
 * @param {(h: {q:number,r:number}) => number} stateAt FOG state
 */
export function fogFrontier(cells, stateAt) {
  const key = (q, r) => q * 65536 + r;
  const onScreen = new Set();
  const known = [];
  for (const h of cells) {
    onScreen.add(key(h.q, h.r));
    if (stateAt(h) !== FOG.UNKNOWN) known.push(h);
  }
  /** @type {Map<number, { hex: {q:number,r:number}, dq: number, dr: number, known: number }>} */
  const edgeByKey = new Map();
  for (const k of known) {
    for (const d of DIRECTIONS) {
      const q = k.q + d.q;
      const r = k.r + d.r;
      const id = key(q, r);
      if (!onScreen.has(id)) continue;
      let e = edgeByKey.get(id);
      if (!e) {
        if (stateAt({ q, r }) !== FOG.UNKNOWN) continue;
        e = { hex: { q, r }, dq: 0, dr: 0, known: 0 };
        edgeByKey.set(id, e);
      }
      // Direction from the unknown hex back toward this known neighbour.
      e.dq -= d.q;
      e.dr -= d.r;
      e.known++;
    }
  }
  const edge = [...edgeByKey.values()];
  const outerKeys = new Set();
  const outer = [];
  for (const e of edge) {
    for (const d of DIRECTIONS) {
      const q = e.hex.q + d.q;
      const r = e.hex.r + d.r;
      const id = key(q, r);
      if (!onScreen.has(id) || edgeByKey.has(id) || outerKeys.has(id)) continue;
      if (stateAt({ q, r }) !== FOG.UNKNOWN) continue;
      outerKeys.add(id);
      outer.push({ q, r });
    }
  }
  return { edge, outer };
}

let sprites; // undefined: not built yet; null: no canvas API (Node tests)

function makeCanvas(px) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(px, px);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    return c;
  }
  return null;
}

/** A few cloud sprites: clusters of soft radial blobs. */
function cloudSprites() {
  if (sprites !== undefined) return sprites;
  sprites = [];
  for (let v = 0; v < SPRITE_VARIANTS; v++) {
    const canvas = makeCanvas(SPRITE_PX);
    if (!canvas) { sprites = null; return sprites; }
    const g = canvas.getContext('2d');
    const c = SPRITE_PX / 2;
    const blobs = 6;
    for (let i = 0; i < blobs; i++) {
      // Blobs cluster near the centre; outer ones are smaller.
      const a = hashCoords(v, i, 1) * Math.PI * 2;
      const dist = (i === 0 ? 0 : 0.1 + hashCoords(v, i, 2) * 0.16) * SPRITE_PX;
      const x = c + Math.cos(a) * dist;
      const y = c + Math.sin(a) * dist * 0.75; // a little flatter than tall
      const rad = SPRITE_PX * (i === 0 ? 0.42 : 0.22 + hashCoords(v, i, 3) * 0.1);
      const alpha = i === 0 ? 0.42 : 0.24 + hashCoords(v, i, 4) * 0.14;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${MIST[0]},${MIST[1]},${MIST[2]},${alpha})`);
      grad.addColorStop(0.4, `rgba(${MIST[0]},${MIST[1]},${MIST[2]},${alpha * 0.7})`);
      grad.addColorStop(1, `rgba(${MIST[0]},${MIST[1]},${MIST[2]},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    sprites.push(canvas);
  }
  return sprites;
}

/**
 * Draw the cloud edge for the on-screen cells.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./gridView.js').GridView} view
 * @param {Array<{q:number,r:number}>} cells
 * @param {(h: {q:number,r:number}) => number} stateAt
 */
export function drawFogEdge(ctx, view, cells, stateAt) {
  const s = view.size;
  if (s < FOG_EDGE_MIN_SIZE) return;
  const art = cloudSprites();
  if (!art) return;
  const { edge, outer } = fogFrontier(cells, stateAt);
  const sqrt3 = Math.sqrt(3);
  const prevAlpha = ctx.globalAlpha;

  const stamp = (x, y, radius, alpha, q, r, salt) => {
    const sprite = art[Math.floor(hashCoords(q, r, salt) * art.length)];
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  };

  // Deeper fog first, so the edge banks sit on top of it.
  for (const h of outer) {
    const c = hexToScreen(view, h);
    const j = (k) => (hashCoords(h.q, h.r, k) - 0.5) * s * 0.5;
    stamp(c.x + j(31), c.y + j(32), s * (1.6 + hashCoords(h.q, h.r, 33) * 0.4), 0.28, h.q, h.r, 34);
  }

  for (const { hex: h, dq, dr, known } of edge) {
    const c = hexToScreen(view, h);
    // Screen direction toward the known neighbours (pointy-top axial -> pixel).
    let vx = sqrt3 * (dq + dr / 2);
    let vy = 1.5 * dr;
    const len = Math.hypot(vx, vy);
    if (len > 1e-9) { vx /= len; vy /= len; } else { vx = 0; vy = 0; }
    const j = (k) => (hashCoords(h.q, h.r, k) - 0.5) * s * 0.35;
    // Main bank: pushed toward the mapped side so it spills over the edge.
    const push = s * (0.35 + Math.min(known, 3) * 0.05);
    stamp(c.x + vx * push + j(41), c.y + vy * push + j(42), s * (1.35 + hashCoords(h.q, h.r, 43) * 0.35), 0.62, h.q, h.r, 44);
    // A second, looser puff behind it.
    stamp(c.x - vx * s * 0.3 + j(45), c.y - vy * s * 0.3 + j(46), s * (1.5 + hashCoords(h.q, h.r, 47) * 0.3), 0.4, h.q, h.r, 48);
  }

  ctx.globalAlpha = prevAlpha;
}
