import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance } from '../src/world/hex.js';
import {
  createClock, timeOf, advanceClock, serializeClock, restoreClock,
  DAY_PARTS, TURNS_PER_DAY_PART, TURNS_PER_DAY,
} from '../src/core/clock.js';
import { ACTIONS, validateAction } from '../src/core/actions.js';
import { createGame, createTurnSystem, LOG_LIMIT } from '../src/core/game.js';
import { createTravel } from '../src/systems/travel.js';
import { planRoute } from '../src/systems/movement.js';
import { createWorld } from '../src/world/world.js';
import { FOG } from '../src/world/mapMemory.js';
import * as clockText from '../src/ui/clockText.js';
import { asciiGame } from './helpers/asciiMap.js';

// S at (0,0); mountains at (1,1)..(3,1); deep water at (5,2).
const MAP = [
  'S . . f . G',
  '. M M M . .',
  '. . . . . W',
];

/** Manual timer: scheduled steps run only when the test ticks. */
function manualTimer() {
  const queue = [];
  return {
    schedule: (fn) => { const t = { fn, live: true }; queue.push(t); return t; },
    cancel: (t) => { t.live = false; },
    pending: () => queue.filter((t) => t.live).length,
    tick() {
      const t = queue.find((x) => x.live);
      if (!t) return false;
      t.live = false;
      t.fn();
      return true;
    },
  };
}

/** A snapshot of everything an action could change. */
const snapshot = (game) => JSON.stringify({
  position: game.player.position,
  turn: game.clock.turn,
  log: game.log,
  known: game.memory.serialize().known,
});

// ---------------------------------------------------------------- clock

test('clock: day parts follow the turn count', () => {
  assert.equal(TURNS_PER_DAY_PART, 12);
  assert.equal(TURNS_PER_DAY, 48);
  assert.deepEqual(DAY_PARTS, ['morning', 'afternoon', 'evening', 'night']);
  const at = (t) => { const x = timeOf(t); return `${x.day} ${x.part} ${x.turnInPart}`; };
  assert.equal(at(0), '1 morning 0');
  assert.equal(at(11), '1 morning 11');
  assert.equal(at(12), '1 afternoon 0');
  assert.equal(at(24), '1 evening 0');
  assert.equal(at(36), '1 night 0');
  assert.equal(at(47), '1 night 11');
  assert.equal(at(48), '2 morning 0');
  assert.equal(at(48 * 9 + 30), '10 evening 6');
});

test('clock: advancing reports day-part and day boundaries', () => {
  const c = createClock();
  assert.deepEqual(advanceClock(c, 1), { from: 0, to: 1, partChanged: false, dayChanged: false });
  assert.deepEqual(advanceClock(c, 10), { from: 1, to: 11, partChanged: false, dayChanged: false });
  assert.deepEqual(advanceClock(c, 1), { from: 11, to: 12, partChanged: true, dayChanged: false });
  c.turn = 47;
  assert.deepEqual(advanceClock(c, 1), { from: 47, to: 48, partChanged: true, dayChanged: true });
  assert.throws(() => advanceClock(c, 0), RangeError, 'actions always cost at least one turn');
  assert.throws(() => advanceClock(c, 1.5), RangeError);
  assert.throws(() => createClock(-1), RangeError);
  assert.equal(c.turn, 48, 'a refused advance changes nothing');
});

test('clock: save round trip and malformed saves', () => {
  const c = createClock(137);
  const saved = serializeClock(c);
  assert.deepEqual(saved, { version: 1, turn: 137 });
  const back = restoreClock(JSON.parse(JSON.stringify(saved)));
  assert.equal(back.ok, true);
  assert.equal(back.clock.turn, 137);
  for (const bad of [null, 'x', {}, { version: 2, turn: 1 }, { version: 1, turn: -1 }, { version: 1, turn: 1.5 }, { version: 1, turn: '3' }]) {
    const r = restoreClock(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.error, 'string');
  }
});

// ---------------------------------------------------------------- actions

test('every action definition costs a whole number of turns ≥ 1', () => {
  for (const [type, def] of Object.entries(ACTIONS)) {
    assert.ok(Number.isInteger(def.cost) && def.cost >= 1, type);
    assert.equal(typeof def.validate, 'function', type);
    assert.equal(typeof def.apply, 'function', type);
  }
  assert.equal(ACTIONS.move.cost, 1, 'one turn per hex entered');
  assert.equal(ACTIONS.wait.cost, 1);
});

test('a new game starts at turn 0, day 1 morning, on the sanctuary, with only the start revealed', () => {
  const world = createWorld('everwake', 40);
  const game = createGame(world);
  assert.equal(game.clock.turn, 0);
  assert.deepEqual(game.player.position, world.sanctuary);
  assert.equal(game.memory.stateAt(world.sanctuary), FOG.VISIBLE);
  assert.equal(game.memory.knownCount, 61);
  // The only log entries at the start are POIs already in sight (Task 08).
  const inSight = world.pois.filter((p) => game.memory.isKnown(p));
  assert.deepEqual(game.log.map((e) => [e.type, e.at.q, e.at.r]).sort(), inSight.map((p) => ['discovered', p.q, p.r]).sort());
  assert.equal(game.journal.entries.length, inSight.length);
});

test('a successful move costs exactly one turn and moves one hex', () => {
  const { game } = asciiGame(MAP);
  const turns = createTurnSystem();
  const r = turns.perform(game, { type: 'move', to: hex(1, 0) });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.equal(r.turn, 1);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(game.player.position, hex(1, 0));
  assert.deepEqual(r.time, timeOf(1));
});

test('a wait costs exactly one turn and stays put', () => {
  const { game, marks } = asciiGame(MAP);
  const turns = createTurnSystem();
  const r = turns.perform(game, { type: 'wait' });
  assert.equal(r.ok, true);
  assert.equal(game.clock.turn, 1);
  assert.deepEqual(game.player.position, marks.S);
});

test('invalid actions cost no turn and change, log and save nothing', () => {
  const { game } = asciiGame(MAP);
  const saves = [];
  const reacted = [];
  const turns = createTurnSystem({ reactions: [() => { reacted.push(1); }], onSave: (g, r) => saves.push(r) });
  const before = snapshot(game);
  const bad = [
    [{ type: 'move', to: hex(2, 0) }, 'notAdjacent'], // no teleporting
    [{ type: 'move', to: hex(0, 0) }, 'notAdjacent'], // own hex
    [{ type: 'move', to: hex(-1, 0) }, 'outside'],
    [{ type: 'move', to: hex(1, 1) }, 'notAdjacent'], // mountain, not adjacent to (0,0) — still refused
    [{ type: 'move' }, 'badTarget'],
    [{ type: 'move', to: { q: 0.5, r: 0 } }, 'badTarget'],
    [{ type: 'fly' }, 'unknownAction'],
    [{ type: 'toString' }, 'unknownAction'], // no prototype lookups
    [null, 'badAction'],
  ];
  for (const [action, reason] of bad) {
    const r = turns.perform(game, action);
    assert.deepEqual(r, { ok: false, action, reason }, JSON.stringify(action));
  }
  game.player.position = hex(1, 0);
  const atStart = snapshot(game);
  assert.deepEqual(turns.perform(game, { type: 'move', to: hex(1, 1) }).reason, 'impassable');
  assert.equal(snapshot(game), atStart);
  assert.equal(JSON.parse(before).turn, 0);
  assert.equal(game.clock.turn, 0, 'no turn passed');
  assert.deepEqual(saves, [], 'nothing saved');
  assert.deepEqual(reacted, [], 'no reactions ran');
  assert.equal(validateAction(game, { type: 'wait' }).ok, true);
});

// ---------------------------------------------------------------- ordering

test('pipeline order: apply → advance clock → reactions → visibility → log → save', () => {
  const { game } = asciiGame(MAP);
  const order = [];
  const far = hex(5, 0); // 5 from S: unseen at the start, seen once we step to (1,0)
  assert.equal(game.memory.isKnown(far), false);
  const turns = createTurnSystem({
    reactions: [
      (g, ctx) => {
        order.push('react1');
        // The player's move and the new turn are already in effect …
        assert.deepEqual(g.player.position, hex(1, 0));
        assert.equal(g.clock.turn, 1);
        assert.equal(ctx.turn, 1);
        assert.deepEqual(ctx.action, { type: 'move', to: hex(1, 0) });
        // … but visibility is updated after reactions (so moved enemies are seen correctly).
        assert.equal(g.memory.isKnown(far), false);
        assert.deepEqual(g.log, [], 'logging comes later');
        return { events: [{ type: 'test', turn: ctx.turn, n: 1 }] };
      },
      (g) => {
        order.push('react2');
        return { events: [{ type: 'test', turn: g.clock.turn, n: 2 }] };
      },
    ],
    onSave(g, result) {
      order.push('save');
      assert.equal(g.memory.isKnown(far), true, 'visibility updated before saving');
      assert.deepEqual(g.log.map((e) => e.n), [1, 2], 'events logged before saving, in reaction order');
      assert.equal(result.revealed > 0, true);
    },
  });
  const r = turns.perform(game, { type: 'move', to: hex(1, 0) });
  assert.equal(r.ok, true);
  assert.deepEqual(order, ['react1', 'react2', 'save']);
  assert.deepEqual(r.events.map((e) => e.n), [1, 2]);
});

test('reactions can ask to interrupt; the first request wins', () => {
  const { game } = asciiGame(MAP);
  const turns = createTurnSystem({
    reactions: [() => ({ interrupt: { reason: 'enemy' } }), () => ({ interrupt: { reason: 'later' } })],
  });
  assert.deepEqual(turns.perform(game, { type: 'wait' }).interrupt, { reason: 'enemy' });
  assert.equal(createTurnSystem().perform(game, { type: 'wait' }).interrupt, null);
});

// ---------------------------------------------------------------- day parts

test('the day part changes predictably: one event per boundary, logged with its turn', () => {
  const { game } = asciiGame(MAP);
  const turns = createTurnSystem();
  const seen = [];
  for (let i = 1; i <= TURNS_PER_DAY + 1; i++) {
    const r = turns.perform(game, { type: 'wait' });
    assert.equal(r.turn, i);
    for (const e of r.events) seen.push(e);
  }
  assert.deepEqual(seen, [
    { type: 'dayPart', turn: 12, day: 1, part: 'afternoon' },
    { type: 'dayPart', turn: 24, day: 1, part: 'evening' },
    { type: 'dayPart', turn: 36, day: 1, part: 'night' },
    { type: 'dayPart', turn: 48, day: 2, part: 'morning' },
  ]);
  assert.deepEqual(game.log, seen);
  assert.equal(clockText.describeClock(game.clock.turn), 'Morning · day 2 · turn 49');
});

test('the log keeps only the most recent entries', () => {
  const { game } = asciiGame(MAP);
  let n = 0;
  const turns = createTurnSystem({ reactions: [() => ({ events: [{ type: 'test', n: n++ }] })] });
  for (let i = 0; i < LOG_LIMIT + 25; i++) turns.perform(game, { type: 'wait' });
  assert.equal(game.log.length, LOG_LIMIT);
  // The kept entries are the newest, in order (day-part events are mixed in).
  const ns = game.log.filter((e) => e.type === 'test').map((e) => e.n);
  assert.equal(ns.at(-1), LOG_LIMIT + 24);
  ns.forEach((n, i) => assert.equal(n, ns[0] + i));
  assert.ok(ns[0] > 0, 'the oldest entries were dropped');
});

// ---------------------------------------------------------------- routes and idle time

function travelling(reactions = []) {
  const { game, world, marks } = asciiGame(MAP);
  const saves = [];
  const turns = createTurnSystem({ reactions, onSave: (g, r) => saves.push({ turn: r.turn, at: g.player.position }) });
  const timer = manualTimer();
  const events = [];
  const travel = createTravel({
    step: (to) => turns.perform(game, { type: 'move', to }),
    onEvent: (e) => events.push(e),
    schedule: timer.schedule,
    cancel: timer.cancel,
  });
  return { game, world, marks, saves, timer, events, travel };
}

test('a route costs one turn per hex: each step is its own action', () => {
  const { game, world, marks, saves, timer, travel } = travelling();
  const route = planRoute(world, marks.S, marks.G);
  assert.equal(route.path.length, 5);
  assert.ok(route.cost > route.path.length, 'the forest makes terrain cost exceed the step count');
  travel.start(route.path);
  assert.equal(game.clock.turn, 1, 'the first step is one turn');
  while (timer.tick()) { /* each scheduled step */ }
  assert.equal(game.clock.turn, 5, 'turns = hexes entered, not terrain cost');
  assert.deepEqual(saves.map((s) => s.turn), [1, 2, 3, 4, 5], 'one action (and save point) per step');
  let prev = marks.S;
  for (const s of saves) { assert.equal(hexDistance(prev, s.at), 1); prev = s.at; }
});

test('a blocked step mid-route costs no turn', () => {
  const { game, world, marks, timer, events, travel } = travelling();
  const path = planRoute(world, marks.S, marks.G).path;
  travel.start(path);
  world.set(path[2], 'mountains');
  while (timer.tick()) { /* */ }
  assert.equal(events.at(-1).type, 'blocked');
  assert.equal(game.clock.turn, 2);
});

test('a reaction interrupt stops travel after that step', () => {
  const { game, world, marks, timer, events, travel } = travelling([
    (g, ctx) => (ctx.turn === 2 ? { interrupt: { reason: 'ambush' } } : undefined),
  ]);
  travel.start(planRoute(world, marks.S, marks.G).path);
  while (timer.tick()) { /* */ }
  assert.equal(game.clock.turn, 2);
  assert.equal(travel.active, false);
  assert.equal(timer.pending(), 0);
  const e = events.at(-1);
  assert.deepEqual([e.type, e.reason, e.done, e.total], ['interrupted', 'ambush', 2, 5]);
});

test('idle time never advances the game', async () => {
  const { game, world, marks, timer, travel } = travelling();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(game.clock.turn, 0, 'nothing happens before any action');
  travel.start(planRoute(world, marks.S, marks.G).path);
  timer.tick();
  travel.stop();
  const t = game.clock.turn;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(timer.tick(), false, 'no step left scheduled');
  assert.equal(game.clock.turn, t, 'stopped travel stays stopped');
});

// ---------------------------------------------------------------- text

test('clock and event text', () => {
  assert.equal(clockText.describeClock(0), 'Morning · day 1 · turn 0');
  assert.equal(clockText.describeClock(12), 'Afternoon · day 1 · turn 12');
  assert.equal(clockText.describeClock(30), 'Evening · day 1 · turn 30');
  assert.equal(clockText.describeClock(47), 'Night · day 1 · turn 47');
  assert.equal(clockText.describeEvent({ type: 'dayPart', day: 3, part: 'morning' }), 'Day 3 dawns');
  assert.equal(clockText.describeEvent({ type: 'dayPart', day: 1, part: 'night' }), 'Night falls');
  assert.equal(clockText.withEvents('You wait a turn', []), 'You wait a turn');
  assert.equal(
    clockText.withEvents('You wait a turn', [{ type: 'dayPart', day: 1, part: 'evening' }]),
    'You wait a turn · Evening draws in',
  );
});
