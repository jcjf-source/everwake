/**
 * The player's carried items: item id → quantity. Expedition state.
 *
 * Deliberately small for Task 07 (gathered resources only); items,
 * equipment, consumables and carry capacity arrive in Task 11 on top of
 * the same counts. Simulation only (no DOM).
 */

export function createInventory() {
  return { items: {} };
}

/** How many of `id` are carried (0 if none). */
export function countOf(inventory, id) {
  return Object.hasOwn(inventory.items, id) ? inventory.items[id] : 0;
}

/** Add `qty` (an integer ≥ 1) of `id`. Returns the new count. */
export function addItem(inventory, id, qty) {
  if (typeof id !== 'string' || !id) throw new TypeError('item id must be a non-empty string');
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  inventory.items[id] = countOf(inventory, id) + qty;
  return inventory.items[id];
}
