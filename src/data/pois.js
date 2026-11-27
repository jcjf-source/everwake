/**
 * Point-of-interest definitions (gameplay only; art lives in
 * src/render/poiArt.js, placement in src/world/poiPlacement.js).
 *
 * Every POI type has:
 *  - `name` (the type, "Ruins") and `names`: the specific places a POI of
 *    this type can be ("Fallen watchtower"), chosen per POI by hash;
 *  - `verb` / `done`: what interacting does ("Search") and the state once
 *    nothing is left ("searched");
 *  - `uses` [min, max]: how many interactions it holds (each one turn);
 *  - `effect`: 'finds' (each use yields one roll of `finds`, weighted) or
 *    'reveal' (the shrine: maps the land within `revealRadius` of it).
 * Find tables list `[weight, { item: count }]` (data/items.js ids); every
 * entry is non-empty, so each use has a real outcome. Besides materials and
 * herbs, ruins, chests, camps and caves can hold potions and old gear.
 */
import { freezeLootTable, validateLootTable } from './items.js';

const defs = [
  {
    id: 'ruins', name: 'Ruins', verb: 'Search', done: 'searched', uses: [2, 3], effect: 'finds',
    names: ['Fallen watchtower', 'Broken chapel', 'Sunken hall', 'Toppled colonnade', 'Old waystation'],
    finds: [[3, { stone: 3 }], [2, { stone: 2, herbs: 1 }], [2, { herbs: 2 }], [2, { wood: 2, stone: 1 }], [1, { healingPotion: 1, stone: 1 }], [1, { ringMail: 1 }], [1, { shortSword: 1 }]],
  },
  {
    id: 'camp', name: 'Abandoned camp', verb: 'Search', done: 'searched', uses: [1, 1], effect: 'finds',
    names: ['Abandoned camp', "Trapper's camp", 'Cold hearth', "Woodcutter's lean-to"],
    finds: [[3, { food: 2 }], [2, { wood: 3 }], [2, { food: 1, herbs: 1 }], [2, { wood: 2, rations: 2 }], [1, { healingPotion: 1 }]],
  },
  {
    id: 'chest', name: 'Chest', verb: 'Open', done: 'opened', uses: [1, 1], effect: 'finds',
    names: ['Half-buried chest', 'Mossy strongbox', "Traveller's cache"],
    finds: [[2, { healingPotion: 2 }], [2, { healingPotion: 1, herbs: 2 }], [2, { rations: 3, herbs: 2 }], [1, { shortSword: 1 }], [1, { ringMail: 1 }]],
  },
  {
    id: 'shrine', name: 'Shrine', verb: 'Read', done: 'read', uses: [1, 1], effect: 'reveal', revealRadius: 7,
    names: ['Moss-grown shrine', 'Wayshrine', 'Weathered stele', 'Carved waystone'],
  },
  {
    id: 'cave', name: 'Cave', verb: 'Search', done: 'searched', uses: [1, 1], effect: 'finds',
    names: ['Cave mouth', 'Dark hollow', 'Mountain cleft'],
    finds: [[3, { stone: 3, herbs: 1 }], [2, { stone: 2 }], [2, { herbs: 2 }], [1, { shortSword: 1, stone: 1 }]],
  },
];

for (const d of defs) {
  Object.freeze(d.uses);
  Object.freeze(d.names);
  if (d.finds) freezeLootTable(d.finds);
  Object.freeze(d);
}

/** POI types keyed by id. */
export const POI_TYPES = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

/** POI type ids in a stable order. */
export const POI_TYPE_IDS = Object.freeze(defs.map((d) => d.id));

/** Problems with a POI type definition (empty if valid). */
export function validatePoiType(d) {
  const problems = [];
  if (typeof d.id !== 'string' || !d.id) problems.push('missing id');
  for (const k of ['name', 'verb', 'done']) if (typeof d[k] !== 'string' || !d[k]) problems.push(`${d.id}: missing ${k}`);
  if (!Array.isArray(d.names) || d.names.length === 0 || !d.names.every((n) => typeof n === 'string' && n)) problems.push(`${d.id}: names must be non-empty strings`);
  const [lo, hi] = d.uses ?? [];
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) problems.push(`${d.id}: uses must be [min >= 1, max >= min]`);
  if (d.effect === 'finds') {
    problems.push(...validateLootTable(d.finds, `${d.id} finds`));
  } else if (d.effect === 'reveal') {
    if (!Number.isInteger(d.revealRadius) || d.revealRadius < 1) problems.push(`${d.id}: revealRadius must be an integer >= 1`);
  } else {
    problems.push(`${d.id}: unknown effect ${d.effect}`);
  }
  return problems;
}
