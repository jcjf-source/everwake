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
 *   S  start (grassland)      G  goal (grassland)   a..e  named grassland hexes
 */
import { TERRAIN } from '../../src/data/terrain.js';
import { hex, hexKey } from '../../src/world/hex.js';

const CODES = { '.': 'grassland', f: 'forest', d: 'denseForest', '~': 'shallowWater', M: 'mountains', W: 'deepWater' };

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
  const world = {
    has,
    tileAt,
    isWalkable: (h) => { const t = tileAt(h); return !!t && TERRAIN[t.terrain].walkable; },
    /** Change a tile (for "route became blocked" tests). */
    set(h, terrain) { tiles.set(hexKey(h), { q: h.q, r: h.r, terrain }); },
    cells: () => [...tiles.values()].map((t) => hex(t.q, t.r)),
  };
  return { world, marks, costOf: (h) => { const t = tileAt(h); return t ? TERRAIN[t.terrain].moveCost : Infinity; } };
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
