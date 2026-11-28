/**
 * Terrain definitions: gameplay properties only (colours and art live in
 * src/render/terrainStyle.js).
 *
 * - walkable / moveCost: cost to enter the tile as a route weight only;
 *   every hex entered takes one turn whatever its terrain (Task 06).
 *   Unwalkable tiles have moveCost Infinity (pathfinding excludes them).
 * - sightModifier: change to an observer's sight radius when standing here
 *   (hills and peaks see further; woods see less).
 * - blocksSight: whether the tile stops line of sight beyond it.
 * - cover: defense added in combat (Task 10) to whoever stands here, player
 *   or enemy: woods break up a blow.
 * - resources: suitability 0..1 for resource nodes (Task 07): wood, stone,
 *   herbs, food. 0 means a node of that kind never spawns here.
 *
 * Ruins from the design's initial terrain list are points of interest
 * (Task 08, src/data/pois.js), not base terrain. There are no roads (dropped from the design).
 */

export const RESOURCE_KINDS = Object.freeze(['wood', 'stone', 'herbs', 'food']);

const defs = [
  {
    id: 'deepWater', name: 'Deep water',
    walkable: false, moveCost: Infinity, sightModifier: 0, blocksSight: false, cover: 0,
    resources: { wood: 0, stone: 0, herbs: 0, food: 0.2 },
  },
  {
    id: 'shallowWater', name: 'Shallow water',
    walkable: true, moveCost: 3, sightModifier: 0, blocksSight: false, cover: 0,
    resources: { wood: 0, stone: 0.1, herbs: 0.2, food: 0.5 },
  },
  {
    id: 'sand', name: 'Sand',
    walkable: true, moveCost: 2, sightModifier: 0, blocksSight: false, cover: 0,
    resources: { wood: 0, stone: 0.3, herbs: 0.1, food: 0.1 },
  },
  {
    id: 'grassland', name: 'Grassland',
    walkable: true, moveCost: 1, sightModifier: 0, blocksSight: false, cover: 0,
    resources: { wood: 0.1, stone: 0.1, herbs: 0.5, food: 0.6 },
  },
  {
    id: 'forest', name: 'Forest',
    walkable: true, moveCost: 2, sightModifier: -1, blocksSight: false, cover: 1,
    resources: { wood: 0.8, stone: 0, herbs: 0.6, food: 0.4 },
  },
  {
    id: 'denseForest', name: 'Dense forest',
    walkable: true, moveCost: 3, sightModifier: -2, blocksSight: true, cover: 2,
    resources: { wood: 1, stone: 0, herbs: 0.7, food: 0.3 },
  },
  {
    id: 'hills', name: 'Hills',
    walkable: true, moveCost: 2, sightModifier: 1, blocksSight: false, cover: 0,
    resources: { wood: 0.2, stone: 0.6, herbs: 0.4, food: 0.2 },
  },
  {
    id: 'rocky', name: 'Rocky ground',
    walkable: true, moveCost: 2, sightModifier: 0, blocksSight: false, cover: 0,
    resources: { wood: 0, stone: 0.9, herbs: 0.2, food: 0 },
  },
  {
    id: 'mountains', name: 'Mountains',
    walkable: false, moveCost: Infinity, sightModifier: 2, blocksSight: true, cover: 0,
    resources: { wood: 0, stone: 1, herbs: 0.1, food: 0 },
  },
];

for (const d of defs) {
  Object.freeze(d.resources);
  Object.freeze(d);
}

/** Terrain definitions keyed by id. */
export const TERRAIN = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

/** Terrain ids in a stable order (also the renderer's bucket order). */
export const TERRAIN_IDS = Object.freeze(defs.map((d) => d.id));

/**
 * Check one definition; returns a list of problems (empty if valid).
 * Used by tests and available for future data-driven definitions.
 */
export function validateTerrainDef(d) {
  const problems = [];
  if (typeof d.id !== 'string' || !d.id) problems.push('missing id');
  if (typeof d.name !== 'string' || !d.name) problems.push(`${d.id}: missing name`);
  if (typeof d.walkable !== 'boolean') problems.push(`${d.id}: walkable must be boolean`);
  if (d.walkable) {
    if (!Number.isInteger(d.moveCost) || d.moveCost < 1) problems.push(`${d.id}: walkable moveCost must be an integer >= 1`);
  } else if (d.moveCost !== Infinity) {
    problems.push(`${d.id}: unwalkable moveCost must be Infinity`);
  }
  if (!Number.isInteger(d.sightModifier) || Math.abs(d.sightModifier) > 3) problems.push(`${d.id}: sightModifier must be an integer in -3..3`);
  if (typeof d.blocksSight !== 'boolean') problems.push(`${d.id}: blocksSight must be boolean`);
  if (!Number.isInteger(d.cover) || d.cover < 0 || d.cover > 3) problems.push(`${d.id}: cover must be an integer in 0..3`);
  for (const k of RESOURCE_KINDS) {
    const v = d.resources?.[k];
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) problems.push(`${d.id}: resources.${k} must be in 0..1`);
  }
  return problems;
}
