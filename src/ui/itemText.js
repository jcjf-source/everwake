/**
 * Text for items: names, the HUD inventory line, item events (use, equip,
 * unequip), refusals, and the inventory panel's lines and buttons. Pure;
 * unit tested, and mirrored by the browser check
 * (tools/browser/check-world.mjs).
 */
import { ITEMS, ITEM_IDS, SLOTS } from '../data/items.js';
import { RESOURCE_KINDS } from '../data/resources.js';
import { countOf } from '../systems/inventory.js';

const lower = (s) => s[0].toLowerCase() + s.slice(1);

/** The item's name in running text, for `n` of it: "herbs", "healing potion", "2 healing potions" (without the number). */
export function itemNoun(id, n = 1) {
  const d = ITEMS[id];
  if (!d) return id;
  return lower(n === 1 ? d.name : d.plural ?? d.name);
}

/** "3 stone, 1 healing potion" in item order (POI finds, enemy loot). */
export function describeBundle(bundle) {
  return ITEM_IDS.filter((id) => bundle[id] > 0).map((id) => `${bundle[id]} ${itemNoun(id, bundle[id])}`).join(', ');
}

/** What a worn item adds: "+2 attack" / "+1 defense". */
export function bonusText(id) {
  const d = ITEMS[id];
  if (d.kind === 'weapon') return `+${d.attack} attack`;
  if (d.kind === 'armor') return `+${d.defense} defense`;
  return '';
}

/** What an item does, for the panel: "+12 health", "+2 attack", or "material". */
export function effectText(id) {
  const d = ITEMS[id];
  if (d.kind === 'consumable') return `+${d.heal} health`;
  if (d.kind === 'material') return 'material';
  return bonusText(id);
}

export const SLOT_NAMES = Object.freeze({ weapon: 'Weapon', armor: 'Armor' });

/** "Attack 4 · Defense 1" */
export const describeStats = (s) => `Attack ${s.attack} · Defense ${s.defense}`;

/**
 * The HUD inventory line, `[{ id, name, count }]`: the four gathered
 * resources, always (so an empty one reads "0"). It stays this short so it
 * never covers the map on small screens; supplies, loot and gear are listed
 * in the Pack dialog beside it, and consumables also appear as Use buttons
 * when hurt.
 */
export const inventoryEntries = (inventory) =>
  RESOURCE_KINDS.map((id) => ({ id, name: ITEMS[id].name, count: countOf(inventory, id) }));

/** "Wood 2 · Stone 0 · Herbs 1 · Food 0" (the inventory line's text). */
export const describeInventory = (inventory) =>
  inventoryEntries(inventory).map((e) => `${e.name} ${e.count}`).join(' · ');

/** One item event as a short sentence, or null if it is not one. */
export function describeItemEvent(e) {
  switch (e.type) {
    case 'used':
      return `You ${lower(ITEMS[e.item].verb)} ${e.item === 'healingPotion' ? 'a ' : ''}${itemNoun(e.item)}: +${e.healed} health · ${e.health}/${e.maxHealth}`;
    case 'equipped': {
      const was = e.replaced ? ` (${itemNoun(e.replaced)} put away)` : '';
      return `You equip the ${itemNoun(e.item)}${was} · ${describeStats(e)}`;
    }
    case 'unequipped':
      return `You take off the ${itemNoun(e.item)} · ${describeStats(e)}`;
    default:
      return null;
  }
}

/** Why an item action was refused (no turn passes). */
export function describeItemRefused(kind, reason) {
  switch (`${kind}:${reason}`) {
    case 'use:noItem': return 'You have none left';
    case 'use:fullHealth': return 'You are already at full health';
    case 'use:notUsable': return 'That cannot be used';
    case 'equip:noItem': return 'You are not carrying that';
    case 'equip:notEquipment': return 'That cannot be worn';
    case 'equip:alreadyEquipped': return 'You are already wearing that';
    case 'unequip:emptySlot': return 'Nothing is worn there';
    case 'unequip:badSlot': return 'There is no such slot';
    default: return `Cannot ${kind} (${reason})`;
  }
}

/** Short note beside a disabled panel button: why it cannot be done now. */
export function refusalNote(reason) {
  switch (reason) {
    case 'fullHealth': return 'full health';
    case 'alreadyEquipped': return 'worn';
    case 'noItem': return 'none left';
    default: return reason;
  }
}

/**
 * The panel's button for a carried item (systems/items.js inventoryView
 * `action`): `{ text, label }`.
 */
export function itemButton(entry) {
  const name = itemNoun(entry.item);
  const { type } = entry.action;
  if (type === 'use') {
    const verb = ITEMS[entry.item].verb;
    return { text: verb, label: `${verb} ${name}: ${effectText(entry.item)} (${entry.count} carried, one turn)` };
  }
  return { text: 'Equip', label: `Equip ${name}: ${bonusText(entry.item)} (one turn)` };
}

/** The panel's Unequip button for a slot. */
export const unequipButton = (slot, id) => ({ text: 'Take off', label: `Take off the ${itemNoun(id)} (${SLOT_NAMES[slot].toLowerCase()}, one turn)` });

/** A worn slot as text: "Weapon: Hunting knife (+2 attack)" or "Armor: none". */
export function describeSlot(slot, id) {
  return id ? `${SLOT_NAMES[slot]}: ${ITEMS[id].name} (${bonusText(id)})` : `${SLOT_NAMES[slot]}: none`;
}

export { SLOTS };
