/**
 * The player's expedition state: where they stand, their health, and what
 * they carry and wear.
 *
 * Elapsed time is not kept here: the world clock (src/core/clock.js) is the
 * one turn counter. Attack and defense are not stored either: they are
 * derived by systems/combat.js `playerStats` from `PLAYER_BASE` plus what is
 * worn (systems/inventory.js `equipmentBonus`). This is expedition state; it
 * is not saved yet (persistence is Task 13).
 */
import { createInventory } from '../systems/inventory.js';

/**
 * Bare-handed stats. The starting kit's knife (+2 attack) and jerkin
 * (+1 defense) bring them to the Task 10 tuning of attack 4, defense 1.
 */
export const PLAYER_BASE = Object.freeze({ maxHealth: 24, attack: 2, defense: 0 });

/** What every expedition sets out with: basic gear worn, modest supplies carried. */
export const STARTING_KIT = Object.freeze({
  equipped: Object.freeze({ weapon: 'huntingKnife', armor: 'paddedJerkin' }),
  items: Object.freeze({ rations: 2, healingPotion: 1 }),
});

/** @param {{ q: number, r: number }} position usually the sanctuary */
export function createPlayer(position) {
  return {
    position: { q: position.q, r: position.r },
    health: PLAYER_BASE.maxHealth,
    maxHealth: PLAYER_BASE.maxHealth,
    inventory: createInventory(STARTING_KIT),
  };
}
