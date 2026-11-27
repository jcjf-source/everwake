/**
 * Procedural marks for points of interest, and the ring on POIs the player
 * can use now. Reads state only.
 *
 * Each POI is a glyph on a dark disc in the upper-left of its hex
 * (clear of the player figure at the centre and of resource glyphs in the
 * lower-right): broken pillars (ruins), a tent (camp), a chest, a carved
 * stele with a pale rune (shrine), or a dark arch in rock (cave). A POI
 * with uses left carries a small gold glint; a used-up one is drawn dim
 * (an opened chest shows its lid up, a read shrine's rune is dark).
 * Below GLYPH_SIZE hexes POIs are diamonds in their type colour; below
 * POI_MIN_SIZE nothing is drawn.
 */
import { hexToScreen } from './gridView.js';

export const POI_MIN_SIZE = 4;
const GLYPH_SIZE = 18;

/** Glyph centre offset within the hex, in units of hex size. */
const OFFSET = { x: -0.42, y: -0.2 };

/** Type colours (diamonds at small zoom, legend keys). */
export const POI_COLOURS = Object.freeze({
  ruins: 'rgb(200,190,164)',
  camp: 'rgb(176,138,92)',
  chest: 'rgb(214,176,96)',
  shrine: 'rgb(160,214,206)',
  cave: 'rgb(132,124,116)',
});

/** Glyph centre for a POI hex. */
export function poiMarkCentre(view, h) {
  const c = hexToScreen(view, h);
  return { x: c.x + view.size * OFFSET.x, y: c.y + view.size * OFFSET.y };
}

const OUTLINE = 'rgba(24,26,24,0.9)';

function ruins(ctx, c, u) {
  ctx.beginPath();
  ctx.rect(c.x - 0.95 * u, c.y + 0.55 * u, 1.9 * u, 0.32 * u); // footing
  ctx.rect(c.x - 0.8 * u, c.y - 0.75 * u, 0.36 * u, 1.3 * u); // tall pillar
  ctx.rect(c.x - 0.18 * u, c.y - 0.15 * u, 0.36 * u, 0.7 * u); // broken stump
  ctx.rect(c.x + 0.44 * u, c.y - 0.5 * u, 0.36 * u, 1.05 * u); // pillar
  ctx.rect(c.x - 0.9 * u, c.y - 0.98 * u, 0.95 * u, 0.26 * u); // fallen-off lintel
  ctx.fillStyle = POI_COLOURS.ruins;
  ctx.fill();
  ctx.stroke();
}

function camp(ctx, c, u) {
  ctx.beginPath();
  ctx.moveTo(c.x - 1.0 * u, c.y + 0.75 * u);
  ctx.lineTo(c.x, c.y - 0.85 * u);
  ctx.lineTo(c.x + 1.0 * u, c.y + 0.75 * u);
  ctx.closePath();
  ctx.fillStyle = POI_COLOURS.camp;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // door flap
  ctx.moveTo(c.x - 0.3 * u, c.y + 0.75 * u);
  ctx.lineTo(c.x, c.y - 0.05 * u);
  ctx.lineTo(c.x + 0.3 * u, c.y + 0.75 * u);
  ctx.closePath();
  ctx.fillStyle = 'rgb(54,40,28)';
  ctx.fill();
  ctx.beginPath(); // crossed poles
  ctx.moveTo(c.x - 0.3 * u, c.y - 1.15 * u);
  ctx.lineTo(c.x + 0.12 * u, c.y - 0.6 * u);
  ctx.moveTo(c.x + 0.3 * u, c.y - 1.15 * u);
  ctx.lineTo(c.x - 0.12 * u, c.y - 0.6 * u);
  ctx.stroke();
}

function chest(ctx, c, u, open) {
  ctx.beginPath();
  ctx.rect(c.x - 0.85 * u, c.y - 0.1 * u, 1.7 * u, 0.85 * u);
  ctx.fillStyle = 'rgb(128,88,54)';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (open) {
    // Lid thrown back, dark inside.
    ctx.moveTo(c.x - 0.85 * u, c.y - 0.1 * u);
    ctx.lineTo(c.x + 0.85 * u, c.y - 0.1 * u);
    ctx.lineTo(c.x + 0.65 * u, c.y - 0.85 * u);
    ctx.lineTo(c.x - 0.65 * u, c.y - 0.85 * u);
    ctx.closePath();
    ctx.fillStyle = 'rgb(96,66,42)';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(c.x - 0.7 * u, c.y - 0.05 * u, 1.4 * u, 0.22 * u);
    ctx.fillStyle = 'rgb(28,20,14)';
    ctx.fill();
    return;
  }
  ctx.moveTo(c.x - 0.85 * u, c.y - 0.1 * u);
  ctx.lineTo(c.x - 0.85 * u, c.y - 0.45 * u);
  ctx.quadraticCurveTo(c.x, c.y - 0.95 * u, c.x + 0.85 * u, c.y - 0.45 * u);
  ctx.lineTo(c.x + 0.85 * u, c.y - 0.1 * u);
  ctx.closePath();
  ctx.fillStyle = 'rgb(150,104,62)';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // hasp
  ctx.rect(c.x - 0.14 * u, c.y - 0.3 * u, 0.28 * u, 0.4 * u);
  ctx.fillStyle = POI_COLOURS.chest;
  ctx.fill();
}

function shrine(ctx, c, u, lit) {
  ctx.beginPath();
  ctx.rect(c.x - 0.8 * u, c.y + 0.55 * u, 1.6 * u, 0.32 * u); // base
  ctx.moveTo(c.x - 0.45 * u, c.y + 0.6 * u);
  ctx.lineTo(c.x - 0.45 * u, c.y - 0.45 * u);
  ctx.arc(c.x, c.y - 0.45 * u, 0.45 * u, Math.PI, 0);
  ctx.lineTo(c.x + 0.45 * u, c.y + 0.6 * u);
  ctx.closePath();
  ctx.fillStyle = 'rgb(146,156,152)';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // rune
  ctx.arc(c.x, c.y - 0.2 * u, 0.2 * u, 0, Math.PI * 2);
  ctx.fillStyle = lit ? POI_COLOURS.shrine : 'rgb(70,78,76)';
  ctx.fill();
}

function cave(ctx, c, u) {
  ctx.beginPath();
  ctx.moveTo(c.x - 1.05 * u, c.y + 0.8 * u);
  ctx.quadraticCurveTo(c.x - 0.95 * u, c.y - 0.95 * u, c.x, c.y - 0.95 * u);
  ctx.quadraticCurveTo(c.x + 0.95 * u, c.y - 0.95 * u, c.x + 1.05 * u, c.y + 0.8 * u);
  ctx.closePath();
  ctx.fillStyle = POI_COLOURS.cave;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x - 0.45 * u, c.y + 0.8 * u);
  ctx.lineTo(c.x - 0.45 * u, c.y + 0.1 * u);
  ctx.arc(c.x, c.y + 0.1 * u, 0.45 * u, Math.PI, 0);
  ctx.lineTo(c.x + 0.45 * u, c.y + 0.8 * u);
  ctx.closePath();
  ctx.fillStyle = 'rgb(14,12,12)';
  ctx.fill();
}

/** Small four-point gold glint: something here is still to be found. */
function glint(ctx, x, y, r) {
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.3, y - r * 0.3);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.3, y + r * 0.3);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.3, y + r * 0.3);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.3, y - r * 0.3);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./gridView.js').GridView} view
 * @param {Array<{ at: {q:number,r:number}, poi: { type: string }, left: number }>} pois POI states (systems/pois.js)
 */
export function drawPois(ctx, view, pois) {
  const s = view.size;
  if (s < POI_MIN_SIZE || pois.length === 0) return;

  if (s < GLYPH_SIZE) {
    const r = Math.max(3.5, s * 0.36);
    for (const p of pois) {
      const c = poiMarkCentre(view, p.at);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - r);
      ctx.lineTo(c.x + r * 0.8, c.y);
      ctx.lineTo(c.x, c.y + r);
      ctx.lineTo(c.x - r * 0.8, c.y);
      ctx.closePath();
      ctx.globalAlpha = p.left > 0 ? 1 : 0.5;
      ctx.fillStyle = POI_COLOURS[p.poi.type];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  const u = s * 0.21; // glyph unit
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of pois) {
    const c = poiMarkCentre(view, p.at);
    const live = p.left > 0;
    ctx.beginPath();
    ctx.arc(c.x, c.y, u * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,16,14,0.6)';
    ctx.fill();

    ctx.globalAlpha = live ? 1 : 0.55;
    ctx.lineWidth = Math.max(1, u * 0.14);
    ctx.strokeStyle = OUTLINE;
    switch (p.poi.type) {
      case 'ruins': ruins(ctx, c, u); break;
      case 'camp': camp(ctx, c, u); break;
      case 'chest': chest(ctx, c, u, !live); break;
      case 'shrine': shrine(ctx, c, u, live); break;
      case 'cave': cave(ctx, c, u); break;
    }
    ctx.globalAlpha = 1;
    if (live) {
      ctx.beginPath();
      glint(ctx, c.x + u * 1.0, c.y - u * 0.95, u * 0.42);
      ctx.fillStyle = 'rgb(240,212,140)';
      ctx.fill();
    }
  }
}

/**
 * Gold ring round each POI the player can use from where they stand.
 * @param {Array<{q:number,r:number}>} hexes
 */
export function drawInteractTargets(ctx, view, hexes) {
  const s = view.size;
  if (s < POI_MIN_SIZE || hexes.length === 0) return;
  const r = s < GLYPH_SIZE ? Math.max(4, s * 0.42) : s * 0.21 * 1.55;
  ctx.beginPath();
  for (const h of hexes) {
    const c = poiMarkCentre(view, h);
    ctx.moveTo(c.x + r, c.y);
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  }
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.strokeStyle = 'rgba(232,200,128,0.95)';
  ctx.stroke();
}
