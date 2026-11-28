import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexEquals } from '../src/world/hex.js';
import { SIGHT_RADIUS } from '../src/world/mapMemory.js';
import { ENEMY_TYPES } from '../src/data/enemies.js';
import { PLAYER_BASE, STARTING_KIT } from '../src/entities/player.js';
import { createGame, createTurnSystem, setOut } from '../src/core/game.js';
import { createCombatReactions } from '../src/systems/combat.js';
import { addItem, countOf, createInventory, unequip } from '../src/systems/inventory.js';
import {
  UPGRADES, UPGRADE_IDS, validateUpgrade, upgradeEffects, nextCost, maxLevel, effectsOf,
} from '../src/data/upgrades.js';
import { INSIGHT, insightFor, checkBuy, buyUpgrade, upgradeView } from '../src/systems/progression.js';
import {
  checkReturn, lastReport, resupply, sightRadiusOf, summarize,
} from '../src/systems/expedition.js';
import { detectRangeOf } from '../src/systems/enemies.js';
import { rollFind } from '../src/world/poiPlacement.js';
import { rollLoot } from '../src/world/enemyPlacement.js';
import { contextOptions, buttonFor, actionFor } from '../src/ui/contextActions.js';
import { describeEvent } from '../src/ui/clockText.js';
import * as X from '../src/ui/expeditionText.js';
import { giveStride } from './helpers/stride.js';
import { HAND_SIZE } from '../src/data/deckTuning.js';
import { asciiGame } from './helpers/asciiMap.js';

// An open field, 24 wide. S (the sanctuary) at the west end.
const FIELD = [
  '. . . . . . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . . . . . .',
  'S . . . . . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . . . . . .',
];

function setup(rows = FIELD) {
  const { game, world, marks } = asciiGame(rows);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  return { game, world, marks, turns };
}
const act = (turns, game, action) => turns.perform(game, action);
/** Walk east along row 2 from where the player stands to q = `to`, one move action per hex. */
function walkTo(turns, game, q) {
  const dir = Math.sign(q - game.player.position.q);
  let r = null;
  while (game.player.position.q !== q) {
    r = act(turns, game, { type: 'move', to: hex(game.player.position.q + dir, game.player.position.r) });
    assert.ok(r.ok, `step to ${game.player.position.q + dir}: ${r.reason}`);
  }
  return r;
}
/** Put a hunting enemy beside the player and wait until it fells them. */
function fall(turns, game, type = 'wolf') {
  const p = game.player.position;
  const e = game.enemies.add(type, hex(p.q + 1, p.r));
  e.mode = 'hunting';
  game.player.health = 1;
  return act(turns, game, { type: 'wait' });
}
const snapshot = (game) => JSON.stringify({
  turn: game.clock.turn, player: game.player, log: game.log.length, progress: game.progress, expedition: game.expedition,
});

// ---------------------------------------------------------------- data

test('upgrade data is valid; at least three upgrades exist, each with rising costs', () => {
  assert.ok(UPGRADE_IDS.length >= 3);
  for (const id of UPGRADE_IDS) assert.deepEqual(validateUpgrade(UPGRADES[id]), [], id);
  assert.notDeepEqual(validateUpgrade({ ...UPGRADES.survivor, costs: [50, 20] }), []);
  assert.notDeepEqual(validateUpgrade({ ...UPGRADES.survivor, effect: 'flight' }), []);
  assert.deepEqual(upgradeEffects({}), { maxHealth: 0, sight: 0, stealth: 0, gather: 0 });
  assert.deepEqual(upgradeEffects({ survivor: 2, cartographer: 1, pathfinder: 1, scavenger: 2 }),
    { maxHealth: 8, sight: 1, stealth: 1, gather: 2 });
  assert.equal(nextCost({}, 'survivor'), UPGRADES.survivor.costs[0]);
  assert.equal(nextCost({ survivor: maxLevel('survivor') }, 'survivor'), null);
});

test('insight rewards discovery: mapping, places, explorations, then enemies', () => {
  assert.deepEqual(insightFor({ mapped: 0, places: 0, explored: 0, defeated: {} }),
    { mapping: 0, places: 0, explored: 0, enemies: 0, total: 0 });
  const i = insightFor({ mapped: 125, places: 2, explored: 3, defeated: { wolf: 1, boar: 1 } });
  assert.deepEqual(i, {
    mapping: 25, places: 2 * INSIGHT.place, explored: 3 * INSIGHT.explored, enemies: 2 * INSIGHT.enemy,
    total: 25 + 2 * INSIGHT.place + 3 * INSIGHT.explored + 2 * INSIGHT.enemy,
  });
  assert.ok(INSIGHT.place > INSIGHT.enemy, 'a discovery is worth more than a kill');
});

// ---------------------------------------------------------------- the first expedition

test('a new game starts expedition 1 at the sanctuary with no insight or upgrades', () => {
  const { game, marks } = setup();
  assert.deepEqual(game.expedition.number, 1);
  assert.equal(game.expedition.status, 'active');
  assert.equal(game.expedition.startTurn, 0);
  assert.equal(game.expedition.knownAtStart, game.memory.knownCount);
  assert.deepEqual(game.progress, { insight: 0, upgrades: {}, history: [] });
  assert.ok(hexEquals(game.player.position, marks.S));
  assert.equal(game.player.maxHealth, PLAYER_BASE.maxHealth);
  assert.equal(lastReport(game), null);
});

test('returning is refused at no cost: before setting off, and away from sanctuary ground', () => {
  const { game, turns } = setup();
  const before = snapshot(game);
  let r = act(turns, game, { type: 'return' });
  assert.deepEqual([r.ok, r.reason], [false, 'notStarted']);
  assert.equal(snapshot(game), before);
  walkTo(turns, game, 3); // outside the ward (distance 3)
  const mid = snapshot(game);
  r = act(turns, game, { type: 'return' });
  assert.deepEqual([r.ok, r.reason], [false, 'notAtSanctuary']);
  assert.equal(snapshot(game), mid);
  walkTo(turns, game, 1); // a neighbour of the sanctuary is warded ground
  assert.ok(checkReturn(game).ok);
});

test('a voluntary return ends the expedition with a report, keeps the pack and awards insight', () => {
  const { game, turns, marks } = setup();
  addItem(game.player.inventory, 'stone', 3);
  walkTo(turns, game, 12);
  walkTo(turns, game, 1);
  const mapped = game.memory.knownCount - game.expedition.knownAtStart;
  const r = act(turns, game, { type: 'return' });
  assert.ok(r.ok);
  assert.equal(r.cost, 1, 'returning takes a turn like any action');
  assert.deepEqual(r.events.filter((e) => e.type !== 'dayPart').map((e) => e.type), ['returned']);
  assert.ok(hexEquals(game.player.position, marks.S), 'you end on the sanctuary itself');
  const rep = r.ended;
  assert.equal(rep, lastReport(game));
  assert.equal(rep.outcome, 'returned');
  assert.equal(rep.cause, null);
  assert.equal(rep.number, 1);
  assert.equal(rep.steps, 23, '11 out and 12 back');
  assert.equal(rep.farthest, 12);
  assert.equal(rep.turns, 24);
  assert.deepEqual([rep.startTurn, rep.endTurn], [0, 24]);
  assert.equal(rep.mapped, mapped);
  assert.ok(mapped > 0);
  assert.equal(rep.insight.mapping, Math.floor(mapped / INSIGHT.hexesPerPoint));
  assert.equal(game.progress.insight, rep.insight.total);
  assert.equal(rep.pack.items.stone, 3, 'the report lists what you brought back');
  assert.equal(countOf(game.player.inventory, 'stone'), 3, 'and you still have it');
  assert.equal(game.expedition.status, 'ended');
  for (const action of [{ type: 'wait' }, { type: 'move', to: hex(1, 2) }, { type: 'return' }]) {
    const x = act(turns, game, action);
    assert.deepEqual([x.ok, x.reason], [false, 'noExpedition'], action.type);
  }
  assert.equal(game.clock.turn, 24, 'nothing happens between expeditions');
});

test('setting out after a return keeps the pack, resupplies the basics, and resets only expedition state', () => {
  const { game, turns, marks } = setup();
  addItem(game.player.inventory, 'shortSword', 1);
  act(turns, game, { type: 'use', item: 'rations' }); // refused (full health): still 2
  game.player.health = 10;
  act(turns, game, { type: 'use', item: 'rations' }); // eats one: 1 left
  act(turns, game, { type: 'use', item: 'rations' }); // and the other: 0 left
  walkTo(turns, game, 6);
  walkTo(turns, game, 1);
  const known = game.memory.knownCount;
  act(turns, game, { type: 'return' });
  const clock = game.clock.turn;
  const s = setOut(game);
  assert.ok(s.ok);
  assert.deepEqual(s.events[0], { type: 'setOut', number: 2, maxHealth: 24, sight: SIGHT_RADIUS });
  assert.equal(game.log.at(-1).type, 'setOut', 'setting out is logged');
  assert.equal(game.expedition.number, 2);
  assert.equal(game.expedition.status, 'active');
  assert.equal(game.expedition.startTurn, clock, 'world time carries on');
  assert.equal(game.clock.turn, clock, 'setting out takes no turn');
  assert.equal(game.memory.knownCount, known, 'the map is kept');
  assert.ok(hexEquals(game.player.position, marks.S));
  assert.equal(game.player.health, game.player.maxHealth);
  assert.equal(countOf(game.player.inventory, 'shortSword'), 1, 'the pack is kept');
  assert.equal(countOf(game.player.inventory, 'rations'), STARTING_KIT.items.rations, 'rations topped up to the kit');
  assert.equal(countOf(game.player.inventory, 'healingPotion'), 1);
  assert.deepEqual(summarize(game).steps, 0, 'a fresh tally');
  assert.deepEqual([setOut(game).ok, setOut(game).reason], [false, 'onExpedition'], 'one expedition at a time');
  assert.deepEqual([game.deck.expedition, game.deck.pool(), game.deck.hand().length], [2, 0, HAND_SIZE], 'a fresh movement deck (G03)');
  giveStride(game);
  // And the second expedition can be completed too.
  walkTo(turns, game, 2);
  walkTo(turns, game, 0);
  const r = act(turns, game, { type: 'return' });
  assert.equal(r.ended.number, 2);
  assert.equal(game.progress.history.length, 2);
});

test('resupply fills empty slots and tops up supplies, never taking anything away', () => {
  const inv = createInventory(STARTING_KIT);
  unequip(inv, 'weapon'); // the knife is carried, not worn
  addItem(inv, 'healingPotion', 2);
  resupply(inv);
  assert.equal(inv.equipped.weapon, 'huntingKnife', 'the carried knife is put back on');
  assert.equal(countOf(inv, 'huntingKnife'), 0, 'not a second knife');
  assert.equal(countOf(inv, 'healingPotion'), 3, 'more than the kit is kept');
  const bare = resupply(createInventory());
  assert.deepEqual(bare.equipped, STARTING_KIT.equipped);
  assert.deepEqual(bare.items, { ...STARTING_KIT.items });
});

// ---------------------------------------------------------------- defeat

test('a defeat ends the expedition: the pack is lost, the world and knowledge remain', () => {
  const { game, turns, world, marks } = setup();
  world.setNode(hex(3, 2), 'deadfall', 3);
  walkTo(turns, game, 3);
  act(turns, game, { type: 'gather', at: hex(3, 2) });
  walkTo(turns, game, 8);
  addItem(game.player.inventory, 'ringMail', 1);
  act(turns, game, { type: 'equip', item: 'ringMail' });
  const journal = game.journal.entries.length;
  const known = game.memory.knownCount;
  const r = fall(turns, game);
  const rep = r.ended;
  assert.equal(rep.outcome, 'defeated');
  assert.equal(rep.cause, 'wolf');
  assert.equal(rep.farthest, 8);
  assert.deepEqual(rep.gathered, { wood: 2 });
  assert.equal(rep.pack.equipped.armor, 'ringMail', 'the report lists what was lost');
  assert.equal(rep.pack.items.wood, 2);
  assert.deepEqual(game.player.inventory, createInventory(), 'everything carried and worn is gone');
  assert.ok(hexEquals(game.player.position, marks.S), 'you wake at the sanctuary');
  assert.equal(game.progress.insight, rep.insight.total, 'insight is earned even in defeat');
  // What survives a defeat:
  assert.equal(game.memory.knownCount, known, 'map memory');
  assert.equal(game.journal.entries.length, journal, 'the journal');
  assert.equal(game.changes.gathersTaken(hex(3, 2)), 1, 'world changes');
  setOut(game);
  assert.deepEqual(game.player.inventory, createInventory(STARTING_KIT), 'the next expedition sets out with the basic kit');
  assert.equal(game.changes.gathersTaken(hex(3, 2)), 1);
});

test('between expeditions survivors go home healed and unaware; the fallen stay fallen', () => {
  const { game, turns } = setup();
  walkTo(turns, game, 10);
  const prey = game.enemies.add('wolf', hex(11, 2));
  const hunter = game.enemies.add('boar', hex(16, 2));
  prey.mode = 'hunting';
  game.player.health = 99;
  game.player.maxHealth = 99;
  while (prey.health > 0) assert.ok(act(turns, game, { type: 'attack', at: prey.position }).ok);
  hunter.mode = 'hunting';
  game.enemies.moveTo(hunter, hex(12, 1));
  hunter.health = 3;
  const r = fall(turns, game, 'skeleton');
  assert.equal(r.ended.defeated.wolf, 1);
  assert.ok(r.ended.found.food > 0 || Object.keys(rollLoot(1, prey)).length === 0, 'loot counts as found');
  setOut(game);
  assert.equal(prey.health, 0, 'the fallen wolf stays fallen');
  assert.ok(!game.enemies.list.some((e) => e.health > 0 && e.id === prey.id));
  assert.deepEqual([hunter.position, hunter.health, hunter.mode], [hex(16, 2), ENEMY_TYPES.boar.health, 'idle']);
  assert.equal(game.enemies.at(hex(16, 2)), hunter);
});

test('the tally counts places discovered and explored, and their finds', () => {
  const { game, turns, world } = setup();
  world.setPoi(hex(9, 2), 'chest', 1, 'Old chest');
  walkTo(turns, game, 6); // the chest comes into sight at distance 4 (q 5)
  act(turns, game, { type: 'move', to: hex(7, 2) });
  act(turns, game, { type: 'move', to: hex(8, 2) });
  const x = act(turns, game, { type: 'interact', at: hex(9, 2) });
  assert.ok(x.ok, x.reason);
  const s = summarize(game);
  assert.equal(s.places, 1);
  assert.equal(s.explored, 1);
  assert.deepEqual(s.found, rollFind(world.seedNumber, world.poiAt(hex(9, 2)), 0));
  assert.equal(s.insight.places, INSIGHT.place);
  assert.equal(s.insight.explored, INSIGHT.explored);
});

// ---------------------------------------------------------------- upgrades

test('upgrades are bought only between expeditions, with enough insight; refusals change nothing', () => {
  const { game, turns } = setup();
  assert.equal(checkBuy(game, 'survivor').reason, 'onExpedition');
  walkTo(turns, game, 1);
  act(turns, game, { type: 'return' });
  game.progress.insight = 30;
  const before = JSON.stringify(game.progress);
  assert.equal(checkBuy(game, 'flight').reason, 'unknownUpgrade');
  assert.equal(checkBuy(game, 'toString').reason, 'unknownUpgrade');
  assert.equal(buyUpgrade(game, 'cartographer').reason, 'tooCostly');
  assert.equal(JSON.stringify(game.progress), before);
  const b = buyUpgrade(game, 'survivor');
  assert.deepEqual(b.event, { type: 'upgraded', id: 'survivor', level: 1, cost: 25, insight: 5 });
  assert.equal(game.progress.upgrades.survivor, 1);
  game.progress.insight = 1000;
  buyUpgrade(game, 'survivor');
  buyUpgrade(game, 'survivor');
  assert.equal(buyUpgrade(game, 'survivor').reason, 'maxed');
  const view = upgradeView(game);
  assert.deepEqual(view.map((u) => u.id), UPGRADE_IDS);
  const sv = view.find((u) => u.id === 'survivor');
  assert.deepEqual([sv.level, sv.max, sv.cost, sv.now, sv.next, sv.check.reason], [3, 3, null, 12, null, 'maxed']);
});

/** A game between expeditions with `levels` bought. */
function withUpgrades(levels, rows = FIELD) {
  const s = setup(rows);
  walkTo(s.turns, s.game, 1);
  act(s.turns, s.game, { type: 'return' });
  s.game.progress.insight = 10000;
  for (const [id, n] of Object.entries(levels)) for (let i = 0; i < n; i++) assert.ok(buyUpgrade(s.game, id).ok);
  setOut(s.game);
  giveStride(s.game);
  return s;
}

test('Survivor: more maximum health from the next expedition', () => {
  const { game } = withUpgrades({ survivor: 2 });
  assert.equal(game.player.maxHealth, PLAYER_BASE.maxHealth + 8);
  assert.equal(game.player.health, game.player.maxHealth);
});

test('Cartographer: a wider sight radius maps more on every step', () => {
  const base = setup();
  const { game, turns } = withUpgrades({ cartographer: 1 });
  assert.equal(sightRadiusOf(game), SIGHT_RADIUS + 1);
  assert.ok(game.memory.isKnown(hex(SIGHT_RADIUS + 1, 2)), 'the start is seen farther');
  assert.ok(!base.game.memory.isKnown(hex(SIGHT_RADIUS + 1, 2)));
  const r = act(turns, game, { type: 'move', to: hex(1, 2) });
  const b = act(base.turns, base.game, { type: 'move', to: hex(1, 2) });
  assert.ok(r.revealed > b.revealed, `${r.revealed} > ${b.revealed}`);
});

test('Pathfinder: enemies notice you from closer, never from less than 1', () => {
  const { game, turns } = withUpgrades({ pathfinder: 2 });
  const wolf = game.enemies.add('wolf', hex(14, 2));
  assert.equal(detectRangeOf(game, wolf), ENEMY_TYPES.wolf.detectRange - 2);
  assert.equal(detectRangeOf(createGame({ ...game.world }), wolf), ENEMY_TYPES.wolf.detectRange);
  const boar = game.enemies.add('boar', hex(20, 0));
  assert.equal(detectRangeOf(game, boar), Math.max(1, ENEMY_TYPES.boar.detectRange - 2));
  walkTo(turns, game, 14 - ENEMY_TYPES.wolf.detectRange);
  assert.equal(wolf.mode, 'idle', 'unnoticed at the usual range');
  walkTo(turns, game, 14 - detectRangeOf(game, wolf));
  assert.equal(wolf.mode, 'hunting');
  assert.ok(hexDistance(game.player.position, wolf.position) >= 1);
});

test('Scavenger: every gather yields more', () => {
  const { game, turns, world } = withUpgrades({ scavenger: 1 });
  world.setNode(hex(1, 2), 'deadfall', 2);
  world.setNode(hex(0, 1), 'herbPatch', 2);
  assert.equal(effectsOf(game).gather, 1);
  const r = act(turns, game, { type: 'gather', at: hex(1, 2) });
  assert.equal(r.events[0].amount, 3, 'deadfall: 2 + 1');
  const h = act(turns, game, { type: 'gather', at: hex(0, 1) });
  assert.equal(h.events[0].amount, 2, 'herbs: 1 + 1');
});

// ---------------------------------------------------------------- context row and text

test('the Return button appears only on sanctuary ground once the expedition has begun', () => {
  const { game, turns } = setup();
  const kinds = () => contextOptions(game).map((o) => o.kind);
  assert.ok(!kinds().includes('return'), 'not at the very start');
  walkTo(turns, game, 2);
  assert.ok(!kinds().includes('return'), 'not away from the ward');
  walkTo(turns, game, 1);
  const opt = contextOptions(game).find((o) => o.kind === 'return');
  assert.ok(opt);
  assert.deepEqual(actionFor(opt), { type: 'return' });
  const b = buttonFor(opt);
  assert.equal(b.text, 'Return');
  assert.match(b.label, /pack is kept/);
  assert.deepEqual(contextOptions(game, { travelling: true }), []);
});

test('expedition text: events, refusals, the report and the upgrade rows', () => {
  assert.equal(describeEvent({ type: 'returned', number: 2 }), 'You return to the sanctuary · expedition 2 ends');
  assert.equal(describeEvent({ type: 'setOut', number: 3, maxHealth: 28, sight: 5 }),
    'Expedition 3 sets out from the sanctuary · health 28 · sight 5');
  assert.equal(X.describeReturnRefused('notAtSanctuary'), 'You can only end an expedition on sanctuary ground');
  const report = {
    number: 1, outcome: 'defeated', cause: 'wolf', startTurn: 0, endTurn: 30, turns: 30, steps: 1, farthest: 9, mapped: 140,
    gathered: { wood: 2 }, found: {}, defeated: { wolf: 2, boar: 1 }, places: 2, explored: 1,
    insight: insightFor({ mapped: 140, places: 2, explored: 1, defeated: { wolf: 2, boar: 1 } }),
    pack: { items: { wood: 2 }, equipped: { weapon: 'huntingKnife', armor: null } },
  };
  assert.equal(X.reportTitle(report), 'Expedition 1 · fallen');
  assert.match(X.reportSummary(report), /^The wolf brought you down after 30 turns\. .*everything you carried and wore is lost/);
  const rows = Object.fromEntries(X.reportRows(report).map((r) => [r.key, r]));
  assert.equal(rows.distance.value, '1 step · farthest 9 hexes from the sanctuary');
  assert.equal(rows.time.value, '30 turns · morning, day 1 to evening, day 1');
  assert.equal(rows.enemies.value, '2 wolves, 1 boar');
  assert.equal(rows.found.value, 'nothing');
  assert.equal(rows.pack.label, 'Lost');
  assert.equal(rows.pack.value, 'hunting knife (worn), 2 wood');
  assert.equal(X.describeInsight(report.insight), `+${report.insight.total} insight · mapping 28, places 10, explored 2, enemies 9`);
  const back = { ...report, outcome: 'returned', cause: null };
  assert.equal(X.reportTitle(back), 'Expedition 1 · returned');
  assert.equal(Object.fromEntries(X.reportRows(back).map((r) => [r.key, r])).pack.label, 'Kept');
  const { game } = withUpgrades({ survivor: 1 });
  game.progress.insight = 10;
  game.expedition.status = 'ended';
  const rowsU = Object.fromEntries(upgradeView(game).map((u) => [u.id, X.upgradeRow(u)]));
  assert.equal(rowsU.survivor.detail, 'Now +4 maximum health · next: +8 maximum health');
  assert.equal(rowsU.survivor.button, 'Learn · 50');
  assert.equal(rowsU.survivor.note, 'need 50');
  assert.equal(rowsU.pathfinder.detail, 'Not learned · next: enemies notice you 1 hex closer');
  assert.equal(X.describeUpgraded({ id: 'survivor', level: 2, cost: 50, insight: 3 }),
    'Survivor level 2: +8 maximum health, from your next expedition · 3 insight left');
  assert.equal(X.describeBuyRefused('tooCostly', 50), 'Not enough insight: it costs 50');
});
