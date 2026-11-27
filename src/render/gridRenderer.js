/**
 * Draws the terrain map under fog of war, the player and route overlays,
 * and the selection/hover/debug overlays.
 * Reads state only; never changes it.
 *
 * Fog (when `frame.fog` is given): unknown hexes are not drawn at all (the
 * dark background shows through, so hidden terrain cannot be inferred),
 * remembered hexes are drawn under a dim veil, and visible hexes in full.
 * Soft cloud banks (fogArt.js) blur the boundary between known and unknown.
 * Landmarks such as the sanctuary are drawn only once their hex is known.
 *
 * Only the cells passed in `frame.cells` (the visible subset) are drawn.
 * Terrain fills are batched into one path per palette colour, and details
 * into one path per mark type, so a frame costs a fixed number of fill calls
 * regardless of how many hexes are on screen.
 */
import { hexCorners, hexEquals } from '../world/hex.js';
import { hexToScreen } from './gridView.js';
import { TERRAIN_PALETTE, tilePaletteIndex } from './terrainStyle.js';
import { drawTerrainDetails, drawSanctuary } from './terrainArt.js';
import { drawStepRim, drawRoute, drawNoWayMarker, drawPlayer } from './entityArt.js';
import { FOG, canSee } from '../world/mapMemory.js';
import { drawFogEdge } from './fogArt.js';
import { drawResourceNodes, drawGatherTargets, NODE_MIN_SIZE } from './resourceArt.js';
import { drawPois, drawInteractTargets, POI_MIN_SIZE } from './poiArt.js';
import { drawEnemies } from './enemyArt.js';

/** Veil over remembered (seen before, not in sight) hexes. */
export const REMEMBERED_VEIL = 'rgba(14,20,22,0.58)';

/** Minimum on-screen hex size at which coordinate labels are legible. */
export const MIN_LABEL_SIZE = 15;

/** Corner offsets from a hex centre, flattened [x0,y0,x1,y1,…]. Computed once per size. */
function cornerOffsets(size) {
  const flat = new Float64Array(12);
  hexCorners(0, 0, size).forEach((p, i) => { flat[i * 2] = p.x; flat[i * 2 + 1] = p.y; });
  return flat;
}

/**
 * Add one hex to the current path. Batched terrain paths pass close=false
 * and return to the first corner with lineTo instead: closePath() on a path
 * with thousands of subpaths is slow in Chrome, and at a 1px outline the
 * missing corner join is invisible. Highlights use real closePath joins.
 */
function addHexPathFast(ctx, cx, cy, off, close = true) {
  ctx.moveTo(cx + off[0], cy + off[1]);
  ctx.lineTo(cx + off[2], cy + off[3]);
  ctx.lineTo(cx + off[4], cy + off[5]);
  ctx.lineTo(cx + off[6], cy + off[7]);
  ctx.lineTo(cx + off[8], cy + off[9]);
  ctx.lineTo(cx + off[10], cy + off[11]);
  if (close) ctx.closePath();
  else ctx.lineTo(cx + off[0], cy + off[1]);
}

function addHexPath(ctx, cx, cy, size) {
  addHexPathFast(ctx, cx, cy, cornerOffsets(size));
}

function traceHex(ctx, cx, cy, size) {
  ctx.beginPath();
  addHexPath(ctx, cx, cy, size);
}

/**
 * @param {CanvasRenderingContext2D} ctx context scaled to CSS pixels
 * @param {{
 *   width: number, height: number,
 *   view: import('./gridView.js').GridView,
 *   cells: Array<{q:number,r:number}>,
 *   has: (h: {q:number,r:number}) => boolean,
 *   tileAt: (h: {q:number,r:number}) => import('../world/worldGen.js').Tile,
 *   sanctuary: {q:number,r:number} | null,
 *   ui: { hovered: {q:number,r:number}|null, selected: {q:number,r:number}|null, showCoords: boolean },
 *   player?: {q:number,r:number} | null,
 *   stepRim?: Array<{q:number,r:number}>,
 *   route?: { path: Array<{q:number,r:number}>, mode: 'preview' | 'travel' } | null,
 *   noWay?: {q:number,r:number} | null,
 *   fog?: { stateAt: (h: {q:number,r:number}) => number, isKnown: Function, isVisible: Function } | null,
 *   nodeAt?: ((h: {q:number,r:number}) => object | null) | null,
 *   gatherable?: Array<{q:number,r:number}>,
 *   poiAt?: ((h: {q:number,r:number}) => object | null) | null,
 *   usable?: Array<{q:number,r:number}>,
 *   enemies?: Array<{ position: {q:number,r:number}, type: string, health: number, maxHealth: number, intent: string }>,
 * }} frame `fog` omitted: everything is drawn as visible. `nodeAt`: the
 *   resource node state at a hex (gathering.js nodeState), asked only for
 *   mapped hexes; `gatherable`: nodes in reach now (ringed). `poiAt` and
 *   `usable`: the same for points of interest (systems/pois.js poiState).
 *   `enemies`: enemies to draw (the caller passes only those in sight).
 */
export function drawGrid(ctx, frame) {
  const { width, height, view, cells, tileAt, sanctuary, ui } = frame;
  const { size } = view;

  // Background: dark slate with a soft glow at the viewport centre.
  const bg = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.7);
  bg.addColorStop(0, '#1e2b28');
  bg.addColorStop(1, '#0d1311');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Base cells, inset slightly so the gap reads as a subtle border.
  const inset = Math.max(0.5, Math.min(1.5, size * 0.03)); // capped so borders stay subtle up close
  const cellSize = size - inset;
  const off = cornerOffsets(cellSize);
  const outline = size >= 10; // at tiny sizes an outline is just noise
  const fog = frame.fog ?? null;
  const known = fog ? cells.filter((h) => fog.stateAt(h) !== FOG.UNKNOWN) : cells;
  const tiles = known.map(tileAt);
  const buckets = TERRAIN_PALETTE.map(() => []);
  for (const t of tiles) buckets[tilePaletteIndex(t)].push(t);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(10,14,12,0.16)';
  for (let i = 0; i < TERRAIN_PALETTE.length; i++) {
    if (buckets[i].length === 0) continue;
    ctx.beginPath();
    for (const h of buckets[i]) {
      const c = hexToScreen(view, h);
      addHexPathFast(ctx, c.x, c.y, off, false);
    }
    ctx.fillStyle = TERRAIN_PALETTE[i];
    ctx.fill();
    if (outline) ctx.stroke();
  }

  drawTerrainDetails(ctx, view, tiles);

  const showSanctuary = sanctuary && (!fog || canSee(fog, { at: sanctuary, kind: 'landmark' }));
  if (showSanctuary && isOnScreen(view, sanctuary, width, height)) drawSanctuary(ctx, view, sanctuary);

  // Resource nodes are landmarks: drawn once their hex is mapped (under the
  // remembered veil when out of sight).
  if (frame.nodeAt && size >= NODE_MIN_SIZE) {
    const nodes = [];
    for (const h of known) {
      const n = frame.nodeAt(h);
      if (n) nodes.push(n);
    }
    drawResourceNodes(ctx, view, nodes);
  }
  // Points of interest are landmarks too: shown once their hex is mapped.
  if (frame.poiAt && size >= POI_MIN_SIZE) {
    const pois = [];
    for (const h of known) {
      const p = frame.poiAt(h);
      if (p) pois.push(p);
    }
    drawPois(ctx, view, pois);
  }

  // Remembered terrain: one batched veil over every remembered hex.
  if (fog) {
    ctx.beginPath();
    let any = false;
    for (const h of known) {
      if (fog.stateAt(h) !== FOG.REMEMBERED) continue;
      const c = hexToScreen(view, h);
      addHexPathFast(ctx, c.x, c.y, off, false);
      any = true;
    }
    if (any) {
      ctx.fillStyle = REMEMBERED_VEIL;
      ctx.fill();
    }
    drawFogEdge(ctx, view, cells, fog.stateAt);
  }

  // Hexes the player can step to with one tap, and nodes / POIs they can use now.
  if (frame.stepRim) drawStepRim(ctx, view, frame.stepRim);
  if (frame.gatherable) drawGatherTargets(ctx, view, frame.gatherable);
  if (frame.usable) drawInteractTargets(ctx, view, frame.usable);

  // Hover.
  if (ui.hovered && !(ui.selected && hexEquals(ui.hovered, ui.selected))) {
    const c = hexToScreen(view, ui.hovered);
    traceHex(ctx, c.x, c.y, cellSize);
    ctx.fillStyle = 'rgba(228,220,198,0.10)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.strokeStyle = 'rgba(228,220,198,0.45)';
    ctx.stroke();
  }

  // Selection.
  if (ui.selected) {
    const c = hexToScreen(view, ui.selected);
    traceHex(ctx, c.x, c.y, cellSize);
    ctx.fillStyle = 'rgba(194,163,90,0.22)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.09);
    ctx.strokeStyle = 'rgba(214,183,110,0.95)';
    ctx.stroke();
  }

  // Route preview or the route being travelled, then a "no way" marker.
  if (frame.route && frame.player) drawRoute(ctx, view, frame.player, frame.route.path, frame.route.mode);
  if (frame.noWay) drawNoWayMarker(ctx, view, frame.noWay);
  if (frame.enemies) drawEnemies(ctx, view, frame.enemies.filter((e) => isOnScreen(view, e.position, width, height)));
  if (frame.player && isOnScreen(view, frame.player, width, height)) drawPlayer(ctx, view, frame.player);

  // Coordinate debug labels (only when hexes are big enough to read).
  if (ui.showCoords && size >= MIN_LABEL_SIZE) {
    const fontPx = Math.min(14, size * 0.36);
    ctx.font = `${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,14,12,0.75)'; // dark halo keeps labels legible on pale terrain
    for (const h of cells) {
      const c = hexToScreen(view, h);
      const isOrigin = h.q === 0 && h.r === 0;
      const label = `${h.q},${h.r}`;
      ctx.strokeText(label, c.x, c.y);
      ctx.fillStyle = isOrigin ? 'rgba(232,200,128,1)' : 'rgba(236,230,212,0.9)';
      ctx.fillText(label, c.x, c.y);
    }
  }

  // Soft vignette keeps the edges quiet.
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.4,
    width / 2, height / 2, Math.max(width, height) * 0.8,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function isOnScreen(view, h, width, height) {
  const c = hexToScreen(view, h);
  const m = view.size * 2;
  return c.x > -m && c.y > -m && c.x < width + m && c.y < height + m;
}
