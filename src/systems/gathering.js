/**
 * Gathering rules: what node is where (baseline plus world changes), what is
 * in reach, whether a gather is allowed, and what it does.
 *
 * A node can be gathered from the hex it is on or any neighbouring hex
 * (GATHER_REACH = 1), so stone on a mountain or fish in deep water is
 * gathered from the shore or the foothills. Each gather is one `gather`
 * action (src/core/actions.js), one turn, and takes up to the node's
 * `yield` units; a node with no gathers left is spent and stays spent: the
 * count lives in the persistent world changes, not the generated world.
 *
 * Simulation only (no DOM).
 */
import { NODE_KINDS } from '../data/resources.js';
import { hexDistance, hexNeighbor, DIRECTIONS } from '../world/hex.js';
import { planRoute } from './movement.js';
import { addItem } from './inventory.js';
import { effectsOf } from '../data/upgrades.js';

/** Hexes away from a node that the player may gather it from. */
export const GATHER_REACH = 1;

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ at: Hex, node: object, def: object, left: number }} NodeState
 */

/**
 * The node at `h` as it is now, or null if there is none. Ignores fog: the
 * UI asks only about mapped hexes.
 * @returns {NodeState | null}
 */
export function nodeState(game, h) {
  const node = game.world.resourceAt ? game.world.resourceAt(h) : null;
  if (!node) return null;
  const left = Math.max(0, node.uses - game.changes.gathersTaken(h));
  return { at: { q: node.q, r: node.r }, node, def: NODE_KINDS[node.kind], left };
}

/**
 * May the player gather the node at `at` now? Changes nothing.
 * Reasons are checked in this order, so nothing about an unmapped hex leaks.
 * @returns {{ ok: true, state: NodeState }
 *   | { ok: false, reason: 'outside' | 'unexplored' | 'noNode' | 'tooFar' | 'depleted' }}
 */
export function checkGather(game, at) {
  if (!game.world.has(at)) return { ok: false, reason: 'outside' };
  if (!game.memory.isKnown(at)) return { ok: false, reason: 'unexplored' };
  const state = nodeState(game, at);
  if (!state) return { ok: false, reason: 'noNode' };
  if (hexDistance(game.player.position, at) > GATHER_REACH) return { ok: false, reason: 'tooFar' };
  if (state.left <= 0) return { ok: false, reason: 'depleted' };
  return { ok: true, state };
}

/**
 * Take one gather from the node at `at` (already validated): record it in
 * the world changes and add the yield to the player's inventory.
 * @returns {{ type: 'gathered', at: Hex, kind: string, resource: string, amount: number, left: number, total: number }}
 */
export function gatherFrom(game, at) {
  const { node, def } = nodeState(game, at);
  const amount = def.yield + effectsOf(game).gather; // Scavenger (Task 12)
  game.changes.recordGather(at, 1);
  const total = addItem(game.player.inventory, node.resource, amount);
  const left = nodeState(game, at).left;
  return { type: 'gathered', at: { q: at.q, r: at.r }, kind: node.kind, resource: node.resource, amount, left, total };
}

/**
 * Nodes the player can gather right now, the own hex first, then the
 * neighbours in DIRECTIONS order (E, NE, NW, W, SW, SE).
 * @returns {Array<NodeState & { direction: number | null }>} `direction`:
 *   index into DIRECTIONS, or null for the player's own hex.
 */
export function gatherOptions(game) {
  const out = [];
  const here = game.player.position;
  const candidates = [{ h: here, direction: null }, ...DIRECTIONS.map((_, i) => ({ h: hexNeighbor(here, i), direction: i }))];
  for (const { h, direction } of candidates) {
    if (!checkGather(game, h).ok) continue;
    out.push({ ...nodeState(game, h), direction });
  }
  return out;
}

/**
 * The cheapest route to a hex from which `target` can be gathered, for a
 * node the player cannot stand on (mountains, deep water). Tries every
 * walkable, mapped neighbour of `target`; ties go to DIRECTIONS order.
 * @param {{ knows?: (h: Hex) => boolean }} [opts]
 * @returns {{ destination: Hex, path: Hex[], cost: number } | null} null: no
 *   way to get next to it.
 */
export function planApproach(world, from, target, { knows = null } = {}) {
  let best = null;
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const n = hexNeighbor(target, i);
    if (!world.isWalkable(n) || (knows && !knows(n))) continue;
    if (hexDistance(n, from) === 0) return { destination: n, path: [], cost: 0 };
    const r = planRoute(world, from, n, { knows });
    if (r.status !== 'ok') continue;
    if (!best || r.cost < best.cost || (r.cost === best.cost && r.path.length < best.path.length)) {
      best = { destination: n, path: r.path, cost: r.cost };
    }
  }
  return best;
}
