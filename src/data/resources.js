/**
 * Resource and resource-node definitions (gameplay only; art lives in
 * src/render/resourceArt.js).
 *
 * A resource is a material the player carries (wood, stone, herbs, food).
 * A node is a gatherable spot in the world that yields one resource: each
 * gather takes one turn and gives `yield` units, and a node holds `uses`
 * gathers before it is spent. Where nodes appear is decided by terrain
 * suitability (src/data/terrain.js `resources`); food takes the form of fish
 * on water and berries on land.
 */
import { RESOURCE_KINDS } from './terrain.js';

export { RESOURCE_KINDS };

/** Resources keyed by id. */
export const RESOURCES = Object.freeze({
  wood: Object.freeze({ id: 'wood', name: 'Wood' }),
  stone: Object.freeze({ id: 'stone', name: 'Stone' }),
  herbs: Object.freeze({ id: 'herbs', name: 'Herbs' }),
  food: Object.freeze({ id: 'food', name: 'Food' }),
});

const WATER = new Set(['deepWater', 'shallowWater']);

const kinds = [
  { id: 'deadfall', name: 'Deadfall', resource: 'wood', yield: 2, uses: [2, 4] },
  { id: 'looseStone', name: 'Loose stone', resource: 'stone', yield: 2, uses: [2, 4] },
  { id: 'herbPatch', name: 'Herb patch', resource: 'herbs', yield: 1, uses: [2, 3] },
  { id: 'berryBushes', name: 'Berry bushes', resource: 'food', yield: 1, uses: [2, 3], land: true },
  { id: 'fishShoal', name: 'Fish shoal', resource: 'food', yield: 1, uses: [2, 4], water: true },
];
for (const k of kinds) {
  Object.freeze(k.uses);
  Object.freeze(k);
}

/** Node kinds keyed by id. */
export const NODE_KINDS = Object.freeze(Object.fromEntries(kinds.map((k) => [k.id, k])));

/** The node kind that provides `resource` on `terrain` (an id from terrain.js). */
export function nodeKindFor(resource, terrain) {
  const water = WATER.has(terrain);
  for (const k of kinds) {
    if (k.resource !== resource) continue;
    if ((k.water && !water) || (k.land && water)) continue;
    return k;
  }
  return null;
}

/** Problems with a node kind definition (empty if valid). */
export function validateNodeKind(k) {
  const problems = [];
  if (typeof k.id !== 'string' || !k.id) problems.push('missing id');
  if (typeof k.name !== 'string' || !k.name) problems.push(`${k.id}: missing name`);
  if (!RESOURCE_KINDS.includes(k.resource)) problems.push(`${k.id}: unknown resource ${k.resource}`);
  if (!Number.isInteger(k.yield) || k.yield < 1) problems.push(`${k.id}: yield must be an integer >= 1`);
  const [lo, hi] = k.uses ?? [];
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) problems.push(`${k.id}: uses must be [min >= 1, max >= min]`);
  return problems;
}
