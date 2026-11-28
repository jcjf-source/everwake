/**
 * Stride costs (G03): what actions cost from the day's pool, card effects,
 * refusals, playing cards, travel running out, and route planning by stride.
 * Every game here starts from the real, empty pool (asciiGame stride: 0).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance } from '../src/world/hex.js';
import { SIGHT_RADIUS } from '../src/world/mapMemory.js';
import { createTurnSystem } from '../src/core/game.js';
import { createCombatReactions } from '../src/systems/combat.js';
import { createDeck } from '../src/systems/movementDeck.js';
import { strideCost, stepStride, planningCost, checkStride } from '../src/systems/stride.js';
import { sightRadiusOf, summarize } from '../src/systems/expedition.js';
import { planRoute } from '../src/systems/movement.js';
import { createTravel } from '../src/systems/travel.js';
import { pathCost } from '../src/world/pathfinding.js';
import { serializeGame } from '../src/systems/persistence.js';
import { ACTION_COSTS, HAND_SIZE, STARTING_DECK } from '../src/data/deckTuning.js';
import { MOVEMENT_CARDS } from '../src/data/movementCards.js';
import { asciiGame, dijkstraCost } from './helpers/asciiMap.js';
import * as ST from '../src/ui/strideText.js';
import { describeEvent } from '../src/ui/clockText.js';

// S (the sanctuary) at q 0, r 2. The ward is S and its neighbours; the
// terrain along row 2 starts two hexes out.
const MAP = [
  '. . . . . . . . . . . .',
  '. . . . . . . . . . . .',
  'S . . d ^ % ~ . . . . .',
  '. . . . . . . . . . . .',
  '. . . . . . . . . . . .',
];

function setup(rows = MAP) {
  const s = asciiGame(rows, null, { stride: 0 });
  return { ...s, turns: createTurnSystem({ reactions: createCombatReactions() }) };
}
/** Replace the deck with `cards` ({ id: n }), all of them drawn into the hand. */
function handOf(game, cards) {
  game.deck = createDeck({ seedNumber: 1, expedition: game.expedition.number, cards });
  game.deck.drawHand(1, Object.values(cards).reduce((a, b) => a + b, 0));
  return game.deck;
}
const play = (turns, game, card) => {
  const index = game.deck.hand().indexOf(card);
  assert.ok(index >= 0, `${card} in hand`);
  return turns.perform(game, { type: 'playCard', index });
};
const stepCost = (game, to) => strideCost(game, { type: 'move', to });
/** Know and walk `h` (as standing there would). */
const walk = (game, h) => { game.memory.observe(h, 1); game.memory.markWalked(h); };
const snapshot = (game) => JSON.stringify(serializeGame(game, { savedAt: 'x' }));
/** Step east along row 2, one move action per hex, collecting the stride each spent. */
function stepEast(turns, game, n) {
  const spent = [];
  for (let i = 0; i < n; i++) {
    const p = game.player.position;
    const r = turns.perform(game, { type: 'move', to: hex(p.q + 1, p.r) });
    assert.ok(r.ok, `step ${i + 1}: ${r.reason}`);
    assert.equal(r.cost, 1, 'one turn per step');
    spent.push(r.stride);
  }
  return spent;
}

// ---------------------------------------------------------------- what things cost

test('new ground costs terrain × 2, walked ground × 1: grass 2 and 1, dense forest 6 and 3', () => {
  const { game } = setup();
  const grass = hex(2, 2);
  const dense = hex(3, 2);
  assert.equal(stepCost(game, grass), 2);
  assert.equal(stepCost(game, dense), 6);
  assert.equal(stepCost(game, hex(4, 2)), 4, 'hills');
  assert.equal(stepCost(game, hex(5, 2)), 4, 'rocky ground');
  assert.equal(stepCost(game, hex(6, 2)), 6, 'shallow water');
  walk(game, grass);
  walk(game, dense);
  assert.equal(stepCost(game, grass), 1);
  assert.equal(stepCost(game, dense), 3);
  assert.equal(stepStride({ world: game.world, isWalked: () => false }, hex(99, 99)), Infinity, 'off the map');
});

test('gather and interact cost 3; eating, equipping, fighting, waiting and playing cost nothing', () => {
  const { game } = setup();
  game.player.position = hex(3, 0);
  for (const type of ['gather', 'interact']) assert.equal(strideCost(game, { type, at: hex(4, 0) }), ACTION_COSTS[type]);
  assert.equal(ACTION_COSTS.gather, 3);
  assert.equal(ACTION_COSTS.interact, 3);
  for (const type of ['use', 'equip', 'unequip', 'attack', 'defend', 'flee', 'return', 'wait', 'playCard']) {
    assert.equal(strideCost(game, { type, at: hex(4, 0), item: 'rations', slot: 'weapon', index: 0 }), 0, type);
  }
});

test('the sanctuary costs nothing: steps onto it, and gathering or searching from it', () => {
  const { game, world, turns, marks } = setup();
  world.setNode(hex(1, 1), 'deadfall', 3);
  world.setPoi(hex(1, 2), 'camp', 2);
  game.memory.observe(marks.S, SIGHT_RADIUS);
  assert.equal(game.deck.pool(), 0);
  assert.equal(stepCost(game, marks.S), 0);
  assert.equal(stepCost(game, hex(1, 2)), 0, 'the ward: the sanctuary and its neighbours');
  assert.equal(stepCost(game, hex(2, 2)), 2, 'the first hex beyond the ward');
  const g = turns.perform(game, { type: 'gather', at: hex(1, 1) });
  assert.ok(g.ok, g.reason);
  assert.equal(g.stride, 0);
  const i = turns.perform(game, { type: 'interact', at: hex(1, 2) });
  assert.ok(i.ok, i.reason);
  assert.equal(i.stride, 0);
  const m = turns.perform(game, { type: 'move', to: hex(1, 2) });
  assert.ok(m.ok && m.stride === 0, 'a step within the ward is free');
  assert.equal(game.clock.turn, 3, 'each is still one turn');
  assert.equal(game.expedition.tally.stride, 0);
});

test('an action the pool cannot cover is refused and nothing changes', () => {
  const { game, turns } = setup();
  game.player.position = hex(1, 2);
  game.memory.observe(game.player.position, SIGHT_RADIUS);
  const before = snapshot(game);
  const r = turns.perform(game, { type: 'move', to: hex(2, 2) });
  assert.deepEqual([r.ok, r.reason, r.cost, r.pool], [false, 'noStride', 2, 0]);
  assert.equal(snapshot(game), before, 'no turn, no stride, no log, no move');
  game.deck.addStride(1);
  const one = snapshot(game);
  assert.deepEqual([turns.perform(game, { type: 'move', to: hex(2, 2) }).reason, game.deck.pool()], ['noStride', 1]);
  assert.equal(snapshot(game), one, 'a short pool is not spent');
  // Other refusals come first: the action's own checks, then stride.
  assert.equal(turns.perform(game, { type: 'move', to: hex(5, 2) }).reason, 'notAdjacent');
  assert.deepEqual(checkStride(game, { type: 'move', to: hex(2, 2) }), { ok: false, reason: 'noStride', cost: 2, pool: 1 });
});

test('stride is spent as actions are paid, and every move or gather is still exactly one turn', () => {
  const { game, world, turns } = setup();
  handOf(game, { walk: 2 });
  world.setNode(hex(3, 1), 'deadfall', 3);
  assert.equal(play(turns, game, 'walk').turn, 0);
  assert.equal(game.deck.pool(), 6);
  assert.deepEqual(stepEast(turns, game, 2), [0, 2]);
  assert.equal(game.deck.pool(), 4);
  const g = turns.perform(game, { type: 'gather', at: hex(3, 1) });
  assert.deepEqual([g.ok, g.cost, g.stride, game.deck.pool(), game.clock.turn], [true, 1, 3, 1, 3]);
  const refused = turns.perform(game, { type: 'gather', at: hex(3, 1) });
  assert.deepEqual([refused.reason, refused.cost, refused.pool, game.clock.turn], ['noStride', 3, 1, 3]);
  play(turns, game, 'walk');
  assert.ok(turns.perform(game, { type: 'gather', at: hex(3, 1) }).ok);
  assert.deepEqual([game.deck.pool(), game.clock.turn], [4, 4]);
  assert.deepEqual([game.expedition.tally.stride, game.expedition.tally.cards], [8, 2], 'the tally counts stride and cards');
  const sum = summarize(game);
  assert.deepEqual([sum.stride, sum.cards], [8, 2]);
});

// ---------------------------------------------------------------- card effects

test('Climb halves hills and rocky ground only while its stride lasts', () => {
  const { game, turns } = setup([
    '. . . . . . . .',
    '. . . . . . . .',
    'S . . ^ ^ ^ % .',
    '. . . . . . . .',
  ]);
  handOf(game, { climb: 1, walk: 1 });
  play(turns, game, 'climb');
  play(turns, game, 'walk');
  assert.deepEqual(game.deck.portions().map((p) => [p.card, p.stride]), [['climb', 6], ['walk', 6]]);
  assert.equal(stepCost(game, hex(3, 2)), 2, 'new hills: 4, halved');
  assert.equal(stepCost(game, hex(6, 2)), 2, 'new rocky ground: 4, halved');
  assert.equal(stepCost(game, hex(2, 2)), 2, 'grass is unchanged');
  walk(game, hex(5, 2));
  assert.equal(stepCost(game, hex(5, 2)), 1, 'walked hills: 2, halved');
  game.memory.observe(hex(2, 2), SIGHT_RADIUS); // the map knows the route
  // Ward 0, grass 2 (Climb 4 left), hills 2 (2 left), hills 2 (Climb spent),
  // walked hills: Walk's stride now, so full price.
  assert.deepEqual(stepEast(turns, game, 5), [0, 2, 2, 2, 2]);
  assert.equal(game.deck.activeEffect(), null);
  assert.equal(stepCost(game, hex(6, 2)), 4, 'rocky ground at full price once Climb is spent');
  assert.equal(game.deck.pool(), 4);
});

test('a card effect sets the price of an action that starts on its stride', () => {
  const { game, turns } = setup(['S . . ^ . .']);
  handOf(game, { climb: 1, walk: 1 });
  play(turns, game, 'climb');
  play(turns, game, 'walk');
  game.deck.spend(5); // one Climb stride left
  game.player.position = hex(2, 0);
  game.memory.observe(game.player.position, SIGHT_RADIUS);
  const r = turns.perform(game, { type: 'move', to: hex(3, 0) });
  assert.equal(r.stride, 2, 'halved: Climb was in use when the step began');
  assert.deepEqual(game.deck.portions().map((p) => [p.card, p.stride]), [['walk', 5]], 'the rest came from Walk');
});

test('Wade makes shallow water cost as grassland (× 2 on new ground) only while its stride lasts', () => {
  const { game, turns } = setup(['S . ~ ~ ~ .']);
  handOf(game, { wade: 1, walk: 1 });
  play(turns, game, 'wade');
  play(turns, game, 'walk');
  game.memory.observe(hex(2, 0), SIGHT_RADIUS);
  assert.equal(stepCost(game, hex(2, 0)), 2);
  walk(game, hex(4, 0));
  assert.equal(stepCost(game, hex(4, 0)), 1, 'walked shallow water: 1');
  game.memory.observe(hex(4, 0), 0);
  // Ward 0, new shallow 2 (Wade 2 left), new shallow 2 (Wade spent),
  // walked shallow at Walk's price: 3.
  assert.deepEqual(stepEast(turns, game, 4), [0, 2, 2, 3]);
  assert.equal(game.deck.pool(), 3);
});

test('Forage gives one free Gather, then gathering costs again', () => {
  const { game, world, turns } = setup();
  handOf(game, { forage: 1 });
  world.setNode(hex(3, 1), 'deadfall', 4);
  game.player.position = hex(3, 2);
  game.memory.observe(game.player.position, SIGHT_RADIUS);
  const p = play(turns, game, 'forage');
  assert.deepEqual(p.events[0], { type: 'cardPlayed', card: 'forage', stride: 3, freeGathers: 1, pool: 3 });
  assert.equal(strideCost(game, { type: 'gather', at: hex(3, 1) }), 0);
  const free = turns.perform(game, { type: 'gather', at: hex(3, 1) });
  assert.deepEqual([free.ok, free.stride, game.deck.pool(), game.deck.freeGathers()], [true, 0, 3, 0]);
  const paid = turns.perform(game, { type: 'gather', at: hex(3, 1) });
  assert.deepEqual([paid.ok, paid.stride, game.deck.pool()], [true, 3, 0]);
  assert.equal(game.clock.turn, 2, 'one turn each');
});

// ---------------------------------------------------------------- playing cards

test('playing a card takes no turn and enemies do not react; Weary cannot be played', () => {
  const { game, turns } = setup();
  handOf(game, { walk: 1, weary: 1 });
  game.player.position = hex(4, 0);
  game.memory.observe(game.player.position, SIGHT_RADIUS);
  const wolf = game.enemies.add('wolf', hex(5, 0));
  wolf.mode = 'hunting';
  const health = game.player.health;
  const r = play(turns, game, 'walk');
  assert.deepEqual([r.ok, r.cost, r.stride, r.turn, game.clock.turn], [true, 0, 0, 0, 0]);
  assert.equal(game.player.health, health, 'no blow');
  assert.deepEqual(wolf.position, hex(5, 0));
  assert.deepEqual(game.log.at(-1), { type: 'cardPlayed', card: 'walk', stride: 6, pool: 6 });
  assert.deepEqual(game.deck.hand(), ['weary']);
  assert.equal(game.deck.discardCount(), 1);
  const before = snapshot(game);
  const w = turns.perform(game, { type: 'playCard', index: 0 });
  assert.deepEqual([w.ok, w.reason], [false, 'unplayable']);
  assert.equal(turns.perform(game, { type: 'playCard', index: 3 }).reason, 'noCard');
  assert.equal(turns.perform(game, { type: 'playCard', index: 'x' }).reason, 'noCard');
  assert.equal(snapshot(game), before, 'refusals change nothing');
});

test('Second Wind draws another card', () => {
  const { game, turns } = setup();
  handOf(game, { secondWind: 1 });
  game.deck.addCard('walk', 'deck');
  const r = play(turns, game, 'secondWind');
  assert.deepEqual(r.events[0], { type: 'cardPlayed', card: 'secondWind', stride: 4, drew: 'walk', pool: 4 });
  assert.deepEqual(game.deck.hand(), ['walk']);
  // With nothing left to draw it still gives its stride.
  handOf(game, { secondWind: 1 });
  assert.equal(play(turns, game, 'secondWind').events[0].drew, null);
  assert.equal(game.deck.pool(), 4);
});

test('Scout adds +2 sight until the day ends, and what it reveals is mapped at once', () => {
  const { game, turns } = setup([
    '. . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . .',
    'S . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . .',
  ]);
  handOf(game, { scout: 2 });
  const known = game.memory.knownCount;
  assert.equal(sightRadiusOf(game), SIGHT_RADIUS);
  const r = play(turns, game, 'scout');
  assert.equal(r.events[0].sight, 2);
  assert.equal(sightRadiusOf(game), SIGHT_RADIUS + 2);
  assert.ok(r.revealed > 0 && game.memory.knownCount > known, 'more is mapped');
  assert.ok(game.memory.isKnown(hex(SIGHT_RADIUS + 2, 2)));
  play(turns, game, 'scout');
  assert.equal(sightRadiusOf(game), SIGHT_RADIUS + 2, 'bonuses do not stack');
  game.deck.drawHand(2); // a later day (nights come in G05)
  assert.equal(sightRadiusOf(game), SIGHT_RADIUS, 'gone the next day');
});

test('an expedition starts with the starting deck, a hand of 5 and an empty pool', () => {
  const { game } = setup();
  const d = game.deck;
  assert.equal(d.expedition, 1);
  assert.equal(d.hand().length, HAND_SIZE);
  assert.equal(d.pool(), 0);
  assert.deepEqual(d.cardCounts(), STARTING_DECK);
  assert.equal(d.day(), 1);
});

// ---------------------------------------------------------------- travel and planning

test('travel stops when stride runs out, and the rest of the route stays to walk', () => {
  const { game, turns } = setup(['S . . . . . . .']);
  game.memory.observe(hex(4, 0), SIGHT_RADIUS);
  game.deck.addStride(5);
  const events = [];
  const travel = createTravel({
    step: (to) => turns.perform(game, { type: 'move', to }),
    onEvent: (e) => events.push(e),
    schedule: (fn) => { fn(); return 1; },
    cancel: () => {},
  });
  const route = planRoute(game.world, game.player.position, hex(6, 0), { stepCost: planningCost(game) });
  travel.start(route.path);
  const last = events.at(-1);
  // Ward 0, then 2 + 2: 1 left, and the next step needs 2.
  assert.deepEqual([last.type, last.done, last.total, last.cost, last.pool], ['needStride', 3, 6, 2, 1]);
  assert.deepEqual(last.at, hex(4, 0));
  assert.deepEqual(game.player.position, hex(3, 0));
  assert.equal(travel.active, false);
  assert.equal(game.clock.turn, 3, 'the refused step took no turn');
  const rest = planRoute(game.world, game.player.position, hex(6, 0), { stepCost: planningCost(game) });
  assert.deepEqual(rest.path, route.path.slice(3), 'the rest of the route is unchanged');
  assert.match(ST.describeNeedStride('Grassland · q 6, r 0', 3, 6, 2, 1), /^Out of stride after 3 of 6 steps: the next step needs 2, you have 1/);
});

test('routes are planned cheapest in stride: walked ground beats a shorter new way', () => {
  const { game } = setup([
    '. . . . . . . . .',
    '. . . . . . . . .',
    'S . . . . . . . .',
    '. . . . . . . . .',
  ]);
  const from = hex(2, 2);
  const to = hex(7, 2);
  game.memory.observe(hex(4, 2), 10);
  for (let q = 3; q <= 7; q++) walk(game, hex(q, 1)); // a walked track one row up
  const cost = planningCost(game);
  const byTerrain = planRoute(game.world, from, to);
  const byStride = planRoute(game.world, from, to, { stepCost: cost });
  assert.equal(byStride.status, 'ok');
  assert.equal(byStride.cost, dijkstraCost(from, to, cost, game.world.cells()), 'optimal in stride');
  assert.ok(byStride.cost < pathCost([from, ...byTerrain.path], cost), `${byStride.cost} beats the straight way`);
  assert.ok(byStride.path.some((h) => h.r === 1), 'it takes the track');
});

test('planning costs are what pathfinding accepts: finite and ≥ 1 where you can walk, 1 on the sanctuary', () => {
  const { game, world } = setup([
    'S . d ^ % ~ M W',
    '. . . . . . . .',
  ]);
  const cost = planningCost(game);
  for (const h of world.cells()) {
    const c = cost(h);
    if (world.isWalkable(h)) assert.ok(Number.isFinite(c) && c >= 1, `${h.q},${h.r}: ${c}`);
    else assert.equal(c, Infinity);
    if (world.isWalkable(h) && hexDistance(h, world.sanctuary) < 2) assert.equal(c, 1, 'free ground plans as 1');
  }
});

// ---------------------------------------------------------------- text

test('stride text: the line, the hand buttons, played cards and refusals', () => {
  const { game, turns } = setup();
  handOf(game, { climb: 1, weary: 1, forage: 1 });
  assert.equal(ST.describeStride(game.deck), 'Stride 0 · deck 0 · discard 0');
  play(turns, game, 'climb');
  play(turns, game, 'forage');
  assert.equal(ST.describeStride(game.deck), 'Stride 9 · deck 0 · discard 2 · hills and rocky ground at half cost · 1 free Gather');
  const buttons = ST.handButtons(['walk', 'weary']);
  assert.deepEqual(buttons.map((b) => [b.index, b.text, b.playable]), [[0, 'Walk 6', true], [1, 'Weary', false]]);
  assert.match(buttons[0].label, /^Play Walk: \+6 stride\./);
  assert.equal(describeEvent({ type: 'cardPlayed', card: 'walk', stride: 6, pool: 6 }), 'You play Walk: +6 stride, 6 to spend');
  assert.equal(describeEvent({ type: 'cardPlayed', card: 'scout', stride: 2, sight: 2, pool: 2 }), 'You play Scout: +2 stride, 2 to spend · sight +2 today');
  assert.equal(describeEvent({ type: 'cardPlayed', card: 'secondWind', stride: 4, drew: null, pool: 4 }), 'You play Second Wind: +4 stride, 4 to spend · no card left to draw');
  assert.equal(ST.describeNoStride('Forest · q 3, r −2', 4, 1), 'Forest · q 3, r −2 · needs 4 stride, you have 1 · play a card');
  assert.equal(ST.describeCardRefused('unplayable'), 'Weary cannot be played: it gives no stride');
  assert.equal(MOVEMENT_CARDS.scout.effect.sightBonus, 2);
});
