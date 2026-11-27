/**
 * The player's expedition state: where they stand and what they carry.
 *
 * Elapsed time is not kept here: the world clock (src/core/clock.js) is the
 * one turn counter. This is expedition state; it is not saved yet
 * (persistence is Task 13).
 */
import { createInventory } from '../systems/inventory.js';

/** @param {{ q: number, r: number }} position usually the sanctuary */
export function createPlayer(position) {
  return { position: { q: position.q, r: position.r }, inventory: createInventory() };
}
