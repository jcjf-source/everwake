/**
 * Procedural art for enemies: one silhouette per archetype (a lean grey
 * wolf, a heavy brown boar with pale tusks, a bone-white skeleton), a health
 * bar above it, and an intent ring around its hex:
 *  - amber: hunting you (approach), red: about to strike (attack / charge),
 *    dashed grey: heading back; none while it has not noticed you.
 * Below a 14px hex an enemy is a type-coloured token with its ring; below
 * 4px nothing is drawn. Reads state only.
 *
 * Enemies are mobile entities: the caller passes only those on visible hexes
 * (mapMemory.canSee with kind 'mobile').
 */
import { hexCorners } from '../world/hex.js';
import { hexToScreen } from './gridView.js';

/** Smallest on-screen hex size at which enemies are drawn at all. */
export const ENEMY_MIN_SIZE = 4;

/** Body colour per archetype (also the zoomed-out token colour). */
export const ENEMY_COLOURS = Object.freeze({
  wolf: 'rgb(132,140,146)',
  boar: 'rgb(116,82,58)',
  skeleton: 'rgb(222,214,192)',
});

const INTENT_RING = Object.freeze({
  approach: { colour: 'rgba(226,160,82,0.95)', dash: false },
  charge: { colour: 'rgba(222,92,78,0.98)', dash: false },
  attack: { colour: 'rgba(222,92,78,0.98)', dash: false },
  return: { colour: 'rgba(170,176,170,0.7)', dash: true },
});

const OUTLINE = 'rgb(20,24,22)';

/**
 * @param {Array<{ position: {q:number,r:number}, type: string, health: number, maxHealth: number,
 *   intent: 'idle' | 'approach' | 'charge' | 'attack' | 'return' }>} enemies
 */
export function drawEnemies(ctx, view, enemies) {
  const s = view.size;
  if (enemies.length === 0 || s < ENEMY_MIN_SIZE) return;
  for (const e of enemies) {
    const c = hexToScreen(view, e.position);
    drawIntentRing(ctx, c, s, e.intent);
    if (s < 14) drawToken(ctx, c, s, e.type);
    else if (e.type === 'wolf') drawWolf(ctx, c, s);
    else if (e.type === 'boar') drawBoar(ctx, c, s);
    else drawSkeleton(ctx, c, s);
    if (s >= 10) drawHealthBar(ctx, c, s, e.health / e.maxHealth);
  }
}

function drawIntentRing(ctx, c, s, intent) {
  const ring = INTENT_RING[intent];
  if (!ring) return;
  const pts = hexCorners(c.x, c.y, s * 0.82);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.setLineDash(ring.dash ? [Math.max(2, s * 0.12), Math.max(2, s * 0.12)] : []);
  ctx.lineWidth = Math.max(3, s * 0.13);
  ctx.strokeStyle = 'rgba(12,16,14,0.5)';
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.strokeStyle = ring.colour;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawToken(ctx, c, s, type) {
  const r = Math.max(2.5, s * 0.38);
  ctx.beginPath();
  if (type === 'wolf') { // wedge
    ctx.moveTo(c.x, c.y - r);
    ctx.lineTo(c.x + r, c.y + r * 0.8);
    ctx.lineTo(c.x - r, c.y + r * 0.8);
    ctx.closePath();
  } else if (type === 'boar') { // block
    ctx.rect(c.x - r, c.y - r * 0.75, r * 2, r * 1.5);
  } else { // diamond
    ctx.moveTo(c.x, c.y - r);
    ctx.lineTo(c.x + r * 0.8, c.y);
    ctx.lineTo(c.x, c.y + r);
    ctx.lineTo(c.x - r * 0.8, c.y);
    ctx.closePath();
  }
  ctx.fillStyle = ENEMY_COLOURS[type];
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function shadow(ctx, x, y, w) {
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,10,9,0.45)';
  ctx.fill();
}

function finish(ctx, s, fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

/** A lean wolf in profile facing left: long body, raised pointed ears, low tail. */
function drawWolf(ctx, c, s) {
  const u = s * 0.5;
  const base = c.y + u * 0.55;
  shadow(ctx, c.x, base, u * 0.75);
  ctx.beginPath();
  ctx.moveTo(c.x - u * 0.82, c.y - u * 0.1); // snout
  ctx.lineTo(c.x - u * 0.52, c.y - u * 0.34);
  ctx.lineTo(c.x - u * 0.46, c.y - u * 0.66); // ear
  ctx.lineTo(c.x - u * 0.32, c.y - u * 0.36);
  ctx.quadraticCurveTo(c.x, c.y - u * 0.38, c.x + u * 0.5, c.y - u * 0.26); // back
  ctx.lineTo(c.x + u * 0.92, c.y - u * 0.02); // tail
  ctx.lineTo(c.x + u * 0.56, c.y + u * 0.02);
  ctx.lineTo(c.x + u * 0.5, base); // hind leg
  ctx.lineTo(c.x + u * 0.34, base);
  ctx.lineTo(c.x + u * 0.3, c.y + u * 0.16);
  ctx.lineTo(c.x - u * 0.24, c.y + u * 0.16);
  ctx.lineTo(c.x - u * 0.3, base); // fore leg
  ctx.lineTo(c.x - u * 0.46, base);
  ctx.lineTo(c.x - u * 0.44, c.y + u * 0.02);
  ctx.lineTo(c.x - u * 0.62, c.y - u * 0.02);
  ctx.closePath();
  finish(ctx, s, ENEMY_COLOURS.wolf);
  // Eye.
  ctx.beginPath();
  ctx.arc(c.x - u * 0.5, c.y - u * 0.24, Math.max(0.8, u * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(236,206,120)';
  ctx.fill();
}

/** A heavy boar facing left: humped back, short legs, pale tusks. */
function drawBoar(ctx, c, s) {
  const u = s * 0.5;
  const base = c.y + u * 0.55;
  shadow(ctx, c.x, base, u * 0.8);
  ctx.beginPath();
  ctx.moveTo(c.x - u * 0.84, c.y + u * 0.06); // snout
  ctx.lineTo(c.x - u * 0.8, c.y - u * 0.18);
  ctx.quadraticCurveTo(c.x - u * 0.4, c.y - u * 0.7, c.x + u * 0.1, c.y - u * 0.56); // hump
  ctx.quadraticCurveTo(c.x + u * 0.7, c.y - u * 0.5, c.x + u * 0.78, c.y);
  ctx.lineTo(c.x + u * 0.66, c.y + u * 0.28);
  ctx.lineTo(c.x + u * 0.6, base);
  ctx.lineTo(c.x + u * 0.38, base);
  ctx.lineTo(c.x + u * 0.36, c.y + u * 0.3);
  ctx.lineTo(c.x - u * 0.3, c.y + u * 0.3);
  ctx.lineTo(c.x - u * 0.34, base);
  ctx.lineTo(c.x - u * 0.56, base);
  ctx.lineTo(c.x - u * 0.56, c.y + u * 0.2);
  ctx.closePath();
  finish(ctx, s, ENEMY_COLOURS.boar);
  // Bristles along the back.
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = c.x - u * 0.34 + i * u * 0.2;
    const y = c.y - u * 0.56 + Math.abs(i - 1.3) * u * 0.06;
    ctx.moveTo(x, y);
    ctx.lineTo(x + u * 0.06, y - u * 0.14);
  }
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Tusk.
  ctx.beginPath();
  ctx.moveTo(c.x - u * 0.7, c.y + u * 0.04);
  ctx.quadraticCurveTo(c.x - u * 0.86, c.y - u * 0.1, c.x - u * 0.74, c.y - u * 0.3);
  ctx.lineWidth = Math.max(1.2, s * 0.06);
  ctx.strokeStyle = 'rgb(238,230,208)';
  ctx.stroke();
}

/** A standing skeleton: skull with dark sockets, ribcage, thin limbs. */
function drawSkeleton(ctx, c, s) {
  const u = s * 0.5;
  const base = c.y + u * 0.62;
  shadow(ctx, c.x, base, u * 0.5);
  const bone = ENEMY_COLOURS.skeleton;
  // Limbs and spine.
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - u * 0.34);
  ctx.lineTo(c.x, c.y + u * 0.2);
  ctx.moveTo(c.x, c.y + u * 0.2);
  ctx.lineTo(c.x - u * 0.2, base);
  ctx.moveTo(c.x, c.y + u * 0.2);
  ctx.lineTo(c.x + u * 0.2, base);
  ctx.moveTo(c.x - u * 0.34, c.y - u * 0.26);
  ctx.lineTo(c.x - u * 0.44, c.y + u * 0.2);
  ctx.moveTo(c.x + u * 0.34, c.y - u * 0.26);
  ctx.lineTo(c.x + u * 0.5, c.y + u * 0.12);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2.5, s * 0.11);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = Math.max(1.2, s * 0.06);
  ctx.strokeStyle = bone;
  ctx.stroke();
  // Ribcage.
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - u * 0.1, u * 0.3, u * 0.24, 0, 0, Math.PI * 2);
  finish(ctx, s, bone);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const y = c.y - u * 0.2 + i * u * 0.1;
    ctx.moveTo(c.x - u * 0.2, y);
    ctx.lineTo(c.x + u * 0.2, y);
  }
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  ctx.strokeStyle = 'rgb(60,58,52)';
  ctx.stroke();
  // Skull.
  ctx.beginPath();
  ctx.arc(c.x, c.y - u * 0.56, u * 0.22, 0, Math.PI * 2);
  finish(ctx, s, bone);
  ctx.beginPath();
  ctx.arc(c.x - u * 0.08, c.y - u * 0.58, u * 0.06, 0, Math.PI * 2);
  ctx.arc(c.x + u * 0.08, c.y - u * 0.58, u * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(30,22,20)';
  ctx.fill();
}

/** A slim bar above the figure: dark track, muted red fill. */
function drawHealthBar(ctx, c, s, fraction) {
  const w = s * 0.8;
  const h = Math.max(2, s * 0.08);
  const x = c.x - w / 2;
  const y = c.y - s * 0.66;
  ctx.fillStyle = 'rgba(12,16,14,0.8)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = 'rgb(196,84,70)';
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, fraction)), h);
}
