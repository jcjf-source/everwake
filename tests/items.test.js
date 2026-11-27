import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex } from '../src/world/hex.js';
import { ITEMS, ITEM_IDS, CONSUMABLE_IDS, SLOTS, slotOf, itemDef, validateItem, pickWeighted, validateLootTable } from '../src/data/items.js';
import { ENEMY_TYPES, ENEMY_TYPE_IDS } from '../src/data/enemies.js';
import { POI_TYPES, POI_TYPE_IDS } from '../src/data/pois.js';
import { PLAYER_BASE, STARTING_KIT } from '../src/entities/player.js';
import { SIGHT_RADIUS } from '../src/world/mapMemory.js';
import { rollLoot } from '../src/world/enemyPlacement.js';
import { createTurnSystem } from '../src/core/game.js';
import {
  createInventory, addItem, addItems, countOf, removeItem, equip, unequip, equippedIn, equipmentBonus,
} from '../src/systems/inventory.js';
import { createCombatReactions, playerStats, playerBlow, enemyBlow } from '../src/systems/combat.js';
import { inventoryView, useOptions } from '../src/systems/items.js';
import * as itemText from '../src/ui/itemText.js';
import { describeEvent } from '../src/ui/clockText.js';
import { contextOptions } from '../src/ui/contextActions.js';
import { asciiGame } from './helpers/asciiMap.js';

const FIELD = [
  '. . . . . . . . . . . .',
  '. . . . . . . . . . . .',
  'S . . . . . . . . . . .',
  '. . . . . . . . . . . .',
];

function setup() {
  const { game, world, marks } = asciiGame(FIELD);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  return { game, world, marks, turns };
}
function place(game, h) {
  game.player.position = { q: h.q, r: h.r };
  game.memory.observe(h, SIGHT_RADIUS);
}
function foe(game, type, h) {
  const e = game.enemies.add(type, h);
  e.mode = 'hunting';
  return e;
}
const snapshot = (game) => JSON.stringify({
  turn: game.clock.turn, player: game.player, log: game.log.length,
  enemies: game.enemies.list.map((e) => [e.position, e.health, e.mode]),
});
const inv = (game) => game.player.inventory;

// ---------------------------------------------------------------- data

test('item definitions are valid; every loot table names real items', () => {
  for (const id of ITEM_IDS) assert.deepEqual(validateItem(ITEMS[id]), [], id);
  assert.ok(validateItem({ id: 'x', name: 'X', about: 'x', kind: 'weapon' }).some((p) => p.includes('attack')));
  assert.ok(validateItem({ id: 'x', name: 'X', about: 'x', kind: 'gem' }).some((p) => p.includes('unknown kind')));
  for (const id of ['wood', 'stone', 'herbs', 'food']) assert.ok(itemDef(id), `gathered ${id} is an item`);
  assert.deepEqual(CONSUMABLE_IDS, ['herbs', 'food', 'rations', 'healingPotion']);
  assert.deepEqual(SLOTS, ['weapon', 'armor']);
  assert.equal(slotOf('shortSword'), 'weapon');
  assert.equal(slotOf('ringMail'), 'armor');
  assert.equal(slotOf('herbs'), null);
  assert.equal(slotOf('toString'), null);
  assert.equal(itemDef('constructor'), null);
  for (const t of ENEMY_TYPE_IDS) assert.deepEqual(validateLootTable(ENEMY_TYPES[t].loot, t), [], t);
  for (const t of POI_TYPE_IDS) if (POI_TYPES[t].finds) assert.deepEqual(validateLootTable(POI_TYPES[t].finds, t), [], t);
  assert.ok(validateLootTable([[1, { gold: 1 }]], 't').some((p) => p.includes('unknown item gold')));
  assert.ok(validateLootTable([], 't').length > 0);
  const found = new Set(POI_TYPE_IDS.flatMap((t) => (POI_TYPES[t].finds ?? []).flatMap(([, b]) => Object.keys(b))));
  for (const id of ['healingPotion', 'shortSword', 'ringMail', 'rations']) assert.ok(found.has(id), `${id} can be found`);
});

test('pickWeighted follows the weights and always returns a copy', () => {
  const table = [[1, { wood: 1 }], [3, { stone: 2 }]];
  assert.deepEqual(pickWeighted(table, 0), { wood: 1 });
  assert.deepEqual(pickWeighted(table, 1), { stone: 2 });
  assert.deepEqual(pickWeighted(table, 3), { stone: 2 });
  assert.deepEqual(pickWeighted(table, 4), { wood: 1 }, 'wraps by the total weight');
  const a = pickWeighted(table, 1);
  a.stone = 99;
  assert.deepEqual(table[1][1], { stone: 2 });
});

// ---------------------------------------------------------------- inventory and starting kit

test('the inventory holds carried counts and worn equipment', () => {
  const i = createInventory();
  assert.deepEqual(i, { items: {}, equipped: { weapon: null, armor: null } });
  assert.throws(() => addItem(i, 'gold', 1), RangeError, 'unknown items are refused');
  assert.throws(() => addItem(i, 'wood', 0), RangeError);
  addItems(i, { wood: 2, shortSword: 1 });
  assert.equal(equip(i, 'shortSword'), null, 'nothing was replaced');
  assert.equal(countOf(i, 'shortSword'), 0, 'a worn item is not counted as carried');
  assert.equal(equippedIn(i, 'weapon'), 'shortSword');
  assert.deepEqual(equipmentBonus(i), { attack: 3, defense: 0 });
  addItem(i, 'huntingKnife', 1);
  assert.equal(equip(i, 'huntingKnife'), 'shortSword', 'the sword goes back into the pack');
  assert.equal(countOf(i, 'shortSword'), 1);
  assert.equal(unequip(i, 'weapon'), 'huntingKnife');
  assert.deepEqual(i.equipped, { weapon: null, armor: null });
  assert.equal(countOf(i, 'huntingKnife'), 1);
  assert.throws(() => unequip(i, 'weapon'), RangeError);
  assert.throws(() => equip(i, 'wood'), RangeError);
  assert.throws(() => equip(i, 'ringMail'), RangeError, 'not carried');
  assert.throws(() => createInventory({ equipped: { armor: 'shortSword' } }), RangeError);
  removeItem(i, 'wood', 2);
  assert.equal(countOf(i, 'wood'), 0);
});

test('an expedition starts with basic gear worn and modest supplies: attack 4, defense 1', () => {
  const { game } = setup();
  assert.deepEqual(inv(game).equipped, STARTING_KIT.equipped);
  assert.deepEqual(inv(game).items, STARTING_KIT.items);
  assert.deepEqual(playerStats(game.player), { attack: 4, defense: 1, maxHealth: 24 });
  assert.deepEqual([PLAYER_BASE.attack, PLAYER_BASE.defense], [2, 0], 'bare-handed');
});

// ---------------------------------------------------------------- equip / unequip

test('equipping costs a turn, swaps gear and updates the stats and blows', () => {
  const { game, turns } = setup();
  place(game, hex(5, 2));
  addItem(inv(game), 'shortSword', 1);
  addItem(inv(game), 'ringMail', 1);
  const wolf = foe(game, 'wolf', hex(9, 2)); // in sight, hunting, not in reach
  const before = playerBlow(game, wolf).damage;

  let r = turns.perform(game, { type: 'equip', item: 'shortSword' });
  assert.ok(r.ok);
  assert.equal(r.cost, 1);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(r.events[0], { type: 'equipped', item: 'shortSword', slot: 'weapon', replaced: 'huntingKnife', attack: 5, defense: 1 });
  assert.equal(countOf(inv(game), 'huntingKnife'), 1, 'the knife is carried again');
  assert.equal(countOf(inv(game), 'shortSword'), 0);
  assert.equal(playerBlow(game, wolf).damage, before + 1);

  r = turns.perform(game, { type: 'equip', item: 'ringMail' });
  assert.ok(r.ok);
  assert.deepEqual(r.events[0], { type: 'equipped', item: 'ringMail', slot: 'armor', replaced: 'paddedJerkin', attack: 5, defense: 2 });
  assert.equal(enemyBlow(game, wolf).damage, ENEMY_TYPES.wolf.attack - 2);

  r = turns.perform(game, { type: 'unequip', slot: 'armor' });
  assert.ok(r.ok);
  assert.deepEqual(r.events[0], { type: 'unequipped', item: 'ringMail', slot: 'armor', attack: 5, defense: 0 });
  assert.equal(countOf(inv(game), 'ringMail'), 1);
  assert.equal(game.clock.turn, 3);
  assert.deepEqual(game.log.filter((e) => e.type === 'equipped' || e.type === 'unequipped').length, 3, 'logged');
});

test('invalid item actions are refused and cost nothing', () => {
  const { game, turns } = setup();
  place(game, hex(5, 2));
  addItem(inv(game), 'huntingKnife', 1); // a spare of what is worn
  addItem(inv(game), 'wood', 1);
  const cases = [
    [{ type: 'equip', item: 'wood' }, 'notEquipment'],
    [{ type: 'equip', item: 'herbs' }, 'notEquipment'],
    [{ type: 'equip', item: 'gold' }, 'notEquipment'],
    [{ type: 'equip', item: 'toString' }, 'notEquipment'],
    [{ type: 'equip' }, 'notEquipment'],
    [{ type: 'equip', item: 'shortSword' }, 'noItem'],
    [{ type: 'equip', item: 'huntingKnife' }, 'alreadyEquipped'],
    [{ type: 'unequip', slot: 'ring' }, 'badSlot'],
    [{ type: 'unequip', slot: 'toString' }, 'badSlot'],
    [{ type: 'unequip' }, 'badSlot'],
    [{ type: 'use', item: 'healingPotion' }, 'fullHealth'],
    [{ type: 'use', item: 'shortSword' }, 'notUsable'],
    [{ type: 'use', item: 'stone' }, 'notUsable'],
    [{ type: 'use', item: 'food' }, 'noItem'],
  ];
  for (const [action, reason] of cases) {
    const before = snapshot(game);
    const r = turns.perform(game, action);
    assert.deepEqual([r.ok, r.reason], [false, reason], JSON.stringify(action));
    assert.equal(snapshot(game), before, `${JSON.stringify(action)} changes nothing`);
  }
  // An empty slot cannot be emptied again.
  assert.ok(turns.perform(game, { type: 'unequip', slot: 'armor' }).ok);
  const before = snapshot(game);
  assert.equal(turns.perform(game, { type: 'unequip', slot: 'armor' }).reason, 'emptySlot');
  assert.equal(snapshot(game), before);
});

test('equipping beside an enemy gives it a turn to strike', () => {
  const { game, turns } = setup();
  place(game, hex(5, 2));
  addItem(inv(game), 'ringMail', 1);
  foe(game, 'wolf', hex(6, 2));
  const r = turns.perform(game, { type: 'equip', item: 'ringMail' });
  assert.ok(r.ok);
  const hit = r.events.find((e) => e.type === 'enemyAttack');
  assert.ok(hit, 'the wolf strikes');
  assert.equal(hit.damage, ENEMY_TYPES.wolf.attack - 2, 'the new armor already counts');
});

// ---------------------------------------------------------------- consumables

test('a healing potion heals (capped) and is used up; the starting rations are food', () => {
  const { game, turns } = setup();
  game.player.health = 6;
  let r = turns.perform(game, { type: 'use', item: 'healingPotion' });
  assert.ok(r.ok);
  assert.deepEqual(r.events[0], { type: 'used', item: 'healingPotion', healed: 12, health: 18, maxHealth: 24, left: 0 });
  assert.equal(countOf(inv(game), 'healingPotion'), 0);
  assert.equal(turns.perform(game, { type: 'use', item: 'healingPotion' }).reason, 'noItem');
  r = turns.perform(game, { type: 'use', item: 'rations' });
  assert.deepEqual([r.events[0].healed, r.events[0].left], [4, 1]);
  game.player.health = 23;
  r = turns.perform(game, { type: 'use', item: 'rations' });
  assert.equal(r.events[0].healed, 1, 'capped at full health');
  assert.equal(countOf(inv(game), 'rations'), 0);
  assert.equal(game.clock.turn, 3);
});

// ---------------------------------------------------------------- rewards

test('a fallen enemy leaves its seeded loot in the same inventory', () => {
  const { game, world, turns } = setup();
  place(game, hex(5, 2));
  const skeleton = foe(game, 'skeleton', hex(6, 2));
  skeleton.health = 1;
  const loot = rollLoot(world.seedNumber, skeleton);
  assert.deepEqual(loot, rollLoot(world.seedNumber, skeleton), 'deterministic');
  assert.ok(ENEMY_TYPES.skeleton.loot.some(([, b]) => JSON.stringify(b) === JSON.stringify(loot)));
  const had = { ...inv(game).items };
  const r = turns.perform(game, { type: 'attack', at: hex(6, 2) });
  const fell = r.events.find((e) => e.type === 'enemyDefeated');
  assert.deepEqual(fell.loot, loot);
  for (const [id, n] of Object.entries(loot)) assert.equal(countOf(inv(game), id), (had[id] ?? 0) + n);
  // Different homes give different rolls across many enemies.
  const seen = new Set();
  for (let q = 0; q < 40; q++) seen.add(JSON.stringify(rollLoot(9, { type: 'skeleton', home: { q, r: 0 } })));
  assert.ok(seen.size > 1);
  for (let q = 0; q < 20; q++) assert.ok(rollLoot(9, { type: 'wolf', home: { q, r: 3 } }).food >= 1, 'wolves give food');
});

// ---------------------------------------------------------------- the inventory view and the context row

test('inventoryView shows stats, slots and each carried item with its button state', () => {
  const { game } = setup();
  addItem(inv(game), 'wood', 2);
  addItem(inv(game), 'huntingKnife', 1);
  addItem(inv(game), 'ringMail', 1);
  const before = snapshot(game);
  let v = inventoryView(game);
  assert.equal(snapshot(game), before, 'looking changes nothing');
  assert.deepEqual(v.stats, { attack: 4, defense: 1, health: 24, maxHealth: 24 });
  assert.deepEqual(v.slots.map((s) => [s.slot, s.item, s.unequip.ok]), [['weapon', 'huntingKnife', true], ['armor', 'paddedJerkin', true]]);
  assert.deepEqual(v.items.map((e) => [e.item, e.count, e.action && e.action.type, e.action && (e.action.check.ok || e.action.check.reason)]), [
    ['wood', 2, null, null],
    ['rations', 2, 'use', 'fullHealth'],
    ['healingPotion', 1, 'use', 'fullHealth'],
    ['huntingKnife', 1, 'equip', 'alreadyEquipped'],
    ['ringMail', 1, 'equip', true],
  ]);
  game.player.health = 20;
  v = inventoryView(game);
  assert.equal(v.items.find((e) => e.item === 'rations').action.check.ok, true);
});

test('the context row offers every carried consumable while hurt', () => {
  const { game } = setup();
  assert.deepEqual(contextOptions(game).filter((o) => o.kind === 'use'), []);
  game.player.health = 10;
  assert.deepEqual(useOptions(game).map((o) => o.item), ['rations', 'healingPotion']);
  assert.deepEqual(contextOptions(game).filter((o) => o.kind === 'use').map((o) => o.o.item), ['rations', 'healingPotion']);
});

// ---------------------------------------------------------------- text

test('item text', () => {
  const T = itemText;
  assert.equal(T.describeBundle({ healingPotion: 2, stone: 1 }), '1 stone, 2 healing potions');
  assert.equal(T.describeBundle({ shortSword: 1 }), '1 short sword');
  const i = createInventory({ items: { wood: 1, rations: 2, shortSword: 1 }, equipped: { weapon: 'huntingKnife' } });
  assert.equal(T.describeInventory(i), 'Wood 1 · Stone 0 · Herbs 0 · Food 0', 'the HUD line keeps to gathered resources');
  assert.equal(describeEvent({ type: 'used', item: 'healingPotion', healed: 12, health: 18, maxHealth: 24 }), 'You drink a healing potion: +12 health · 18/24');
  assert.equal(describeEvent({ type: 'used', item: 'rations', healed: 4, health: 20, maxHealth: 24 }), 'You eat rations: +4 health · 20/24');
  assert.equal(describeEvent({ type: 'equipped', item: 'shortSword', slot: 'weapon', replaced: 'huntingKnife', attack: 5, defense: 1 }),
    'You equip the short sword (hunting knife put away) · Attack 5 · Defense 1');
  assert.equal(describeEvent({ type: 'equipped', item: 'ringMail', slot: 'armor', replaced: null, attack: 4, defense: 2 }),
    'You equip the ring mail · Attack 4 · Defense 2');
  assert.equal(describeEvent({ type: 'unequipped', item: 'ringMail', slot: 'armor', attack: 4, defense: 0 }), 'You take off the ring mail · Attack 4 · Defense 0');
  assert.equal(describeEvent({ type: 'enemyDefeated', enemy: 'wolf', loot: { food: 2 } }), 'The wolf falls · you take 2 food');
  assert.equal(T.describeItemRefused('equip', 'alreadyEquipped'), 'You are already wearing that');
  assert.equal(T.describeItemRefused('unequip', 'emptySlot'), 'Nothing is worn there');
  assert.equal(T.describeSlot('weapon', 'huntingKnife'), 'Weapon: Hunting knife (+2 attack)');
  assert.equal(T.describeSlot('armor', null), 'Armor: none');
  assert.equal(T.effectText('healingPotion'), '+12 health');
  assert.equal(T.effectText('stone'), 'material');
  assert.deepEqual(T.itemButton({ item: 'ringMail', count: 1, action: { type: 'equip' } }), { text: 'Equip', label: 'Equip ring mail: +2 defense (one turn)' });
  assert.deepEqual(T.itemButton({ item: 'healingPotion', count: 2, action: { type: 'use' } }), {
    text: 'Drink', label: 'Drink healing potion: +12 health (2 carried, one turn)',
  });
  assert.equal(T.describeStats({ attack: 4, defense: 1 }), 'Attack 4 · Defense 1');
});
