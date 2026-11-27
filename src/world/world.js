/**
 * The generated world: a seed, a bounded hexagonal region of generated
 * tiles, and the sanctuary location.
 *
 * This is the immutable *world definition* (seed-driven), including the
 * generated resource nodes (resourceNodes.js) and points of interest
 * (poiPlacement.js) and enemy spawns (enemyPlacement.js). Mutable world changes (gathered nodes, searched or
 * opened POIs) live in worldChanges.js.
 *
 * Expanding to chunks later: `createTerrainGenerator(seed).tileAt(q, r)` is
 * already a pure function of seed and coordinate, so a chunk is just the
 * tiles of an axial block evaluated on demand. Only the sanctuary search is
 * global here (it flood-fills the bounded map); an unbounded world would run
 * the same search over a fixed spawn region around (0,0) instead.
 */
import { TERRAIN } from '../data/terrain.js';
import { hex, hexDistance, hexNeighbors, hexesInRange } from './hex.js';
import { createHexGrid } from './hexGrid.js';
import { createTerrainGenerator, GENERATOR_VERSION } from './worldGen.js';
import { seedToNumber } from './seed.js';
import { placeResourceNodes, RESOURCE_LAYOUT_VERSION } from './resourceNodes.js';
import { placePois, POI_LAYOUT_VERSION } from './poiPlacement.js';
import { placeEnemies, ENEMY_LAYOUT_VERSION } from './enemyPlacement.js';

const ORIGIN = hex(0, 0);

/**
 * @param {string} seed normalised seed text (see seed.js)
 * @param {number} radius map radius in hexes
 */
export function createWorld(seed, radius) {
  const grid = createHexGrid(radius);
  const seedNumber = seedToNumber(seed);
  const gen = createTerrainGenerator(seedNumber);

  // Dense storage for the bounded region: index = (r+R)*(2R+1) + (q+R).
  const span = 2 * radius + 1;
  const indexOf = (h) => (grid.has(h) ? (h.r + radius) * span + (h.q + radius) : -1);
  const tiles = new Array(span * span).fill(null);
  for (const h of grid.cells) tiles[indexOf(h)] = gen.tileAt(h.q, h.r);

  /** @returns {import('./worldGen.js').Tile | null} */
  function tileAt(h) {
    const i = indexOf(h);
    return i < 0 ? null : tiles[i];
  }

  const isWalkable = (h) => {
    const t = tileAt(h);
    return !!t && TERRAIN[t.terrain].walkable;
  };

  const sanctuary = placeSanctuary(grid, tileAt, isWalkable, radius);
  const resources = placeResourceNodes(seedNumber, grid.cells, tileAt, indexOf, sanctuary.hex);
  const pois = placePois(seedNumber, {
    radius, has: grid.has, tileAt, isWalkable, resourceAt: resources.nodeAt, indexOf, sanctuary: sanctuary.hex,
  });
  const enemySpawns = placeEnemies(seedNumber, {
    radius, has: grid.has, tileAt, isWalkable, poiAt: pois.poiAt, pois: pois.pois, sanctuary: sanctuary.hex,
  });

  return Object.freeze({
    seed,
    /** Numeric form of the seed (hash input for per-coordinate features). */
    seedNumber,
    generatorVersion: GENERATOR_VERSION,
    radius,
    cells: grid.cells,
    has: grid.has,
    tileAt,
    isWalkable,
    sanctuary: sanctuary.hex,
    /** Size of the walkable region reachable from the sanctuary. */
    reachableFromSanctuary: sanctuary.reachable,
    resourceLayoutVersion: RESOURCE_LAYOUT_VERSION,
    /** The generated resource node at a hex (baseline: never depleted), or null. */
    resourceAt: resources.nodeAt,
    /** Every generated resource node, in map row order. */
    resourceNodes: resources.nodes,
    poiLayoutVersion: POI_LAYOUT_VERSION,
    /** The generated point of interest at a hex (baseline: never used), or null. */
    poiAt: pois.poiAt,
    /** Every generated point of interest, in map row order. */
    pois: pois.pois,
    enemyLayoutVersion: ENEMY_LAYOUT_VERSION,
    /** Where each enemy lives (baseline: live positions are game state, systems/enemies.js), row order. */
    enemySpawns,
  });
}

/** Walkable hexes connected to `start` (6-neighbour flood fill). */
export function floodWalkable(start, isWalkable) {
  const seen = new Set([`${start.q},${start.r}`]);
  const out = [start];
  for (let i = 0; i < out.length; i++) {
    for (const n of hexNeighbors(out[i])) {
      const k = `${n.q},${n.r}`;
      if (seen.has(k) || !isWalkable(n)) continue;
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}

/**
 * Pick a safe, accessible start: a grassland hex (falling back to any
 * easy walkable terrain) in the largest walkable region, with all six
 * neighbours walkable, as close to the map centre as possible.
 * Deterministic: candidates are scanned in hexesInRange order, sorted by
 * distance from the centre with a stable sort.
 */
function placeSanctuary(grid, tileAt, isWalkable, radius) {
  // Largest connected walkable region.
  const regionOf = new Map();
  let best = [];
  for (const h of grid.cells) {
    const k = `${h.q},${h.r}`;
    if (regionOf.has(k) || !isWalkable(h)) continue;
    const region = floodWalkable(h, isWalkable);
    for (const c of region) regionOf.set(`${c.q},${c.r}`, region);
    if (region.length > best.length) best = region;
  }
  if (best.length === 0) {
    // Degenerate world with no walkable land at all; keep the centre.
    return { hex: ORIGIN, reachable: 0 };
  }

  const inBest = (h) => regionOf.get(`${h.q},${h.r}`) === best;
  const safe = (h) => hexNeighbors(h).every(isWalkable);
  const byCentre = hexesInRange(ORIGIN, Math.min(radius, Math.floor(radius * 0.75)))
    .sort((a, b) => hexDistance(a, ORIGIN) - hexDistance(b, ORIGIN));

  const preferences = [
    (t) => t.terrain === 'grassland',
    (t) => TERRAIN[t.terrain].moveCost <= 2 && t.terrain !== 'shallowWater',
  ];
  for (const prefer of preferences) {
    const found = byCentre.find((h) => inBest(h) && prefer(tileAt(h)) && safe(h));
    if (found) return { hex: found, reachable: best.length };
  }
  // Last resort: nearest hex of the largest region to the centre.
  const nearest = [...best].sort((a, b) => hexDistance(a, ORIGIN) - hexDistance(b, ORIGIN))[0];
  return { hex: nearest, reachable: best.length };
}
