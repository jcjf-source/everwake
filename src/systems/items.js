/**
 * Item actions (Task 11): using consumables and changing equipment.
 *
 * Each is one action through the turn pipeline (core/actions.js), costing
 * one turn, so enemies react to it like any other action:
 *  - use { item }: a consumable heals `heal` health, up to the maximum;
 *  - equip { item }: wear a carried weapon or armor (the one it replaces is
 *    carried again);
 *  - unequip { slot }: take off what is worn there.
 * The checks change nothing, so a refused action costs no turn.
 *
 * Simulation only (no DOM).
 */
import { CONSUMABLE_IDS, ITEMS, SLOTS, itemDef, slotOf } from '../data/items.js';
import { countOf, equip, equippedIn, removeItem, unequip } from './inventory.js';
import { playerStats } from './combat.js';

// ---------------------------------------------------------------- use

/**
 * May the player use `item` now? Refusals: `notUsable` (unknown, material or
 * equipment), `noItem` (none carried), `fullHealth`.
 */
export function checkUse(game, item) {
  const def = itemDef(item);
  if (!def || def.kind !== 'consumable') return { ok: false, reason: 'notUsable' };
  if (countOf(game.player.inventory, item) < 1) return { ok: false, reason: 'noItem' };
  if (game.player.health >= game.player.maxHealth) return { ok: false, reason: 'fullHealth' };
  return { ok: true };
}

/** Use one `item` (validated): heal by its amount, up to the maximum. */
export function useItem(game, item) {
  const p = game.player;
  removeItem(p.inventory, item, 1);
  const healed = Math.min(ITEMS[item].heal, p.maxHealth - p.health);
  p.health += healed;
  return [{ type: 'used', item, healed, health: p.health, maxHealth: p.maxHealth, left: countOf(p.inventory, item) }];
}

/** Consumables the player could use now: `[{ item, def, count, heal }]` (none at full health). */
export function useOptions(game) {
  const p = game.player;
  if (p.health >= p.maxHealth) return [];
  return CONSUMABLE_IDS.filter((id) => countOf(p.inventory, id) > 0).map((id) => ({
    item: id, def: ITEMS[id], count: countOf(p.inventory, id), heal: Math.min(ITEMS[id].heal, p.maxHealth - p.health),
  }));
}

// ---------------------------------------------------------------- equipment

/**
 * May the player put on `item`? Refusals: `notEquipment`, `noItem` (no spare
 * one carried), `alreadyEquipped` (the same item is already worn there).
 */
export function checkEquip(game, item) {
  const slot = slotOf(item);
  if (!slot) return { ok: false, reason: 'notEquipment' };
  const inv = game.player.inventory;
  if (countOf(inv, item) < 1) return { ok: false, reason: 'noItem' };
  if (equippedIn(inv, slot) === item) return { ok: false, reason: 'alreadyEquipped' };
  return { ok: true, slot };
}

const statsNow = (game) => {
  const { attack, defense } = playerStats(game.player);
  return { attack, defense };
};

/** Put on `item` (validated). */
export function equipItem(game, item) {
  const slot = slotOf(item);
  const replaced = equip(game.player.inventory, item);
  return [{ type: 'equipped', item, slot, replaced, ...statsNow(game) }];
}

/** May the player take off what is worn in `slot`? Refusals: `badSlot`, `emptySlot`. */
export function checkUnequip(game, slot) {
  if (typeof slot !== 'string' || !SLOTS.includes(slot)) return { ok: false, reason: 'badSlot' };
  if (!equippedIn(game.player.inventory, slot)) return { ok: false, reason: 'emptySlot' };
  return { ok: true };
}

/** Take off what is worn in `slot` (validated). */
export function unequipSlot(game, slot) {
  const item = unequip(game.player.inventory, slot);
  return [{ type: 'unequipped', item, slot, ...statsNow(game) }];
}

// ---------------------------------------------------------------- the inventory view

/**
 * Everything the inventory panel shows, derived from the one inventory:
 *  - `stats`: attack, defense, health;
 *  - `slots`: `[{ slot, item, def, unequip }]` (`unequip` is its check);
 *  - `items`: carried items in ITEM order, each `{ item, def, count, action }`
 *    where `action` is the item's button: `{ type: 'use' | 'equip', check }`
 *    or null for materials. A failed check is shown as a disabled button.
 */
export function inventoryView(game) {
  const p = game.player;
  const inv = p.inventory;
  const { attack, defense } = playerStats(p);
  const slots = SLOTS.map((slot) => {
    const item = equippedIn(inv, slot);
    return { slot, item, def: item ? ITEMS[item] : null, unequip: checkUnequip(game, slot) };
  });
  const items = Object.keys(ITEMS).filter((id) => countOf(inv, id) > 0).map((id) => {
    const def = ITEMS[id];
    let action = null;
    if (def.kind === 'consumable') action = { type: 'use', check: checkUse(game, id) };
    else if (slotOf(id)) action = { type: 'equip', check: checkEquip(game, id) };
    return { item: id, def, count: countOf(inv, id), action };
  });
  return { stats: { attack, defense, health: p.health, maxHealth: p.maxHealth }, slots, items };
}
