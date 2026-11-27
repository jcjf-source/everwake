import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexEquals } from '../src/world/hex.js';
import { ENEMY_TYPES } from '../src/data/enemies.js';
import { TERRAIN, TERRAIN_IDS, validateTerrainDef } from '../src/data/terrain.js';
import { ITEMS } from '../src/data/items.js';
import { SIGHT_RADIUS } from '../src/world/mapMemory.js';
import { createTurnSystem } from '../src/core/game.js';
import { createTravel } from '../src/systems/travel.js';
import { addItem, countOf, removeItem } from '../src/systems/inventory.js';
import {
  createCombatReactions, attackOptions, fleeTarget, damageOf, playerBlow, enemyBlow, playerStats,
  DEFEND_BONUS, CHARGE_BONUS, SANCTUARY_RECOVERY,
} from '../src/systems/combat.js';
import { SANCTUARY_WARD } from '../src/systems/enemies.js';
import { useOptions } from '../src/systems/items.js';
import * as combatText from '../src/ui/combatText.js';
import { describeEvent, describeEvents } from '../src/ui/clockText.js';
import { asciiGame } from './helpers/asciiMap.js';

// A wide open field with a wood (f) and a thicket (d). S (the sanctuary and start) is at the west end.
const FIELD = [
  '. . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . .',
  'S . . . . . . . . . . . . f f d d . . .',
  '. . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . .',
];

function setup(rows = FIELD) {
  const { game, world, marks } = asciiGame(rows);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  return { game, world, marks, turns };
}
/** Put the player on `h` (test setup only, outside the pipeline). */
function place(game, h) {
  game.player.position = { q: h.q, r: h.r };
  game.memory.observe(h, SIGHT_RADIUS);
}
/** An enemy of `type` on `h`, already hunting the player. */
function foe(game, type, h, mode = 'hunting') {
  const e = game.enemies.add(type, h);
  e.mode = mode;
  return e;
}
const act = (turns, game, action) => turns.perform(game, action);
const types = (r) => r.events.map((e) => e.type);
/** Everything a refused action must leave alone. */
const snapshot = (game) => JSON.stringify({
  turn: game.clock.turn, player: game.player, log: game.log.length,
  enemies: game.enemies.list.map((e) => [e.position, e.health, e.mode]),
});

// ---------------------------------------------------------------- data and blows

test('terrain cover is valid data: woods give cover, open ground none', () => {
  for (const id of TERRAIN_IDS) assert.deepEqual(validateTerrainDef(TERRAIN[id]), [], id);
  assert.equal(TERRAIN.grassland.cover, 0);
  assert.equal(TERRAIN.forest.cover, 1);
  assert.equal(TERRAIN.denseForest.cover, 2);
  assert.ok(validateTerrainDef({ ...TERRAIN.forest, cover: -1 }).some((p) => p.includes('cover')));
});

test('blows: attack − defense, at least 1; cover, Defend and a charge adjust them', () => {
  const { game } = setup();
  assert.equal(damageOf(3, 1), 2);
  assert.equal(damageOf(2, 5), 1, 'every blow lands for at least 1');
  place(game, hex(6, 2));
  const wolf = foe(game, 'wolf', hex(7, 2));
  assert.equal(playerBlow(game, wolf).damage, playerStats(game.player).attack - ENEMY_TYPES.wolf.defense);
  assert.equal(enemyBlow(game, wolf).damage, ENEMY_TYPES.wolf.attack - playerStats(game.player).defense);
  assert.equal(enemyBlow(game, wolf, { guarded: true }).damage, Math.max(1, ENEMY_TYPES.wolf.attack - playerStats(game.player).defense - DEFEND_BONUS));
  const boar = foe(game, 'boar', hex(5, 2));
  assert.equal(enemyBlow(game, boar, { charge: true }).damage, ENEMY_TYPES.boar.attack + CHARGE_BONUS - playerStats(game.player).defense);
  // Cover on the defender's hex: the player in the wood, an enemy in the thicket.
  place(game, hex(13, 2));
  assert.deepEqual(enemyBlow(game, wolf), { damage: ENEMY_TYPES.wolf.attack - playerStats(game.player).defense - 1, cover: 1 });
  const hidden = foe(game, 'wolf', hex(15, 2));
  assert.deepEqual(playerBlow(game, hidden), { damage: Math.max(1, playerStats(game.player).attack - ENEMY_TYPES.wolf.defense - 2), cover: 2 });
});

// ---------------------------------------------------------------- attack

test('attacking costs one turn, deals damage, and the enemy answers after', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  const wolf = foe(game, 'wolf', hex(7, 2));
  const r = act(turns, game, { type: 'attack', at: hex(7, 2) });
  assert.ok(r.ok);
  assert.equal(r.cost, 1);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(types(r), ['playerAttack', 'enemyAttack'], 'the player acts first, then the enemy');
  assert.equal(wolf.health, 8 - 3);
  assert.equal(game.player.health, 24 - 2);
  assert.deepEqual(r.events[0], { type: 'playerAttack', id: wolf.id, enemy: 'wolf', at: hex(7, 2), damage: 3, cover: 0, health: 5, maxHealth: 8 });
  assert.deepEqual(r.events[1], {
    type: 'enemyAttack', id: wolf.id, enemy: 'wolf', at: hex(7, 2), charge: false, parting: false, guarded: false,
    cover: 0, damage: 2, health: 22, maxHealth: 24,
  });
  assert.deepEqual(r.interrupt, { reason: 'enemy' });
  assert.deepEqual(game.log.slice(-2).map((e) => e.type), ['playerAttack', 'enemyAttack'], 'the log describes both');
});

test('a fight to the end: the wolf falls, frees its hex and acts no more', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  const wolf = foe(game, 'wolf', hex(7, 2));
  let r;
  let rounds = 0;
  do { r = act(turns, game, { type: 'attack', at: hex(7, 2) }); rounds++; } while (wolf.health > 0 && rounds < 10);
  assert.equal(rounds, 3, '8 health at 3 a blow');
  assert.deepEqual(types(r), ['playerAttack', 'enemyDefeated'], 'a fallen enemy does not strike back');
  assert.equal(game.player.health, 24 - 2 * 2);
  assert.equal(game.enemies.at(hex(7, 2)), null);
  assert.ok(!attackOptions(game).length);
  const before = snapshot(game);
  const again = act(turns, game, { type: 'attack', at: hex(7, 2) });
  assert.deepEqual([again.ok, again.reason], [false, 'noEnemy']);
  assert.equal(snapshot(game), before);
  assert.ok(act(turns, game, { type: 'move', to: hex(7, 2) }).ok, 'its hex can be entered');
  act(turns, game, { type: 'wait' });
  assert.equal(wolf.health, 0);
  assert.ok(hexEquals(wolf.position, hex(7, 2)), 'it never moves again');
});

test('invalid attacks are refused and cost nothing', () => {
  const { game, turns, marks } = setup();
  place(game, hex(6, 2));
  foe(game, 'wolf', hex(8, 2));
  const unseen = foe(game, 'wolf', hex(19, 2), 'idle');
  const cases = [
    [{ type: 'attack', at: hex(8, 2) }, 'tooFar'],
    [{ type: 'attack', at: hex(5, 2) }, 'noEnemy'],
    [{ type: 'attack', at: unseen.position }, 'noEnemy'],
    [{ type: 'attack', at: hex(99, 99) }, 'outside'],
    [{ type: 'attack', at: 'east' }, 'badTarget'],
    [{ type: 'attack' }, 'badTarget'],
  ];
  for (const [action, reason] of cases) {
    const before = snapshot(game);
    const r = act(turns, game, action);
    assert.deepEqual([r.ok, r.reason], [false, reason], JSON.stringify(action));
    assert.equal(snapshot(game), before, `${reason}: nothing changed`);
  }
  // No fighting from sanctuary ground (enemies never enter it, so it would be a free hit).
  place(game, hex(1, 2));
  assert.ok(hexDistance(game.player.position, marks.S) < SANCTUARY_WARD);
  foe(game, 'wolf', hex(2, 2), 'returning');
  const before = snapshot(game);
  const r = act(turns, game, { type: 'attack', at: hex(2, 2) });
  assert.deepEqual([r.ok, r.reason], [false, 'sanctuary']);
  assert.equal(snapshot(game), before);
  assert.deepEqual(attackOptions(game), [], 'no Attack button there');
});

test('an enemy struck while unaware or heading home turns to fight', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  const wolf = foe(game, 'wolf', hex(7, 2), 'returning');
  const r = act(turns, game, { type: 'attack', at: hex(7, 2) });
  assert.equal(wolf.mode, 'hunting');
  assert.ok(types(r).includes('enemyAttack'), 'and strikes back the same turn');
});

test('attack options list the enemies beside you with the damage a blow would deal', () => {
  const { game } = setup();
  place(game, hex(14, 2)); // in the wood
  foe(game, 'wolf', hex(15, 2)); // in the thicket: cover 2
  foe(game, 'boar', hex(13, 2)); // in the wood: cover 1
  const opts = attackOptions(game);
  assert.deepEqual(opts.map((o) => [o.enemy.type, o.direction, o.damage, o.cover]), [['wolf', 0, 1, 2], ['boar', 3, 2, 1]]);
});

// ---------------------------------------------------------------- defend

test('defending softens every blow that turn only, and needs a threat', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  const before = snapshot(game);
  let r = act(turns, game, { type: 'defend' });
  assert.deepEqual([r.ok, r.reason], [false, 'noThreat'], 'nothing hunts you');
  assert.equal(snapshot(game), before);
  foe(game, 'boar', hex(7, 2));
  r = act(turns, game, { type: 'defend' });
  assert.ok(r.ok);
  assert.deepEqual(types(r), ['defended', 'enemyAttack']);
  assert.equal(r.events[1].guarded, true);
  assert.equal(r.events[1].damage, 5 - 1 - DEFEND_BONUS);
  r = act(turns, game, { type: 'wait' });
  assert.equal(r.events[0].guarded, false);
  assert.equal(r.events[0].damage, 5 - 1, 'the guard lasts one turn');
});

test('defending against a charge', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  const boar = foe(game, 'boar', hex(9, 2)); // 3 away in a straight line
  const r = act(turns, game, { type: 'defend' });
  const hit = r.events.find((e) => e.type === 'enemyAttack');
  assert.ok(hit.charge);
  assert.equal(hit.damage, 5 + CHARGE_BONUS - 1 - DEFEND_BONUS);
  assert.equal(hexDistance(boar.position, game.player.position), 1);
});

// ---------------------------------------------------------------- breaking off

test('walking away from an enemy beside you gives it a parting strike; then it follows', () => {
  const { game, turns } = setup();
  place(game, hex(8, 2));
  const wolf = foe(game, 'wolf', hex(9, 2));
  let r = act(turns, game, { type: 'move', to: hex(7, 2) });
  assert.deepEqual(types(r), ['enemyAttack']);
  assert.equal(r.events[0].parting, true);
  assert.equal(game.player.health, 22);
  assert.deepEqual(r.interrupt, { reason: 'enemy' }, 'it interrupts travel');
  assert.ok(hexEquals(wolf.position, hex(9, 2)), 'it strikes instead of moving');
  r = act(turns, game, { type: 'move', to: hex(6, 2) });
  assert.deepEqual(types(r), [], 'only one parting strike');
  assert.equal(hexDistance(wolf.position, game.player.position), 2, 'it follows');
});

test('fleeing breaks away cleanly: no parting strike, and the enemy loses its turn', () => {
  const { game, turns } = setup();
  place(game, hex(8, 2));
  const wolf = foe(game, 'wolf', hex(9, 2));
  assert.deepEqual(fleeTarget(game), { to: hex(7, 2), direction: 3 }, 'straight away, toward the sanctuary on ties');
  const r = act(turns, game, { type: 'flee' });
  assert.ok(r.ok);
  assert.equal(r.cost, 1);
  assert.deepEqual(r.events, [{ type: 'fled', at: hex(7, 2), direction: 3, enemies: ['wolf'] }]);
  assert.equal(game.player.health, 24);
  assert.ok(hexEquals(wolf.position, hex(9, 2)), 'thrown off: it did not move');
  assert.equal(wolf.mode, 'hunting');
  const r2 = act(turns, game, { type: 'move', to: hex(6, 2) });
  assert.deepEqual(types(r2), []);
  assert.equal(hexDistance(wolf.position, game.player.position), 2, 'the gap holds while you keep moving');
});

test('flee is refused when nothing is beside you or there is nowhere to go', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  foe(game, 'wolf', hex(8, 2));
  let before = snapshot(game);
  let r = act(turns, game, { type: 'flee' });
  assert.deepEqual([r.ok, r.reason], [false, 'notEngaged']);
  assert.equal(snapshot(game), before);

  const POCKET = [
    'M M M M M . . . . . S',
    'M M a b . . . . . . .',
    'M M M M M . . . . . .',
  ];
  const s = setup(POCKET);
  place(s.game, s.marks.a);
  foe(s.game, 'wolf', s.marks.b);
  assert.equal(fleeTarget(s.game), null);
  before = snapshot(s.game);
  r = act(s.turns, s.game, { type: 'flee' });
  assert.deepEqual([r.ok, r.reason], [false, 'cornered']);
  assert.equal(snapshot(s.game), before);
});

test('flee never steps next to another enemy in sight', () => {
  const { game } = setup();
  place(game, hex(8, 2));
  foe(game, 'wolf', hex(9, 2));
  foe(game, 'boar', hex(6, 2), 'idle'); // west of the obvious way out
  const t = fleeTarget(game);
  assert.ok(t);
  for (const e of game.enemies.list) assert.ok(hexDistance(t.to, e.position) >= 2, `clear of the ${e.type}`);
});

// ---------------------------------------------------------------- consumables

test('herbs and food heal (capped), use one item and one turn; refusals cost nothing', () => {
  const { game, turns } = setup();
  place(game, hex(6, 2));
  addItem(game.player.inventory, 'herbs', 2);
  let before = snapshot(game);
  let r = act(turns, game, { type: 'use', item: 'herbs' });
  assert.deepEqual([r.ok, r.reason], [false, 'fullHealth']);
  assert.equal(snapshot(game), before);
  assert.deepEqual(useOptions(game), [], 'no Use button at full health');

  game.player.health = 17;
  assert.deepEqual(useOptions(game).map((o) => [o.item, o.heal, o.count]), [['herbs', ITEMS.herbs.heal, 2], ['rations', 4, 2], ['healingPotion', 7, 1]],
    'every carried consumable, in item order; the heal shown is capped');
  r = act(turns, game, { type: 'use', item: 'herbs' });
  assert.ok(r.ok);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(r.events, [{ type: 'used', item: 'herbs', healed: 5, health: 22, maxHealth: 24, left: 1 }]);
  assert.equal(countOf(game.player.inventory, 'herbs'), 1);
  r = act(turns, game, { type: 'use', item: 'herbs' });
  assert.equal(r.events[0].healed, 2, 'capped at full health');
  assert.equal(countOf(game.player.inventory, 'herbs'), 0);

  game.player.health = 10;
  for (const [item, reason] of [['herbs', 'noItem'], ['food', 'noItem'], ['wood', 'notUsable'], ['toString', 'notUsable'], [undefined, 'notUsable']]) {
    before = snapshot(game);
    r = act(turns, game, { type: 'use', item });
    assert.deepEqual([r.ok, r.reason], [false, reason], String(item));
    assert.equal(snapshot(game), before);
  }
  addItem(game.player.inventory, 'food', 1);
  r = act(turns, game, { type: 'use', item: 'food' });
  assert.equal(r.events[0].healed, ITEMS.food.heal);
});

test('removeItem refuses to go below zero', () => {
  const inv = { items: { wood: 2 } };
  assert.equal(removeItem(inv, 'wood', 1), 1);
  assert.throws(() => removeItem(inv, 'wood', 2), RangeError);
  assert.equal(removeItem(inv, 'wood', 1), 0);
  assert.deepEqual(inv.items, {});
});

// ---------------------------------------------------------------- defeat and recovery

test('at 0 health the player is defeated: back at the sanctuary, healed, and the hunt is over', () => {
  const { game, turns, marks } = setup();
  place(game, hex(8, 2));
  addItem(game.player.inventory, 'wood', 3);
  const wolf = foe(game, 'wolf', hex(9, 2));
  const boar = foe(game, 'boar', hex(8, 3)); // also beside you, acts after the wolf
  game.player.health = 2;
  const r = act(turns, game, { type: 'wait' });
  assert.ok(r.ok);
  assert.deepEqual(types(r), ['enemyAttack', 'defeated'], 'once you fall, no other enemy acts');
  assert.deepEqual(r.events[1], { type: 'defeated', at: hex(8, 2), id: wolf.id, enemy: 'wolf' });
  assert.deepEqual(r.interrupt, { reason: 'enemy' }, 'travel stops (the blow already interrupted)');
  assert.ok(hexEquals(game.player.position, marks.S));
  assert.equal(game.player.health, game.player.maxHealth);
  assert.equal(countOf(game.player.inventory, 'wood'), 3, 'carried items are kept until Task 12 decides');
  assert.deepEqual([wolf.mode, boar.mode], ['returning', 'returning']);
  assert.ok(game.memory.isVisible(marks.S), 'sight follows you home');
  const w = act(turns, game, { type: 'wait' });
  assert.ok(!types(w).includes('enemyAttack'));
});

test('a defeat interrupts travel', () => {
  const { game, marks } = setup();
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  place(game, hex(8, 2));
  foe(game, 'wolf', hex(9, 1));
  game.player.health = 1;
  const queue = [];
  const events = [];
  const travel = createTravel({
    step: (to) => turns.perform(game, { type: 'move', to }),
    onEvent: (e) => events.push(e.type),
    schedule: (fn) => { queue.push(fn); return queue.length; },
    cancel: () => {},
  });
  travel.start([hex(9, 2), hex(10, 2), hex(11, 2)]);
  while (queue.length) queue.shift()();
  assert.deepEqual(events, ['interrupted'], 'the first step ends travel');
  assert.ok(hexEquals(game.player.position, marks.S));
});

test('ending turns on sanctuary ground restores health; nowhere else does', () => {
  const { game, turns, marks } = setup();
  place(game, hex(6, 2));
  game.player.health = 19;
  let r = act(turns, game, { type: 'wait' });
  assert.deepEqual(types(r), []);
  assert.equal(game.player.health, 19);
  place(game, marks.S);
  r = act(turns, game, { type: 'wait' });
  assert.deepEqual(r.events, [{ type: 'recovered', amount: SANCTUARY_RECOVERY, health: 21, maxHealth: 24 }]);
  act(turns, game, { type: 'move', to: hex(1, 2) }); // still warded
  assert.equal(game.player.health, 23);
  r = act(turns, game, { type: 'wait' });
  assert.equal(r.events[0].amount, 1, 'capped');
  r = act(turns, game, { type: 'wait' });
  assert.deepEqual(types(r), [], 'nothing to report at full health');
});

test('nothing happens in a fight while idle', () => {
  const { game } = setup();
  place(game, hex(6, 2));
  foe(game, 'wolf', hex(7, 2));
  const before = snapshot(game);
  attackOptions(game);
  fleeTarget(game);
  useOptions(game);
  assert.equal(snapshot(game), before, 'looking at options changes nothing');
});

// ---------------------------------------------------------------- text

test('combat text', () => {
  assert.equal(combatText.describeHealth(18, 24), 'Health 18/24');
  assert.equal(describeEvent({ type: 'playerAttack', enemy: 'wolf', damage: 3, cover: 0, health: 5, maxHealth: 8 }), 'You strike the wolf for 3 · wolf 5/8');
  assert.equal(describeEvent({ type: 'playerAttack', enemy: 'boar', damage: 2, cover: 1, health: 10, maxHealth: 12 }), 'You strike the boar for 2 (it has cover) · boar 10/12');
  assert.equal(describeEvent({ type: 'enemyDefeated', enemy: 'skeleton' }), 'The skeleton falls');
  assert.equal(describeEvent({ type: 'defended', bonus: 2 }), 'You brace yourself (+2 defense this turn)');
  assert.equal(describeEvent({ type: 'fled', direction: 3, enemies: ['wolf'] }), 'You break away from the wolf to the west');
  assert.equal(describeEvent({ type: 'fled', direction: 4, enemies: ['wolf', 'boar'] }), 'You break away from the wolf and the boar to the south-west');
  assert.equal(describeEvent({ type: 'used', item: 'herbs', healed: 5, health: 22, maxHealth: 24 }), 'You use herbs: +5 health · 22/24');
  assert.equal(describeEvent({ type: 'used', item: 'food', healed: 3, health: 20, maxHealth: 24 }), 'You eat food: +3 health · 20/24');
  assert.equal(describeEvent({ type: 'recovered', amount: 2, health: 24, maxHealth: 24 }), "The sanctuary's calm restores 2 health · 24/24");
  assert.equal(describeEvent({ type: 'defeated', enemy: 'boar' }), 'You fall to the boar · you wake at the sanctuary, wounds tended');
  assert.match(combatText.describeDefeat({ enemy: 'boar' }), /^The boar brought you down\./);
  const hit = { type: 'enemyAttack', enemy: 'wolf', charge: false, parting: false, guarded: false, cover: 0, damage: 2, health: 22, maxHealth: 24 };
  assert.equal(describeEvent(hit), 'The wolf attacks: 2 damage · health 22/24');
  assert.equal(describeEvent({ ...hit, parting: true }), 'The wolf strikes as you pull away: 2 damage · health 22/24');
  assert.equal(describeEvent({ ...hit, enemy: 'boar', charge: true, damage: 4, guarded: true, cover: 1 }), 'The boar charges into you: 4 damage (defended, cover) · health 22/24');
  assert.equal(describeEvents([{ type: 'playerAttack', enemy: 'wolf', damage: 3, cover: 0, health: 0, maxHealth: 8 }, { type: 'enemyDefeated', enemy: 'wolf' }]), 'You strike the wolf for 3 · wolf 0/8 · The wolf falls');
  assert.equal(combatText.describeCombatRefused('attack', 'tooFar', 'Grassland · q 1, r 0'), 'Grassland · q 1, r 0 · too far to strike: stand next to it');
  assert.equal(combatText.describeCombatRefused('flee', 'cornered'), 'Nowhere to flee: every way out is blocked or watched');
  assert.equal(combatText.describeCombatRefused('use', 'fullHealth'), 'You are already at full health');
  const wolf = { type: 'wolf', health: 5 };
  assert.deepEqual(combatText.combatButton('attack', { enemy: wolf, direction: 1, damage: 3, cover: 0 }), {
    text: 'Attack wolf', where: '↗ 3', label: 'Attack the wolf to the north-east: 3 damage, wolf health 5/8',
  });
  assert.equal(combatText.combatButton('defend', {}).text, 'Defend');
  assert.deepEqual(combatText.combatButton('flee', { direction: 4 }).where, '↙');
  assert.deepEqual(combatText.combatButton('use', { item: 'food', def: ITEMS.food, heal: 3, count: 2 }), {
    text: 'Eat food', where: '+3', label: 'Eat food: +3 health (2 carried)',
  });
});
