/**
 * Item definitions (Task 11): everything the player can carry. Gameplay
 * only; text lives in src/ui/itemText.js.
 *
 * Every item has an `id`, a `name` (and `plural` where it differs), a
 * `kind` and a short `about` line:
 *  - 'material': wood and stone. Carried, not used (crafting and building
 *    come later);
 *  - 'consumable': used up by a `use` action (one turn) to restore `heal`
 *    health, up to the maximum; `verb` is the button word (Eat, Drink…);
 *  - 'weapon' / 'armor': worn in the slot of the same name by an `equip`
 *    action (one turn), adding `attack` / `defense` to the player's stats.
 *
 * Gathered resources (data/resources.js) keep their ids here: wood, stone,
 * herbs and food (what you forage or fish). Rations are the food you set
 * out with. Items found in chests and ruins or taken from fallen enemies
 * use the same ids, so gathering, finds, rewards and the inventory UI all
 * read one inventory.
 */

/** Equipment slots, in display order. */
export const SLOTS = Object.freeze(['weapon', 'armor']);

const defs = [
  { id: 'wood', name: 'Wood', kind: 'material', about: 'Deadfall and branches.' },
  { id: 'stone', name: 'Stone', kind: 'material', about: 'Loose, workable stone.' },
  { id: 'herbs', name: 'Herbs', kind: 'consumable', verb: 'Use', heal: 5, about: 'Bitter leaves that close small wounds.' },
  { id: 'food', name: 'Food', kind: 'consumable', verb: 'Eat', heal: 3, about: 'Berries, fish or game, found on the way.' },
  { id: 'rations', name: 'Rations', kind: 'consumable', verb: 'Eat', heal: 4, about: 'Dried food packed at the sanctuary.' },
  { id: 'healingPotion', name: 'Healing potion', plural: 'Healing potions', kind: 'consumable', verb: 'Drink', heal: 12, about: 'A small flask of restorative tincture.' },
  { id: 'huntingKnife', name: 'Hunting knife', plural: 'Hunting knives', kind: 'weapon', attack: 2, about: 'Plain, sharp, and better than bare hands.' },
  { id: 'shortSword', name: 'Short sword', plural: 'Short swords', kind: 'weapon', attack: 3, about: 'Old but sound steel.' },
  { id: 'paddedJerkin', name: 'Padded jerkin', plural: 'Padded jerkins', kind: 'armor', defense: 1, about: 'Quilted cloth that softens a blow.' },
  { id: 'ringMail', name: 'Ring mail', kind: 'armor', defense: 2, about: 'Heavy rings on leather; turns teeth and blades.' },
];
for (const d of defs) Object.freeze(d);

/** Items keyed by id. */
export const ITEMS = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

/** Item ids in display order (materials, consumables, then equipment). */
export const ITEM_IDS = Object.freeze(defs.map((d) => d.id));

/** Consumable ids in button order. */
export const CONSUMABLE_IDS = Object.freeze(defs.filter((d) => d.kind === 'consumable').map((d) => d.id));

/** The item with `id`, or null (own properties only). */
export const itemDef = (id) => (typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : null);

/** The equipment slot an item goes in, or null if it cannot be worn. */
export const slotOf = (id) => {
  const d = itemDef(id);
  return d && SLOTS.includes(d.kind) ? d.kind : null;
};

/**
 * Loot tables (POI finds, enemy rewards) are lists of `[weight, { item: count }]`.
 * The entry a hash `u32` picks (weights summed, `u32 % total`). Returns a copy.
 */
export function pickWeighted(table, u32) {
  const total = table.reduce((n, [w]) => n + w, 0);
  let pick = u32 % total;
  for (const [w, items] of table) {
    if (pick < w) return { ...items };
    pick -= w;
  }
  return { ...table[table.length - 1][1] };
}

/** Problems with a loot table (empty if valid); `label` prefixes each. */
export function validateLootTable(table, label) {
  const problems = [];
  if (!Array.isArray(table) || table.length === 0) return [`${label}: must be a non-empty list`];
  for (const [w, items] of table) {
    if (!Number.isInteger(w) || w < 1) problems.push(`${label}: weight must be an integer >= 1`);
    const entries = Object.entries(items ?? {});
    if (entries.length === 0) problems.push(`${label}: an entry must contain something`);
    for (const [id, n] of entries) {
      if (!itemDef(id)) problems.push(`${label}: unknown item ${id}`);
      if (!Number.isInteger(n) || n < 1) problems.push(`${label}: count for ${id} must be an integer >= 1`);
    }
  }
  return problems;
}

/** Freeze a loot table in place and return it. */
export function freezeLootTable(table) {
  for (const entry of table) { Object.freeze(entry[1]); Object.freeze(entry); }
  return Object.freeze(table);
}

/** Problems with an item definition (empty if valid). */
export function validateItem(d) {
  const problems = [];
  if (typeof d.id !== 'string' || !d.id) problems.push('missing id');
  if (typeof d.name !== 'string' || !d.name) problems.push(`${d.id}: missing name`);
  if (typeof d.about !== 'string' || !d.about) problems.push(`${d.id}: missing about`);
  const posInt = (v) => Number.isInteger(v) && v >= 1;
  switch (d.kind) {
    case 'material': break;
    case 'consumable':
      if (typeof d.verb !== 'string' || !d.verb) problems.push(`${d.id}: missing verb`);
      if (!posInt(d.heal)) problems.push(`${d.id}: heal must be an integer >= 1`);
      break;
    case 'weapon':
      if (!posInt(d.attack)) problems.push(`${d.id}: attack must be an integer >= 1`);
      break;
    case 'armor':
      if (!posInt(d.defense)) problems.push(`${d.id}: defense must be an integer >= 1`);
      break;
    default:
      problems.push(`${d.id}: unknown kind ${d.kind}`);
  }
  return problems;
}
