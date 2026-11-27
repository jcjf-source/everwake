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
 *  - an impassable hex with a resource node: in reach if adjacent, else
 *    preview a route to a hex next to it, or say there is no way to it;
 *  - a hex with an enemy in sight: inspect it (nothing moves; routes go
 *    around enemies the player can see);
 *  - off the map: clear.
 * While travelling, a tap first stops travel. Tapping yourself, the
 * destination, or empty space only stops; any other hex is then handled as
 * an idle tap (retargeting).
 */
import { hexDistance, hexEquals } from '../world/hex.js';
import { planRoute } from '../systems/movement.js';
import { planApproach } from '../systems/gathering.js';

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ destination: Hex, path: Hex[], cost: number, target?: Hex }} RoutePreview
 *   `target`: a node the route goes next to (the route ends at `destination`).
 * @typedef {{ kind: 'clear' }
 *   | { kind: 'here' }
 *   | { kind: 'step', to: Hex }
 *   | { kind: 'preview', preview: RoutePreview }
 *   | { kind: 'travel', preview: RoutePreview }
 *   | { kind: 'impassable', at: Hex }
 *   | { kind: 'unreachable', at: Hex }
 *   | { kind: 'unexplored', at: Hex }
 *   | { kind: 'node', at: Hex }
 *   | { kind: 'approach', preview: RoutePreview }
 *   | { kind: 'blocked', at: Hex }
 *   | { kind: 'enemy', at: Hex }} TapAction
 *   Resource nodes on impassable hexes (stone on a mountain, fish in deep
 *   water): `node` it is in reach (inspect; gather with the Gather button);
 *   `approach` preview a route to a hex next to it (tap again to travel);
 *   `blocked` there is no mapped way to get next to it.
 *
 * @param {{ position: Hex, preview: RoutePreview | null, travelling: Hex | null,
 *   travelTarget?: Hex | null, knows?: (h: Hex) => boolean,
 *   nodeAt?: (h: Hex) => unknown, enemyAt?: (h: Hex) => unknown }} state
 *   `travelling` is the current destination while a route is being walked,
 *   and `travelTarget` the node it goes next to, if any;
 *   `knows` is map memory's isKnown (omitted: everything is mapped);
 *   `nodeAt` is truthy for a mapped hex with a node that still has gathers;
 *   `enemyAt` is truthy for a hex with an enemy the player can see.
 * @param {Hex | null} tapped the map hex under the tap, or null if off the map
 * @returns {{ stop: boolean, action: TapAction | null }} `stop`: stop travel
 *   first; `action`: what to do next (null: nothing more).
 */
export function decideTap(world, state, tapped) {
  if (state.travelling) {
    const onlyStop = !tapped || hexEquals(tapped, state.position) || hexEquals(tapped, state.travelling)
      || (state.travelTarget && hexEquals(tapped, state.travelTarget));
    if (onlyStop) return { stop: true, action: null };
    return { stop: true, action: idleTap(world, { ...state, preview: null }, tapped) };
  }
  return { stop: false, action: idleTap(world, state, tapped) };
}

function idleTap(world, { position, preview, knows = null, nodeAt = null, enemyAt = null }, tapped) {
  if (!tapped || !world.has(tapped)) return { kind: 'clear' };
  if (hexEquals(tapped, position)) return { kind: 'here' };
  if (knows && !knows(tapped)) return { kind: 'unexplored', at: tapped };
  if (enemyAt && enemyAt(tapped)) return { kind: 'enemy', at: tapped };
  // A node on a hex nobody can stand on is gathered from next to it.
  if (nodeAt && !world.isWalkable(tapped) && nodeAt(tapped)) {
    if (hexDistance(tapped, position) === 1) return { kind: 'node', at: tapped };
    const near = planApproach(world, position, tapped, { knows });
    if (!near) return { kind: 'blocked', at: tapped };
    const next = { destination: near.destination, target: tapped, path: near.path, cost: near.cost };
    const confirm = preview && preview.target && hexEquals(preview.target, tapped);
    return { kind: confirm ? 'travel' : 'approach', preview: next };
  }
  if (hexDistance(tapped, position) === 1) {
    return world.isWalkable(tapped) ? { kind: 'step', to: tapped } : { kind: 'impassable', at: tapped };
  }
  const route = planRoute(world, position, tapped, { knows, avoid: enemyAt });
  if (route.status === 'impassable') return { kind: 'impassable', at: tapped };
  if (route.status !== 'ok') return { kind: 'unreachable', at: tapped };
  const next = { destination: tapped, path: route.path, cost: route.cost };
  const confirm = preview && hexEquals(preview.destination, tapped);
  return { kind: confirm ? 'travel' : 'preview', preview: next };
}
