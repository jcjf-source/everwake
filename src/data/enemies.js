/**
 * Enemy archetypes: stats and behaviour parameters (gameplay only; the art
 * lives in src/render/enemyArt.js).
 *
 * - health / attack / defense: combat stats (systems/combat.js): a blow deals
 *   attack − defense (at least 1), with terrain cover, Defend and a charge
 *   adjusting it.
 * - detectRange: hex distance at which an idle enemy notices the player.
 *   Kept at or below the player's sight radius (mapMemory SIGHT_RADIUS = 4),
 *   so anything that starts hunting you is in sight when it does.
 * - leashRange: a hunting enemy gives up when the player is farther than
 *   this (hex distance), then walks back to where it lives.
 * - territory (optional): a hunting enemy also gives up once chasing would
 *   take it farther than this from home.
 * - moveEvery: moves on turns divisible by this (1: every turn; 2: every
 *   other turn). Attacking is not slowed.
 * - charge (optional): when the player is exactly `charge` hexes away along
 *   one of the six hex directions, with clear ground between, it dashes
 *   `charge - 1` hexes in one turn and ends beside the player.
 * - attackRange: hex distance it can attack from (1: adjacent).
 * - loot: what it leaves when it falls, `[weight, { item: count }]` (as POI
 *   finds); which entry is fixed per enemy by the world seed
 *   (enemyPlacement.js rollLoot). Beasts give food; skeletons carry what
 *   the ruin's old defenders kept.
 * - habitat: suitability 0..1 of each terrain for a roaming spawn
 *   (src/world/enemyPlacement.js). Skeletons have no roaming habitat: they
 *   guard ruins.
 */
import { freezeLootTable, validateLootTable } from './items.js';

const defs = [
  {
    id: 'wolf', name: 'Wolf',
    health: 8, attack: 3, defense: 1,
    detectRange: 4, leashRange: 8, moveEvery: 1, attackRange: 1,
    behaviour: 'Aggressive pursuit: notices you from 4 hexes and chases far.',
    loot: [[3, { food: 1 }], [2, { food: 2 }]],
    habitat: { forest: 1, denseForest: 1, hills: 0.8, grassland: 0.45, rocky: 0.4 },
  },
  {
    id: 'boar', name: 'Boar',
    health: 12, attack: 5, defense: 1,
    detectRange: 3, leashRange: 5, territory: 5, moveEvery: 1, attackRange: 1, charge: 3,
    behaviour: 'Charges from 3 hexes in a straight line; hits hard; stays near its ground.',
    loot: [[2, { food: 2 }], [1, { food: 3 }]],
    habitat: { grassland: 0.7, forest: 0.5, sand: 0.3, hills: 0.2 },
  },
  {
    id: 'skeleton', name: 'Skeleton',
    health: 10, attack: 3, defense: 2,
    detectRange: 3, leashRange: 10, moveEvery: 2, attackRange: 1,
    behaviour: 'Guards ruins: slow (moves every other turn) but follows a long way.',
    loot: [[4, { healingPotion: 1 }], [3, { shortSword: 1 }], [3, { ringMail: 1 }]],
    habitat: {},
  },
];

for (const d of defs) {
  Object.freeze(d.habitat);
  freezeLootTable(d.loot);
  Object.freeze(d);
}

/** Enemy archetypes keyed by id. */
export const ENEMY_TYPES = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

/** Archetype ids in a stable order. */
export const ENEMY_TYPE_IDS = Object.freeze(defs.map((d) => d.id));

const posInt = (v) => Number.isInteger(v) && v >= 1;

/** Check one archetype; returns a list of problems (empty if valid). */
export function validateEnemyType(d, sightRadius = 4) {
  const p = [];
  if (typeof d.id !== 'string' || !d.id) p.push('missing id');
  if (typeof d.name !== 'string' || !d.name) p.push(`${d.id}: missing name`);
  for (const k of ['health', 'attack', 'detectRange', 'leashRange', 'moveEvery', 'attackRange']) {
    if (!posInt(d[k])) p.push(`${d.id}: ${k} must be an integer >= 1`);
  }
  if (!Number.isInteger(d.defense) || d.defense < 0) p.push(`${d.id}: defense must be an integer >= 0`);
  if (d.detectRange > sightRadius) p.push(`${d.id}: detectRange must not exceed the player's sight`);
  if (d.leashRange <= d.detectRange) p.push(`${d.id}: leashRange must exceed detectRange`);
  if (d.territory !== undefined && !posInt(d.territory)) p.push(`${d.id}: territory must be an integer >= 1`);
  if (d.charge !== undefined && !(Number.isInteger(d.charge) && d.charge >= 3 && d.charge <= d.detectRange)) {
    p.push(`${d.id}: charge must be an integer in 3..detectRange`);
  }
  if (typeof d.behaviour !== 'string' || !d.behaviour) p.push(`${d.id}: missing behaviour text`);
  p.push(...validateLootTable(d.loot, `${d.id} loot`));
  for (const [t, v] of Object.entries(d.habitat ?? {})) {
    if (typeof v !== 'number' || !(v > 0 && v <= 1)) p.push(`${d.id}: habitat.${t} must be in (0, 1]`);
  }
  return p;
}
