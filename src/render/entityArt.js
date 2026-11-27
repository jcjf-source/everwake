/**
 * Procedural art for the player and movement overlays: the reachable-step
 * rim, the route preview, destination and "no way" markers, and the player
 * figure. Reads state only.
 */
import { hexCorners } from '../world/hex.js';
import { hexToScreen } from './gridView.js';

/**
 * Faint rim inside each hex the player can step to with one tap.
 * @param {Array<{q:number,r:number}>} hexes
 */
export function drawStepRim(ctx, view, hexes) {
  if (hexes.length === 0 || view.size < 8) return;
  const s = view.size * 0.86;
  ctx.beginPath();
  for (const h of hexes) {
    const c = hexToScreen(view, h);
    const pts = hexCorners(c.x, c.y, s);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
  ctx.lineWidth = Math.max(1, view.size * 0.045);
  ctx.strokeStyle = 'rgba(228,220,198,0.28)';
  ctx.stroke();
}

/**
 * A route from `from` through `path` (excluding `from`).
 * @param {'preview' | 'travel'} mode preview is pale parchment; travel is gold
 */
export function drawRoute(ctx, view, from, path, mode) {
  if (path.length === 0) return;
  const s = view.size;
  const colour = mode === 'travel' ? 'rgba(232,200,128,0.95)' : 'rgba(236,230,212,0.9)';
  const pts = [from, ...path].map((h) => hexToScreen(view, h));

  // Dark underlay keeps the line legible on pale sand and grass.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(3, s * 0.16);
  ctx.strokeStyle = 'rgba(12,16,14,0.45)';
  ctx.stroke();
  ctx.setLineDash([Math.max(2, s * 0.14), Math.max(3, s * 0.2)]);
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.setLineDash([]);

  // A dot in each hex the route enters (the destination gets a ring instead).
  if (s >= 9) {
    ctx.beginPath();
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.moveTo(pts[i].x + s * 0.09, pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, s * 0.09, 0, Math.PI * 2);
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }

  const end = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(end.x, end.y, Math.max(4, s * 0.34), 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, s * 0.14);
  ctx.strokeStyle = 'rgba(12,16,14,0.45)';
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.strokeStyle = colour;
  ctx.stroke();
}

/** A muted red cross on a hex the player cannot reach. */
export function drawNoWayMarker(ctx, view, h) {
  const c = hexToScreen(view, h);
  const r = Math.max(4, view.size * 0.3);
  ctx.beginPath();
  ctx.moveTo(c.x - r, c.y - r);
  ctx.lineTo(c.x + r, c.y + r);
  ctx.moveTo(c.x + r, c.y - r);
  ctx.lineTo(c.x - r, c.y + r);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, view.size * 0.16);
  ctx.strokeStyle = 'rgba(12,16,14,0.55)';
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, view.size * 0.08);
  ctx.strokeStyle = 'rgba(214,120,100,0.95)';
  ctx.stroke();
}

/**
 * The player: a hooded wanderer carrying a lantern. Simplified to a ringed
 * token when hexes are small, so the player is findable at every zoom.
 */
export function drawPlayer(ctx, view, h) {
  const c = hexToScreen(view, h);
  const s = view.size;

  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, s * 1.1);
  glow.addColorStop(0, 'rgba(236,214,160,0.35)');
  glow.addColorStop(1, 'rgba(236,214,160,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(c.x, c.y, s * 1.1, 0, Math.PI * 2);
  ctx.fill();

  if (s < 14) {
    const r = Math.max(3.5, s * 0.42);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(236,230,212)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    ctx.strokeStyle = 'rgb(22,30,27)';
    ctx.stroke();
    return;
  }

  const u = s * 0.5; // figure scale
  const baseY = c.y + u * 0.62;

  // Ground shadow.
  ctx.beginPath();
  ctx.ellipse(c.x, baseY, u * 0.62, u * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,10,9,0.45)';
  ctx.fill();

  // Cloak: a tall rounded cone.
  ctx.beginPath();
  ctx.moveTo(c.x - u * 0.5, baseY);
  ctx.quadraticCurveTo(c.x - u * 0.46, c.y - u * 0.3, c.x - u * 0.06, c.y - u * 0.78);
  ctx.lineTo(c.x + u * 0.06, c.y - u * 0.78);
  ctx.quadraticCurveTo(c.x + u * 0.46, c.y - u * 0.3, c.x + u * 0.5, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgb(52,66,60)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, s * 0.05);
  ctx.strokeStyle = 'rgb(226,218,196)';
  ctx.stroke();

  // Hood opening.
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - u * 0.46, u * 0.17, u * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(18,22,20)';
  ctx.fill();

  // Lantern on the right, with a warm glow.
  const lx = c.x + u * 0.62;
  const ly = c.y + u * 0.05;
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, u * 0.5);
  lg.addColorStop(0, 'rgba(250,210,120,0.8)');
  lg.addColorStop(1, 'rgba(250,210,120,0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(lx, ly, u * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, u * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(252,220,140)';
  ctx.fill();
}
