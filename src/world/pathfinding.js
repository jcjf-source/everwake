/**
 * Hex A* pathfinding.
 *
 * Pure and map-agnostic: the caller supplies `costOf(hex)`, the cost of
 * *entering* a hex. A cost that is not a finite number >= 1 (Infinity,
 * undefined, NaN…) means the hex is impassable; that also covers hexes
 * outside the map. The heuristic is hex distance × the cheapest possible
 * step cost, which never overestimates, so returned paths are optimal.
 *
 * Results are deterministic: ties in the open set are broken by lower
 * heuristic (straighter towards the goal) and then by insertion order, and
 * neighbours are expanded in fixed DIRECTIONS order.
 */
import { hexDistance, hexKey, hexNeighbors } from './hex.js';

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ found: true, path: Hex[], cost: number, expanded: number }
 *   | { found: false, reason: 'blocked' | 'unreachable' | 'limit', expanded: number }} PathResult
 */

const passable = (c) => typeof c === 'number' && c >= 1 && Number.isFinite(c);

/**
 * @param {Hex} start
 * @param {Hex} goal
 * @param {{
 *   costOf: (h: Hex) => number,
 *   minCost?: number,       // cheapest step cost on the map (heuristic scale), default 1
 *   maxExpanded?: number,   // give up after expanding this many nodes (reason 'limit')
 * }} opts
 * @returns {PathResult} `path` runs from start to goal inclusive; `cost`
 *   is the sum of entry costs of every hex after the start.
 */
export function findPath(start, goal, { costOf, minCost = 1, maxExpanded = Infinity }) {
  if (start.q === goal.q && start.r === goal.r) return { found: true, path: [start], cost: 0, expanded: 0 };
  if (!passable(costOf(goal))) return { found: false, reason: 'blocked', expanded: 0 };

  const startKey = hexKey(start);
  const goalKey = hexKey(goal);
  const g = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const nodes = new Map([[startKey, start]]);
  const closed = new Set();
  const heap = new MinHeap();
  let seq = 0;
  heap.push({ f: hexDistance(start, goal) * minCost, h: hexDistance(start, goal), seq: seq++, key: startKey });

  let expanded = 0;
  while (heap.size > 0) {
    const { key } = heap.pop();
    if (closed.has(key)) continue; // stale entry superseded by a cheaper one
    if (key === goalKey) return { found: true, path: rebuild(cameFrom, nodes, goalKey), cost: g.get(goalKey), expanded };
    closed.add(key);
    if (++expanded > maxExpanded) return { found: false, reason: 'limit', expanded };

    const current = nodes.get(key);
    const gCurrent = g.get(key);
    for (const n of hexNeighbors(current)) {
      const nk = hexKey(n);
      if (closed.has(nk)) continue;
      const step = costOf(n);
      if (!passable(step)) continue;
      const tentative = gCurrent + step;
      const known = g.get(nk);
      if (known !== undefined && tentative >= known) continue;
      g.set(nk, tentative);
      cameFrom.set(nk, key);
      nodes.set(nk, n);
      const h = hexDistance(n, goal);
      heap.push({ f: tentative + h * minCost, h, seq: seq++, key: nk });
    }
  }
  return { found: false, reason: 'unreachable', expanded };
}

function rebuild(cameFrom, nodes, goalKey) {
  const path = [];
  for (let k = goalKey; k !== undefined; k = cameFrom.get(k)) path.push(nodes.get(k));
  return path.reverse();
}

/** Total entry cost of a path (excluding its first hex); Infinity if any hex is impassable. */
export function pathCost(path, costOf) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const c = costOf(path[i]);
    if (!passable(c)) return Infinity;
    total += c;
  }
  return total;
}

/** Binary min-heap ordered by (f, h, seq). */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }

  static less(a, b) {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    return a.seq < b.seq;
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!MinHeap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && MinHeap.less(a[l], a[m])) m = l;
        if (r < a.length && MinHeap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
