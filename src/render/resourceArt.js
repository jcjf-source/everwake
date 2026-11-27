/**
 * Procedural marks for resource nodes, and the ring on nodes the player can
 * gather now. Reads state only.
 *
 * Each node is a small glyph on a dark disc in the lower-right of its hex
 * (clear of the player figure at the centre): crossed logs (wood), stones,
 * herb sprigs, berries, or a fish. A spent node is a faint empty ring.
 * Marks are batched by colour, one fill or stroke per colour per frame.
 * Below DOT_SIZE hexes nodes are coloured dots; below MIN_SIZE nothing.
 */
import { hexToScreen } from './gridView.js';

export const NODE_MIN_SIZE = 6;
const DOT_SIZE = 12;

/** Glyph centre offset within the hex, in units of hex size. */
const OFFSET = { x: 0.34, y: 0.4 };

/** Resource colours (dots at small zoom, and the glyph's main colour). */
export const RESOURCE_COLOURS = Object.freeze({
  wood: 'rgb(168,120,76)',
  stone: 'rgb(178,180,172)',
  herbs: 'rgb(150,196,110)',
  food: 'rgb(206,92,84)',
});

/** Glyph centre for a node hex. */
export function nodeMarkCentre(view, h) {
  const c = hexToScreen(view, h);
  return { x: c.x + view.size * OFFSET.x, y: c.y + view.size * OFFSET.y };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./gridView.js').GridView} view
 * @param {Array<{ at: {q:number,r:number}, node: { kind: string, resource: string }, left: number }>} nodes
 */
export function drawResourceNodes(ctx, view, nodes) {
  const s = view.size;
  if (s < NODE_MIN_SIZE || nodes.length === 0) return;
  const live = nodes.filter((n) => n.left > 0);
  const spent = nodes.filter((n) => n.left <= 0);

  if (s < DOT_SIZE) {
    const r = Math.max(1.6, s * 0.16);
    for (const res of Object.keys(RESOURCE_COLOURS)) {
      const list = live.filter((n) => n.node.resource === res);
      if (!list.length) continue;
      ctx.beginPath();
      for (const n of list) {
        const c = nodeMarkCentre(view, n.at);
        ctx.moveTo(c.x + r, c.y);
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = RESOURCE_COLOURS[res];
      ctx.fill();
    }
    return;
  }

  const u = s * 0.2; // glyph unit
  const centres = (list) => list.map((n) => ({ n, c: nodeMarkCentre(view, n.at) }));

  // Spent: faint empty ring only.
  if (spent.length) {
    ctx.beginPath();
    for (const { c } of centres(spent)) {
      ctx.moveTo(c.x + u * 0.8, c.y);
      ctx.arc(c.x, c.y, u * 0.8, 0, Math.PI * 2);
    }
    ctx.setLineDash([Math.max(1.5, u * 0.3), Math.max(1.5, u * 0.3)]);
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.strokeStyle = 'rgba(214,208,190,0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!live.length) return;

  const all = centres(live);
  // Backdrop discs keep glyphs legible on any terrain.
  ctx.beginPath();
  for (const { c } of all) {
    ctx.moveTo(c.x + u * 1.15, c.y);
    ctx.arc(c.x, c.y, u * 1.15, 0, Math.PI * 2);
  }
  ctx.fillStyle = 'rgba(12,16,14,0.55)';
  ctx.fill();

  const kind = (k) => all.filter(({ n }) => n.node.kind === k);
  ctx.lineCap = 'round';

  // Deadfall: two crossed logs with pale cut ends.
  const wood = kind('deadfall');
  if (wood.length) {
    ctx.beginPath();
    for (const { c } of wood) {
      ctx.moveTo(c.x - u * 0.7, c.y + u * 0.35);
      ctx.lineTo(c.x + u * 0.7, c.y - u * 0.2);
      ctx.moveTo(c.x - u * 0.6, c.y - u * 0.3);
      ctx.lineTo(c.x + u * 0.65, c.y + u * 0.4);
    }
    ctx.lineWidth = u * 0.42;
    ctx.strokeStyle = RESOURCE_COLOURS.wood;
    ctx.stroke();
    ctx.beginPath();
    for (const { c } of wood) {
      ctx.moveTo(c.x + u * 0.7 + u * 0.13, c.y - u * 0.2);
      ctx.arc(c.x + u * 0.7, c.y - u * 0.2, u * 0.13, 0, Math.PI * 2);
      ctx.moveTo(c.x + u * 0.65 + u * 0.13, c.y + u * 0.4);
      ctx.arc(c.x + u * 0.65, c.y + u * 0.4, u * 0.13, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgb(226,200,150)';
    ctx.fill();
  }

  // Loose stone: three rounded stones.
  const stone = kind('looseStone');
  if (stone.length) {
    ctx.beginPath();
    for (const { c } of stone) {
      for (const [dx, dy, rx, ry] of [[-0.38, 0.22, 0.42, 0.32], [0.36, 0.26, 0.38, 0.3], [0.0, -0.3, 0.4, 0.32]]) {
        ctx.moveTo(c.x + dx * u + rx * u, c.y + dy * u);
        ctx.ellipse(c.x + dx * u, c.y + dy * u, rx * u, ry * u, 0, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = RESOURCE_COLOURS.stone;
    ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.12);
    ctx.strokeStyle = 'rgba(40,44,42,0.9)';
    ctx.stroke();
  }

  // Herb patch: three sprigs with pale flowers.
  const herbs = kind('herbPatch');
  if (herbs.length) {
    ctx.beginPath();
    for (const { c } of herbs) {
      const base = { x: c.x, y: c.y + u * 0.7 };
      for (const [tx, ty] of [[-0.55, -0.45], [0.0, -0.7], [0.55, -0.45]]) {
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(c.x + tx * u * 0.4, c.y, c.x + tx * u, c.y + ty * u);
      }
    }
    ctx.lineWidth = Math.max(1, u * 0.2);
    ctx.strokeStyle = RESOURCE_COLOURS.herbs;
    ctx.stroke();
    ctx.beginPath();
    for (const { c } of herbs) {
      for (const [tx, ty] of [[-0.55, -0.45], [0.0, -0.7], [0.55, -0.45]]) {
        ctx.moveTo(c.x + tx * u + u * 0.17, c.y + ty * u);
        ctx.arc(c.x + tx * u, c.y + ty * u, u * 0.17, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = 'rgb(206,190,232)';
    ctx.fill();
  }

  // Berry bushes: a leafy mound with red berries.
  const berries = kind('berryBushes');
  if (berries.length) {
    ctx.beginPath();
    for (const { c } of berries) {
      ctx.moveTo(c.x + u * 0.8, c.y + u * 0.2);
      ctx.ellipse(c.x, c.y + u * 0.2, u * 0.8, u * 0.55, 0, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgb(74,112,70)';
    ctx.fill();
    ctx.beginPath();
    for (const { c } of berries) {
      for (const [dx, dy] of [[-0.35, 0.0], [0.15, -0.2], [0.4, 0.25], [-0.05, 0.38]]) {
        ctx.moveTo(c.x + dx * u + u * 0.18, c.y + dy * u);
        ctx.arc(c.x + dx * u, c.y + dy * u, u * 0.18, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = RESOURCE_COLOURS.food;
    ctx.fill();
  }

  // Fish shoal: a silver fish over a ripple.
  const fish = kind('fishShoal');
  if (fish.length) {
    ctx.beginPath();
    for (const { c } of fish) {
      ctx.moveTo(c.x + u * 0.45, c.y);
      ctx.ellipse(c.x - u * 0.1, c.y, u * 0.55, u * 0.28, 0, 0, Math.PI * 2);
      ctx.moveTo(c.x + u * 0.35, c.y);
      ctx.lineTo(c.x + u * 0.8, c.y - u * 0.3);
      ctx.lineTo(c.x + u * 0.8, c.y + u * 0.3);
    }
    ctx.fillStyle = 'rgb(200,212,218)';
    ctx.fill();
    ctx.beginPath();
    for (const { c } of fish) {
      ctx.moveTo(c.x - u * 0.8, c.y + u * 0.62);
      ctx.quadraticCurveTo(c.x, c.y + u * 0.42, c.x + u * 0.8, c.y + u * 0.62);
    }
    ctx.lineWidth = Math.max(1, u * 0.14);
    ctx.strokeStyle = 'rgba(200,212,218,0.7)';
    ctx.stroke();
  }
}

/**
 * Gold ring round each node the player can gather from where they stand.
 * @param {Array<{q:number,r:number}>} hexes
 */
export function drawGatherTargets(ctx, view, hexes) {
  const s = view.size;
  if (s < NODE_MIN_SIZE || hexes.length === 0) return;
  const r = s < DOT_SIZE ? Math.max(3.5, s * 0.3) : s * 0.2 * 1.4;
  ctx.beginPath();
  for (const h of hexes) {
    const c = nodeMarkCentre(view, h);
    ctx.moveTo(c.x + r, c.y);
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  }
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.strokeStyle = 'rgba(232,200,128,0.95)';
  ctx.stroke();
}
