/**
 * Player movement rules: route planning and single validated steps.
 *
 * Simulation only (no rendering or DOM). The only state change is
 * `tryStep`, which moves the player exactly one hex after validating it;
 * a rejected step changes nothing and costs no action. Long routes are
 * walked one `tryStep` at a time by the travel controller (travel.js), so
 * the player never teleports.
 *
 * Terrain `moveCost` weights route choice (a road around a forest beats
 * pushing through it). Each hex entered currently counts as one action; how
 * move cost maps onto turns is decided with the turn system (Task 06).
 */
import { TERRAIN } from '../data/terrain.js';
import { hexDistance } from '../world/hex.js';
import { findPath } from '../world/pathfinding.js';

/** Cost of entering a hex of this world (Infinity if impassable or off the map). */
export function moveCostFn(world) {
  return (h) => {
    const t = world.tileAt(h);
    return t ? TERRAIN[t.terrain].moveCost : Infinity;
  };
}

/**
 * Plan a route from `from` to `to`.
 *
 * With `knows` (map memory's isKnown), routes cross only hexes the player
 * has mapped, and an unmapped destination is 'unexplored'. Planning then
 * never reads hidden terrain, so a preview cannot leak what fog conceals.
 * @param {{ knows?: ((h: {q:number,r:number}) => boolean) | null }} [opts]
 * @returns {{ status: 'here' }
 *   | { status: 'outside' }
 *   | { status: 'unexplored' }
 *   | { status: 'impassable' }
 *   | { status: 'unreachable' }
 *   | { status: 'ok', path: Array<{q:number,r:number}>, cost: number }}
 *   `path` excludes the starting hex, so `path.length` is the number of steps.
 */
export function planRoute(world, from, to, { knows = null } = {}) {
  if (!world.has(to)) return { status: 'outside' };
  if (hexDistance(from, to) === 0) return { status: 'here' };
  if (knows && !knows(to)) return { status: 'unexplored' };
  if (!world.isWalkable(to)) return { status: 'impassable' };
  const cost = moveCostFn(world);
  const costOf = knows ? (h) => (knows(h) ? cost(h) : Infinity) : cost;
  const result = findPath(from, to, { costOf });
  if (!result.found) return { status: 'unreachable' };
  return { status: 'ok', path: result.path.slice(1), cost: result.cost };
}

/**
 * Move the player one hex. Validated: the target must be on the map,
 * adjacent, and walkable. On success the player's position changes and one
 * movement action is counted; on failure nothing changes.
 * @returns {{ ok: true } | { ok: false, reason: 'outside' | 'notAdjacent' | 'impassable' }}
 */
export function tryStep(player, world, to) {
  if (!world.has(to)) return { ok: false, reason: 'outside' };
  if (hexDistance(player.position, to) !== 1) return { ok: false, reason: 'notAdjacent' };
  if (!world.isWalkable(to)) return { ok: false, reason: 'impassable' };
  player.position = { q: to.q, r: to.r };
  player.moves += 1;
  return { ok: true };
}
