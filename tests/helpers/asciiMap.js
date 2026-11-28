/**
 * Small hand-drawn maps for movement tests.
 *
 * Each string is one axial row r (top row r = 0); each character is the hex
 * at q = column index (spaces are ignored). So the map is an axial
 * parallelogram, which is fine for testing because neighbours follow axial
 * DIRECTIONS regardless of how the rows are drawn.
 *
 *   .  grassland (cost 1)     f  forest (2)      d  dense forest (3)
 *   ~  shallow water (3)      M  mountains       W  deep water   (impassable)
 *   ^  hills (2)              %  rocky ground (2)
 *   S  start (grassland)      G  goal (grassland)   a..e  named grassland hexes
 */
import { TERRAIN } from '../../src/data/terrain.js';
import { NODE_KINDS } from '../../src/data/resources.js';
import { hex, hexKey } from '../../src/world/hex.js';
import { createGame } from '../../src/core/game.js';
import { giveStride, PLENTY } from './stride.js';

const CODES = {
  '.': 'grassland', f: 'forest', d: 'denseForest', '~': 'shallowWater', M: 'mountains', W: 'deepWater', '^': 'hills', '%': 'rocky',
};

export function asciiWorld(rows) {
  const tiles = new Map();
  const marks = {};
  rows.forEach((line, r) => {
    [...line.replace(/\s+/g, '')].forEach((ch, q) => {
      let terrain = CODES[ch];
      if (!terrain) {
        if (!/^[A-Za-z]$/.test(ch)) throw new Error(`unknown map char ${ch}`);
        terrain = 'grassland';
        marks[ch] = hex(q, r);
      }
      tiles.set(hexKey(hex(q, r)), { q, r, terrain });
    });
  });
  const tileAt = (h) => tiles.get(hexKey(h)) ?? null;
  const has = (h) => !!h && tiles.has(hexKey(h));
  const nodes = new Map();
  const pois = new Map();
  const world = {
    seedNumber: 1,
    has,
    tileAt,
    isWalkable: (h) => { const t = tileAt(h); return !!t && TERRAIN[t.terrain].walkable; },
    /** Change a tile (for "route became blocked" tests). */
    set(h, terrain) { tiles.set(hexKey(h), { q: h.q, r: h.r, terrain }); },
    /** Hand-placed resource nodes (no nodes unless a test adds them). */
    resourceAt: (h) => nodes.get(hexKey(h)) ?? null,
    /** Place a node of `kind` (data/resources.js) holding `uses` gathers. */
    setNode(h, kind, uses) {
      nodes.set(hexKey(h), Object.freeze({ q: h.q, r: h.r, kind, resource: NODE_KINDS[kind].resource, uses }));
    },
    /** Hand-placed points of interest (none unless a test adds them). */
    poiAt: (h) => pois.get(hexKey(h)) ?? null,
    /** Place a POI of `type` (data/pois.js) holding `uses` uses. */
    setPoi(h, type, uses = 1, name = `Test ${type}`) {
      pois.set(hexKey(h), Object.freeze({ q: h.q, r: h.r, type, name, uses }));
    },
    cells: () => [...tiles.values()].map((t) => hex(t.q, t.r)),
  };
  return { world, marks, costOf: (h) => { const t = tileAt(h); return t ? TERRAIN[t.terrain].moveCost : Infinity; } };
}

/**
 * A game (core/game.js) on a hand-drawn map, starting on `S` (or `start`).
 * Map memory needs a radius: ascii maps sit at q, r ≥ 0, so 2 × the larger
 * side covers every hex. The pool starts with `stride` (default plenty, see
 * helpers/stride.js; pass 0 for the real, empty pool).
 */
export function asciiGame(rows, start = null, { stride = PLENTY } = {}) {
  const { world, marks } = asciiWorld(rows);
  const radius = 2 * Math.max(rows.length, ...rows.map((l) => l.replace(/\s+/g, '').length));
  const game = createGame({ ...world, sanctuary: start ?? marks.S, radius });
  if (stride > 0) giveStride(game, stride);
  return { game, world: game.world, marks };
}

/** Reference Dijkstra (no heuristic) over the same costs: cheapest total, or Infinity. */
export function dijkstraCost(start, goal, costOf, cells) {
  const dist = new Map(cells.map((c) => [hexKey(c), Infinity]));
  dist.set(hexKey(start), 0);
  const todo = new Set(cells.map(hexKey));
  const byKey = new Map(cells.map((c) => [hexKey(c), c]));
  while (todo.size) {
    let best = null;
    for (const k of todo) if (best === null || dist.get(k) < dist.get(best)) best = k;
    if (dist.get(best) === Infinity) break;
    todo.delete(best);
    if (best === hexKey(goal)) break;
    const c = byKey.get(best);
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const n = hex(c.q + dq, c.r + dr);
      const k = hexKey(n);
      if (!todo.has(k)) continue;
      const step = costOf(n);
      if (!Number.isFinite(step)) continue;
      const nd = dist.get(best) + step;
      if (nd < dist.get(k)) dist.set(k, nd);
    }
  }
  return dist.get(hexKey(goal)) ?? Infinity;
}
