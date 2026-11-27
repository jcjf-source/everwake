/**
 * The player's carried items and worn equipment. Expedition state, and the
 * one source of truth for everything carried: gathering, POI finds, enemy
 * rewards, consumables, equipment and the inventory UI all read and write
 * it through these functions.
 *
 *   inventory = { items: { id: count }, equipped: { weapon: id | null, armor: id | null } }
 *
 * An equipped item is held in its slot, not counted in `items`: `items`
 * holds what is carried spare. Equipping moves one unit from `items` into
 * the slot (and the item it replaces back); unequipping moves it back.
 *
 * Carry capacity is not modelled yet (see docs/TECHNICAL.md). The rules for
 * when these may be done (and what they cost) are in systems/items.js.
 * Simulation only (no DOM).
 */
import { ITEMS, SLOTS, slotOf } from '../data/items.js';

/** @param {{ items?: Record<string, number>, equipped?: Partial<Record<string, string>> }} [start] */
export function createInventory(start = {}) {
  const inv = { items: {}, equipped: Object.fromEntries(SLOTS.map((s) => [s, null])) };
  for (const [id, n] of Object.entries(start.items ?? {})) addItem(inv, id, n);
  for (const [slot, id] of Object.entries(start.equipped ?? {})) {
    if (slotOf(id) !== slot) throw new RangeError(`${id} does not go in the ${slot} slot`);
    inv.equipped[slot] = id;
  }
  return inv;
}

/** How many of `id` are carried spare (0 if none; equipped items are not counted). */
export function countOf(inventory, id) {
  return Object.hasOwn(inventory.items, id) ? inventory.items[id] : 0;
}

/** Add `qty` (an integer ≥ 1) of `id`. Returns the new count. */
export function addItem(inventory, id, qty) {
  if (typeof id !== 'string' || !id) throw new TypeError('item id must be a non-empty string');
  if (!Object.hasOwn(ITEMS, id)) throw new RangeError(`unknown item ${id}`);
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  inventory.items[id] = countOf(inventory, id) + qty;
  return inventory.items[id];
}

/** Add every `{ id: count }` in `bundle`. */
export function addItems(inventory, bundle) {
  for (const [id, n] of Object.entries(bundle)) addItem(inventory, id, n);
}

/** Remove `qty` (an integer ≥ 1, at most the count carried) of `id`. Returns the new count. */
export function removeItem(inventory, id, qty = 1) {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  const have = countOf(inventory, id);
  if (have < qty) throw new RangeError(`cannot remove ${qty} ${id}: only ${have} carried`);
  if (have === qty) delete inventory.items[id];
  else inventory.items[id] = have - qty;
  return have - qty;
}

/** The item id worn in `slot`, or null. */
export const equippedIn = (inventory, slot) => inventory.equipped[slot] ?? null;

/**
 * Wear one carried `id` in its slot; the item it replaces goes back into
 * the carried items. Returns the replaced id or null. Throws if `id` is not
 * equipment or not carried (systems/items.js checks first).
 */
export function equip(inventory, id) {
  const slot = slotOf(id);
  if (!slot) throw new RangeError(`${id} cannot be equipped`);
  removeItem(inventory, id, 1);
  const replaced = inventory.equipped[slot];
  inventory.equipped[slot] = id;
  if (replaced) addItem(inventory, replaced, 1);
  return replaced;
}

/** Take off what is worn in `slot` and carry it. Returns its id. Throws if the slot is empty. */
export function unequip(inventory, slot) {
  const id = equippedIn(inventory, slot);
  if (!id) throw new RangeError(`nothing worn in ${slot}`);
  inventory.equipped[slot] = null;
  addItem(inventory, id, 1);
  return id;
}

/** Attack and defense added by what is worn: `{ attack, defense }`. */
export function equipmentBonus(inventory) {
  let attack = 0;
  let defense = 0;
  for (const slot of SLOTS) {
    const id = equippedIn(inventory, slot);
    if (!id) continue;
    attack += ITEMS[id].attack ?? 0;
    defense += ITEMS[id].defense ?? 0;
  }
  return { attack, defense };
}
