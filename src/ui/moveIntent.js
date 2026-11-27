/**
 * What a tap on the map means for movement. Pure; unit tested.
 *
 * Idle:
 *  - your own hex: inspect it (and clear any planned route);
 *  - a walkable neighbour: step there at once;
 *  - a farther walkable hex: plan a route and preview it;
 *  - the previewed destination again: travel the route;
 *  - impassable or unreachable hexes: explain why, nothing moves;
 *  - an unmapped hex (fog of war): say so; routes cross mapped hexes only;
 *  - off the map: clear.
 * While travelling, a tap first stops travel. Tapping yourself, the
 * destination, or empty space only stops; any other hex is then handled as
 * an idle tap (retargeting).
 */
import { hexDistance, hexEquals } from '../world/hex.js';
import { planRoute } from '../systems/movement.js';

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ destination: Hex, path: Hex[], cost: number }} RoutePreview
 * @typedef {{ kind: 'clear' }
 *   | { kind: 'here' }
 *   | { kind: 'step', to: Hex }
 *   | { kind: 'preview', preview: RoutePreview }
 *   | { kind: 'travel', preview: RoutePreview }
 *   | { kind: 'impassable', at: Hex }
 *   | { kind: 'unreachable', at: Hex }
 *   | { kind: 'unexplored', at: Hex }} TapAction
 *
 * @param {{ position: Hex, preview: RoutePreview | null, travelling: Hex | null,
 *   knows?: (h: Hex) => boolean }} state
 *   `travelling` is the current destination while a route is being walked;
 *   `knows` is map memory's isKnown (omitted: everything is mapped).
 * @param {Hex | null} tapped the map hex under the tap, or null if off the map
 * @returns {{ stop: boolean, action: TapAction | null }} `stop`: stop travel
 *   first; `action`: what to do next (null: nothing more).
 */
export function decideTap(world, state, tapped) {
  if (state.travelling) {
    const onlyStop = !tapped || hexEquals(tapped, state.position) || hexEquals(tapped, state.travelling);
    if (onlyStop) return { stop: true, action: null };
    return { stop: true, action: idleTap(world, { ...state, preview: null }, tapped) };
  }
  return { stop: false, action: idleTap(world, state, tapped) };
}

function idleTap(world, { position, preview, knows = null }, tapped) {
  if (!tapped || !world.has(tapped)) return { kind: 'clear' };
  if (hexEquals(tapped, position)) return { kind: 'here' };
  if (knows && !knows(tapped)) return { kind: 'unexplored', at: tapped };
  if (hexDistance(tapped, position) === 1) {
    return world.isWalkable(tapped) ? { kind: 'step', to: tapped } : { kind: 'impassable', at: tapped };
  }
  const route = planRoute(world, position, tapped, { knows });
  if (route.status === 'impassable') return { kind: 'impassable', at: tapped };
  if (route.status !== 'ok') return { kind: 'unreachable', at: tapped };
  const next = { destination: tapped, path: route.path, cost: route.cost };
  const confirm = preview && hexEquals(preview.destination, tapped);
  return { kind: confirm ? 'travel' : 'preview', preview: next };
}
