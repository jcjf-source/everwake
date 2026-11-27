/**
 * Player movement rules: route planning and single validated steps.
 *
 * Simulation only (no rendering or DOM). `checkStep` is the rule for a single
 * one-hex step; the move action (src/core/actions.js) uses it, so every step,
 * single or part of a route, goes through the turn pipeline (src/core/game.js)
 * and costs one turn. Long routes are walked one move action at a time by the
 * travel controller (travel.js), so the player never teleports.
 *
 * Terrain `moveCost` weights route choice only (a road around a forest beats
 * pushing through it); every hex entered costs one turn.
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
 * With `avoid` (hexes held by enemies the player can see), routes go
 * around those hexes; they are planned around where enemies are now, and
 * each step is re-validated as it is walked.
 * @param {{ knows?: ((h: {q:number,r:number}) => boolean) | null,
 *   avoid?: ((h: {q:number,r:number}) => boolean) | null }} [opts]
 * @returns {{ status: 'here' }
 *   | { status: 'outside' }
 *   | { status: 'unexplored' }
 *   | { status: 'impassable' }
 *   | { status: 'unreachable' }
 *   | { status: 'ok', path: Array<{q:number,r:number}>, cost: number }}
 *   `path` excludes the starting hex, so `path.length` is the number of steps.
 */
export function planRoute(world, from, to, { knows = null, avoid = null } = {}) {
  if (!world.has(to)) return { status: 'outside' };
  if (hexDistance(from, to) === 0) return { status: 'here' };
  if (knows && !knows(to)) return { status: 'unexplored' };
  if (!world.isWalkable(to)) return { status: 'impassable' };
  const cost = moveCostFn(world);
  const costOf = (h) => ((knows && !knows(h)) || (avoid && avoid(h)) ? Infinity : cost(h));
  const result = findPath(from, to, { costOf });
  if (!result.found) return { status: 'unreachable' };
  return { status: 'ok', path: result.path.slice(1), cost: result.cost };
}

/**
 * Can the player step to `to`? It must be on the map, adjacent, and
 * walkable. Changes nothing.
 * @returns {{ ok: true } | { ok: false, reason: 'outside' | 'notAdjacent' | 'impassable' }}
 */
export function checkStep(player, world, to) {
  if (!world.has(to)) return { ok: false, reason: 'outside' };
  if (hexDistance(player.position, to) !== 1) return { ok: false, reason: 'notAdjacent' };
  if (!world.isWalkable(to)) return { ok: false, reason: 'impassable' };
  return { ok: true };
}
