/**
 * Text for resource nodes, gathering and the inventory line. Pure; unit
 * tested, and mirrored by the browser check (tools/browser/check-world.mjs).
 */
import { RESOURCES } from '../data/resources.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => s[0].toLowerCase() + s.slice(1);

/** Screen arrows for DIRECTIONS (E, NE, NW, W, SW, SE; pointy-top). */
export const DIRECTION_ARROWS = Object.freeze(['→', '↗', '↖', '←', '↙', '↘']);
export const DIRECTION_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

/**
 * "Deadfall (wood) · 2 gathers left" or "Deadfall (wood) · picked clean".
 * @param {{ def: { name: string }, node: { resource: string }, left: number }} s node state (gathering.js)
 */
export function describeNode(s) {
  const what = `${s.def.name} (${lower(RESOURCES[s.node.resource].name)})`;
  return s.left > 0 ? `${what} · ${plural(s.left, 'gather', 'gathers')} left` : `${what} · picked clean`;
}

/** Suffix for a readout about a hex: "" or " · <node>". */
export const nodeNote = (s) => (s ? ` · ${describeNode(s)}` : '');

/** A node next to the player on a hex they cannot enter. */
export const describeInReach = (label, s) => `${label} · ${describeNode(s)} · in reach: tap Gather`;

/** Preview of a route to a hex next to a node. */
export const describeApproach = (label, s, steps, cost) =>
  `Route next to ${label} · ${describeNode(s)} · ${plural(steps, 'step', 'steps')}, route cost ${cost} · tap it again to travel`;

/** A node with no mapped way to get next to it. */
export const describeNodeBlocked = (label, s) =>
  `${label} · ${describeNode(s)} · blocked: no route to a hex next to it`;

/** Readout after a gather: "Gathered 2 wood from deadfall · 1 gather left". */
export function describeGathered(e, def) {
  const what = `${e.amount} ${lower(RESOURCES[e.resource].name)}`;
  const rest = e.left > 0 ? `${plural(e.left, 'gather', 'gathers')} left` : `${lower(def.name)} is spent`;
  return `Gathered ${what} from ${lower(def.name)} · ${rest}`;
}

/** Why a gather was refused (no turn passes). */
export function describeGatherRefused(reason, label) {
  switch (reason) {
    case 'tooFar': return `${label} · too far to gather: stand on it or next to it`;
    case 'depleted': return `${label} · picked clean, nothing left to gather`;
    case 'noNode': return `${label} · nothing to gather here`;
    case 'unexplored': return `${label} · not on your map yet`;
    default: return `${label} · cannot gather (${reason})`;
  }
}

/** Gather button text and accessible name for one option (gathering.js gatherOptions). */
export function gatherButton(o) {
  const res = lower(RESOURCES[o.node.resource].name);
  const where = o.direction === null ? 'here' : DIRECTION_ARROWS[o.direction];
  const whereLong = o.direction === null ? 'here' : `to the ${DIRECTION_NAMES[o.direction]}`;
  return {
    text: `Gather ${res}`,
    where,
    label: `Gather ${res} from ${lower(o.def.name)} ${whereLong} (${plural(o.left, 'gather', 'gathers')} left)`,
  };
}

/** The inventory line (Task 11 moved it to itemText.js; re-exported for callers here). */
export { inventoryEntries, describeInventory } from './itemText.js';
