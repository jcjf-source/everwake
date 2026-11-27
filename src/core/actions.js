/**
 * Game actions: what the player can do, how each is validated, what it
 * changes, and how many turns it costs.
 *
 * An action is a plain object `{ type, ...params }`. Every definition has:
 *  - `cost`: turns taken when it succeeds (an integer ≥ 1);
 *  - `validate(game, action)`: `{ ok: true }` or `{ ok: false, reason }`.
 *    It must not change anything, so an invalid action costs nothing;
 *  - `apply(game, action)`: the player's own effect, run only after a
 *    successful validation. It may return `{ events }` (plain data, see
 *    game.js), which come first in the turn's events.
 * The turn pipeline (game.js) runs them; nothing else should call `apply`.
 *
 * Inspecting a hex, planning or previewing a route, panning, zooming and
 * opening the map are not actions: they change only UI state and never take
 * a turn.
 *
 * Movement costs one turn per hex entered, whatever the terrain. Terrain
 * `moveCost` only weights route choice (decided in Task 06: the design says
 * moving one hex costs one turn, and path movement one turn per hex).
 */
import { checkStep } from '../systems/movement.js';
import { checkGather, gatherFrom } from '../systems/gathering.js';

/** @typedef {{ q: number, r: number }} Hex */

const isHex = (h) => !!h && Number.isInteger(h.q) && Number.isInteger(h.r);

export const ACTIONS = Object.freeze({
  /** Step to an adjacent walkable hex: `{ type: 'move', to }`. */
  move: Object.freeze({
    cost: 1,
    validate(game, action) {
      if (!isHex(action.to)) return { ok: false, reason: 'badTarget' };
      return checkStep(game.player, game.world, action.to);
    },
    apply(game, action) {
      game.player.position = { q: action.to.q, r: action.to.r };
    },
  }),
  /**
   * Gather from the resource node at `at` (own hex or a neighbour):
   * `{ type: 'gather', at }`. Takes one gather from the node and adds its
   * yield to the inventory; the depletion is a persistent world change.
   */
  gather: Object.freeze({
    cost: 1,
    validate(game, action) {
      if (!isHex(action.at)) return { ok: false, reason: 'badTarget' };
      const v = checkGather(game, action.at);
      return v.ok ? { ok: true } : v;
    },
    apply(game, action) {
      return { events: [gatherFrom(game, action.at)] };
    },
  }),
  /** Stay put and let a turn pass: `{ type: 'wait' }`. */
  wait: Object.freeze({
    cost: 1,
    validate: () => ({ ok: true }),
    apply() {},
  }),
});

/**
 * Validate an action without changing anything.
 * @returns {{ ok: true, def: object } | { ok: false, reason: string }}
 */
export function validateAction(game, action) {
  if (!action || typeof action !== 'object') return { ok: false, reason: 'badAction' };
  const def = Object.hasOwn(ACTIONS, action.type) ? ACTIONS[action.type] : null;
  if (!def) return { ok: false, reason: 'unknownAction' };
  const v = def.validate(game, action);
  return v.ok ? { ok: true, def } : { ok: false, reason: v.reason };
}
