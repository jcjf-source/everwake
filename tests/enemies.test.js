import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance, hexEquals, hexKey, hexNeighbors } from '../src/world/hex.js';
import { ENEMY_TYPES, ENEMY_TYPE_IDS, validateEnemyType } from '../src/data/enemies.js';
import { TERRAIN } from '../src/data/terrain.js';
import { SIGHT_RADIUS } from '../src/world/mapMemory.js';
import { createWorld } from '../src/world/world.js';
import { placeEnemies, CLEARANCE, ENEMY_LAYOUT_VERSION } from '../src/world/enemyPlacement.js';
import { createGame, createTurnSystem } from '../src/core/game.js';
import { createTravel } from '../src/systems/travel.js';
import {
  createEnemies, createEnemyReaction, enemyIntent, stubAttack, SANCTUARY_WARD,
} from '../src/systems/enemies.js';
import { decideTap } from '../src/ui/moveIntent.js';
import { planRoute } from '../src/systems/movement.js';
import * as enemyText from '../src/ui/enemyText.js';
import { describeEvent } from '../src/ui/clockText.js';
import { asciiGame } from './helpers/asciiMap.js';

// A wide open field. S (the sanctuary and start) sits at the west end.
const FIELD = [
  '. . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . .',
  'S . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . .',
  '. . . . . . . . . . . . . . . . . . . .',
];

/** A game on `rows` with the enemy reaction registered. */
function setup(rows = FIELD) {
  const { game, world, marks } = asciiGame(rows);
  const turns = createTurnSystem({ reactions: [createEnemyReaction()] });
  return { game, world, marks, turns };
}

/** Put the player on `h` (outside the pipeline: test setup only). */
function place(game, h) {
  game.player.position = { q: h.q, r: h.r };
  game.memory.observe(h, SIGHT_RADIUS);
}

const move = (turns, game, to) => turns.perform(game, { type: 'move', to });
const wait = (turns, game) => turns.perform(game, { type: 'wait' });
const types = (result) => result.events.map((e) => e.type);

// ---------------------------------------------------------------- data

test('every enemy archetype is valid, and they are distinguishable', () => {
  assert.deepEqual([...ENEMY_TYPE_IDS], ['wolf', 'boar', 'skeleton']);
  for (const id of ENEMY_TYPE_IDS) assert.deepEqual(validateEnemyType(ENEMY_TYPES[id], SIGHT_RADIUS), [], id);
  const sig = (d) => JSON.stringify([d.health, d.attack, d.defense, d.detectRange, d.leashRange, d.moveEvery, d.charge ?? 0, d.territory ?? 0]);
  assert.equal(new Set(ENEMY_TYPE_IDS.map((id) => sig(ENEMY_TYPES[id]))).size, 3, 'distinct stats');
  assert.ok(ENEMY_TYPES.boar.attack > ENEMY_TYPES.wolf.attack, 'boars hit hardest');
  assert.ok(ENEMY_TYPES.boar.charge, 'boars charge');
  assert.equal(ENEMY_TYPES.skeleton.moveEvery, 2, 'skeletons are slow');
  assert.ok(ENEMY_TYPES.skeleton.leashRange > ENEMY_TYPES.wolf.leashRange, 'skeletons are persistent');
  assert.ok(ENEMY_TYPES.wolf.detectRange > ENEMY_TYPES.boar.detectRange, 'wolves notice from farther');
});

test('the validator rejects bad archetypes', () => {
  const bad = { ...ENEMY_TYPES.wolf, detectRange: 6, leashRange: 3, moveEvery: 0, habitat: { forest: 2 } };
  const problems = validateEnemyType(bad, 4);
  assert.ok(problems.some((p) => p.includes('sight')));
  assert.ok(problems.some((p) => p.includes('leashRange')));
  assert.ok(problems.some((p) => p.includes('moveEvery')));
  assert.ok(problems.some((p) => p.includes('habitat')));
});

// ---------------------------------------------------------------- placement

const SEEDS = ['everwake', 'shore-42', 'shrine-64', 'island-133', 'a', 'b', 'c', 'd'];
const worlds = new Map();
const worldOf = (seed) => { if (!worlds.has(seed)) worlds.set(seed, createWorld(seed, 40)); return worlds.get(seed); };

test('spawns are deterministic, on dry walkable land, apart, and clear of the sanctuary', () => {
  const again = createWorld('everwake', 40).enemySpawns;
  assert.deepEqual(again, worldOf('everwake').enemySpawns);
  const seen = new Set();
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    assert.ok(w.enemySpawns.length >= 20 && w.enemySpawns.length <= 70, `${seed}: ${w.enemySpawns.length} enemies`);
    const keys = new Set();
    w.enemySpawns.forEach((e, i) => {
      assert.equal(e.id, i);
      seen.add(e.type);
      const t = w.tileAt(e);
      assert.ok(TERRAIN[t.terrain].walkable && t.terrain !== 'shallowWater', `${seed} ${hexKey(e)} on ${t.terrain}`);
      assert.equal(w.poiAt(e), null, 'never on a POI');
      assert.ok(hexDistance(e, w.sanctuary) >= CLEARANCE, 'clear of the sanctuary');
      assert.ok(hexDistance(e, w.sanctuary) > Math.max(...ENEMY_TYPE_IDS.map((id) => ENEMY_TYPES[id].detectRange)) + 1);
      keys.add(hexKey(e));
    });
    assert.equal(keys.size, w.enemySpawns.length, 'one enemy per hex');
  }
  assert.deepEqual([...seen].sort(), ['boar', 'skeleton', 'wolf']);
});

test('beasts live in their habitat and skeletons guard ruins', () => {
  let guards = 0;
  let ruins = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    for (const e of w.enemySpawns) {
      if (e.type === 'skeleton') {
        assert.ok(hexNeighbors(e).some((n) => w.poiAt(n)?.type === 'ruins'), `${seed}: skeleton ${hexKey(e)} beside ruins`);
      } else {
        assert.ok((ENEMY_TYPES[e.type].habitat[w.tileAt(e).terrain] ?? 0) > 0, `${seed}: ${e.type} on ${w.tileAt(e).terrain}`);
      }
    }
    guards += w.enemySpawns.filter((e) => e.type === 'skeleton').length;
    ruins += w.pois.filter((p) => p.type === 'ruins' && hexDistance(p, w.sanctuary) > CLEARANCE).length;
  }
  assert.ok(guards >= ruins * 0.5, `most ruins are guarded (${guards} of ${ruins})`);
});

test('placement does not depend on map size away from the edge (chunk-ready)', () => {
  const big = worldOf('everwake');
  const small = createWorld('everwake', 30);
  assert.ok(hexEquals(big.sanctuary, small.sanctuary));
  const inner = (list) => list.filter((e) => hexDistance(e, hex(0, 0)) <= 20).map((e) => `${e.type}@${hexKey(e)}`);
  assert.deepEqual(inner(small.enemySpawns), inner(big.enemySpawns));
});

test('golden fingerprint (bump ENEMY_LAYOUT_VERSION if this changes on purpose)', () => {
  const w = worldOf('everwake');
  assert.equal(w.enemyLayoutVersion, ENEMY_LAYOUT_VERSION);
  let h = 0;
  for (const e of w.enemySpawns) h = (Math.imul(h, 31) + e.q * 131 + e.r * 7 + e.type.length) | 0;
  assert.deepEqual({ n: w.enemySpawns.length, h }, { n: 34, h: GOLDEN_HASH });
});
const GOLDEN_HASH = -1342458541;

test('a new game puts every enemy at home, unaware, at full health', () => {
  const w = worldOf('everwake');
  const game = createGame(w);
  assert.equal(game.enemies.list.length, w.enemySpawns.length);
  for (const e of game.enemies.list) {
    const s = w.enemySpawns[e.id];
    assert.ok(hexEquals(e.position, s) && hexEquals(e.home, s));
    assert.equal(e.mode, 'idle');
    assert.equal(e.health, ENEMY_TYPES[e.type].health);
    assert.equal(game.enemies.at(s), e);
  }
});

// ---------------------------------------------------------------- roster

test('the roster keeps one enemy per hex and tracks moves', () => {
  const r = createEnemies([{ id: 0, type: 'wolf', q: 1, r: 1 }]);
  assert.throws(() => r.add('boar', hex(1, 1)), /occupied/);
  assert.throws(() => r.add('dragon', hex(2, 2)), /unknown/);
  const b = r.add('boar', hex(3, 1));
  assert.equal(b.id, 1);
  r.moveTo(b, hex(4, 1));
  assert.equal(r.at(hex(3, 1)), null);
  assert.equal(r.at(hex(4, 1)), b);
  b.health = 0;
  assert.equal(r.at(hex(4, 1)), null, 'the dead occupy nothing');
});

// ---------------------------------------------------------------- AI

test('an idle enemy notices the player within its detect range, and not beyond', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(10, 2));
  place(game, hex(4, 2)); // 6 away
  let r = move(turns, game, hex(5, 2)); // 5 away: out of range
  assert.deepEqual(types(r), []);
  assert.equal(wolf.mode, 'idle');
  assert.ok(hexEquals(wolf.position, hex(10, 2)), 'unaware enemies stay home');
  assert.equal(r.interrupt, null);

  r = move(turns, game, hex(6, 2)); // 4 away: noticed
  assert.deepEqual(types(r), ['enemyDetected']);
  assert.equal(wolf.mode, 'hunting');
  assert.deepEqual(r.interrupt, { reason: 'enemy' }, 'being noticed interrupts travel');
  assert.ok(hexEquals(wolf.position, hex(9, 2)), 'and it closes in the same turn');
  assert.ok(game.memory.isVisible(wolf.position), 'anything that notices you is in sight');
  assert.deepEqual(r.events[0], { type: 'enemyDetected', id: wolf.id, enemy: 'wolf', at: hex(9, 2), from: hex(6, 2) });
});

test('a hunting enemy approaches one hex per turn and attacks only when adjacent', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(10, 2));
  place(game, hex(6, 2));
  wait(turns, game); // noticed, steps to 9
  assert.equal(hexDistance(wolf.position, game.player.position), 3);
  let r = wait(turns, game);
  assert.deepEqual(types(r), []);
  assert.equal(hexDistance(wolf.position, game.player.position), 2);
  assert.equal(r.interrupt, null, 'a chase in progress does not interrupt every step');
  r = wait(turns, game);
  assert.equal(hexDistance(wolf.position, game.player.position), 1);
  assert.deepEqual(types(r), [], 'arriving beside you is not yet an attack');
  const before = JSON.stringify(game.player);
  r = wait(turns, game);
  assert.deepEqual(types(r), ['enemyAttack']);
  assert.deepEqual(r.interrupt, { reason: 'enemy' });
  assert.equal(r.events[0].stub, true, 'combat is a Task 10 handoff');
  assert.equal(r.events[0].damage, 0);
  assert.equal(JSON.stringify(game.player), before, 'the stub attack changes nothing');
  assert.equal(hexDistance(wolf.position, game.player.position), 1, 'it holds its ground to attack');
});

test('the combat handoff receives each attack', () => {
  const { game } = asciiGame(FIELD);
  const calls = [];
  const attack = (g, enemy, opts) => { calls.push([enemy.type, opts.charge]); return [{ type: 'enemyAttack', id: enemy.id, enemy: enemy.type, at: enemy.position, charge: opts.charge, damage: 2 }]; };
  const turns = createTurnSystem({ reactions: [createEnemyReaction({ attack })] });
  game.enemies.add('wolf', hex(8, 2));
  place(game, hex(7, 2));
  const r = wait(turns, game);
  assert.deepEqual(calls, [['wolf', false]]);
  assert.equal(r.events.at(-1).damage, 2);
  assert.deepEqual(stubAttack(game, game.enemies.list[0]).map((e) => e.stub), [true]);
});

test('enemies path around obstacles and never step onto blocked terrain', () => {
  // A mountain wall with a gap at the bottom; the wolf starts behind it.
  const rows = [
    '. . . . . M . . . . . .',
    '. . . . . M . . . . . .',
    'S . . . . M . . . . . .',
    '. . . . . M . . . . . .',
    '. . . . . . . . . . . .',
  ];
  const { game, turns, world } = setup(rows);
  const wolf = game.enemies.add('wolf', hex(7, 1));
  place(game, hex(4, 1));
  const visited = [];
  for (let i = 0; i < 12 && hexDistance(wolf.position, game.player.position) > 1; i++) {
    wait(turns, game);
    visited.push(wolf.position);
  }
  assert.equal(hexDistance(wolf.position, game.player.position), 1, 'it reaches the player around the wall');
  for (const h of visited) assert.ok(world.isWalkable(h), `${hexKey(h)} is walkable`);
  assert.ok(visited.some((h) => h.r === 4), 'it went through the gap');
  for (let i = 1; i < visited.length; i++) assert.ok(hexDistance(visited[i - 1], visited[i]) <= 1, 'one hex per turn');
});

test('an enemy with no way to the player waits rather than crossing blocked ground', () => {
  const rows = [
    '. . . . W W . . . .',
    'S . . . W W . . . .',
    '. . . . W W . . . .',
  ];
  const { game, turns } = setup(rows);
  const wolf = game.enemies.add('wolf', hex(7, 1));
  place(game, hex(3, 1));
  for (let i = 0; i < 4; i++) wait(turns, game);
  assert.equal(wolf.mode, 'hunting');
  assert.ok(wolf.position.q >= 6, 'it stays on its side of the water');
});

test('a hunting enemy gives up beyond its leash, walks home and settles', () => {
  const { game, turns } = setup();
  const boar = game.enemies.add('boar', hex(19, 2));
  const wolf = game.enemies.add('wolf', hex(12, 2));
  place(game, hex(8, 2));
  wait(turns, game);
  assert.equal(wolf.mode, 'hunting');
  // Run west; the wolf follows until the gap exceeds its leash.
  // A wolf is as fast as the player, so put the distance in directly.
  place(game, hex(2, 0));
  const r = wait(turns, game);
  const dis = r.events.find((e) => e.type === 'enemyDisengaged');
  assert.ok(dis, 'it gives up');
  assert.equal(dis.reason, 'distance');
  assert.equal(wolf.mode, 'returning');
  assert.equal(enemyIntent(game, wolf), 'return');
  for (let i = 0; i < 20 && wolf.mode !== 'idle'; i++) wait(turns, game);
  assert.equal(wolf.mode, 'idle');
  assert.ok(hexEquals(wolf.position, wolf.home), 'back home');
  assert.equal(boar.mode, 'idle', 'enemies that never noticed stay put');
  assert.ok(hexEquals(boar.position, hex(19, 2)));
});

test('a wolf keeps pace with a fleeing player (same speed: running alone does not shake it)', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(14, 2));
  place(game, hex(10, 2));
  wait(turns, game); // noticed
  // The player walks west each turn; the wolf keeps pace (same speed), never further than it was.
  let gap = hexDistance(wolf.position, game.player.position);
  for (let q = 9; q >= 3; q--) {
    move(turns, game, hex(q, 2));
    const d = hexDistance(wolf.position, game.player.position);
    assert.ok(d <= gap, 'same speed: no gap opens');
    gap = d;
  }
  assert.equal(wolf.mode, 'hunting');
});

test('reaching the sanctuary ward ends any chase; enemies never enter it', () => {
  const { game, turns, marks } = setup();
  const wolf = game.enemies.add('wolf', hex(5, 2));
  place(game, hex(2, 2));
  wait(turns, game); // noticed, steps to 4,2
  assert.equal(wolf.mode, 'hunting');
  const r = move(turns, game, hex(1, 2)); // inside the ward (1 from S)
  assert.ok(hexDistance(game.player.position, marks.S) < SANCTUARY_WARD);
  assert.equal(r.events.find((e) => e.type === 'enemyDisengaged')?.reason, 'sanctuary');
  // Even when the player stands at the ward's edge, the wolf stops outside it.
  const w2 = game.enemies.add('wolf', hex(4, 4));
  place(game, hex(2, 3));
  for (let i = 0; i < 6; i++) {
    wait(turns, game);
    for (const e of [wolf, w2]) assert.ok(hexDistance(e.position, marks.S) >= SANCTUARY_WARD, 'outside the ward');
  }
});

test('a boar charges along a straight line and strikes in the same turn', () => {
  const { game, turns } = setup();
  const boar = game.enemies.add('boar', hex(12, 2));
  place(game, hex(8, 2)); // 4 away: out of its detect range (3)
  const r0 = move(turns, game, hex(9, 2)); // 3 away in a straight line
  assert.equal(boar.mode, 'hunting');
  assert.deepEqual(types(r0), ['enemyDetected', 'enemyAttack']);
  assert.equal(r0.events[1].charge, true);
  assert.ok(hexEquals(boar.position, hex(10, 2)), 'two hexes in one turn, ending beside you');
  assert.equal(enemyIntent(game, boar), 'attack');
});

test('a boar off the line closes in one hex at a time; a blocked line stops the charge', () => {
  const { game, turns } = setup();
  const boar = game.enemies.add('boar', hex(12, 1));
  place(game, hex(9, 3)); // dq −3, dr +2: 3 away, not on a straight line
  assert.equal(hexDistance(boar.position, game.player.position), 3);
  const r = wait(turns, game);
  assert.deepEqual(types(r), ['enemyDetected']);
  assert.equal(hexDistance(boar.position, game.player.position), 2, 'an ordinary step');

  const rows = ['S . . . . . . . . . . .', '. . . . . . . . . . . .', '. . . . . . . M . . . .'];
  const t = setup(rows);
  const b2 = t.game.enemies.add('boar', hex(9, 2));
  place(t.game, hex(6, 2)); // a straight line, but the dash (8,2 → 7,2) would cross the mountain at 7,2
  const r2 = wait(t.turns, t.game);
  assert.ok(!r2.events.some((e) => e.type === 'enemyAttack'), 'no charge through a mountain');
  assert.ok(t.world.isWalkable(b2.position));
});

test('a boar turns back once you leave its territory', () => {
  const { game, turns } = setup();
  const boar = game.enemies.add('boar', hex(14, 2));
  place(game, hex(12, 2)); // 2 from home
  wait(turns, game);
  assert.equal(boar.mode, 'hunting');
  // Walk west: it follows (and strikes) until you are beyond its ground.
  let gaveUp = null;
  for (let q = 11; q >= 5 && !gaveUp; q--) {
    const r = move(turns, game, hex(q, 2));
    gaveUp = r.events.find((e) => e.type === 'enemyDisengaged') ?? null;
    if (gaveUp) assert.ok(hexDistance(game.player.position, boar.home) > ENEMY_TYPES.boar.territory);
  }
  assert.equal(gaveUp?.reason, 'territory');
  assert.ok(hexDistance(boar.position, game.player.position) <= ENEMY_TYPES.boar.leashRange, 'it was still close: territory, not distance');
  // Staying just outside its ground does not set it off again.
  for (let i = 0; i < 6; i++) assert.ok(!types(wait(turns, game)).includes('enemyDetected'));
  assert.equal(boar.mode === 'returning' || boar.mode === 'idle', true);
});

test('a skeleton moves only every other turn but attacks every turn', () => {
  const { game, turns } = setup();
  const sk = game.enemies.add('skeleton', hex(12, 2));
  place(game, hex(9, 2)); // 3 away: detect range
  const moved = [];
  for (let i = 0; i < 6; i++) {
    const before = sk.position;
    const r = wait(turns, game);
    moved.push(!hexEquals(before, sk.position) ? `m${r.turn % 2}` : types(r).includes('enemyAttack') ? 'a' : '-');
  }
  // Turns 1..6: moves on even turns only; adjacent from turn 4, then attacks every turn.
  assert.deepEqual(moved, ['-', 'm0', '-', 'm0', 'a', 'a']);
});

test('enemies occupy hexes: the player cannot step onto one and they never stack', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(7, 2));
  place(game, hex(6, 2));
  const turn = game.clock.turn;
  const r = move(turns, game, hex(7, 2));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'occupied');
  assert.equal(game.clock.turn, turn, 'refused: no turn passes, nothing reacts');
  assert.ok(hexEquals(wolf.position, hex(7, 2)));

  const pack = [game.enemies.add('wolf', hex(12, 1)), game.enemies.add('wolf', hex(12, 3)), game.enemies.add('boar', hex(11, 2))];
  for (let i = 0; i < 8; i++) {
    wait(turns, game);
    const all = [wolf, ...pack].map((e) => hexKey(e.position));
    assert.equal(new Set(all).size, all.length, 'one per hex');
    assert.ok(!all.includes(hexKey(game.player.position)), 'never on the player');
  }
});

test('nothing moves while idle or on refused actions', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(9, 2));
  place(game, hex(6, 2));
  wait(turns, game);
  const snap = JSON.stringify(game.enemies.list);
  // Idle: time passes in the real world, but no action is performed.
  assert.equal(JSON.stringify(game.enemies.list), snap);
  for (const bad of [{ type: 'move', to: hex(9, 9) }, { type: 'fly' }, { type: 'gather', at: hex(6, 2) }]) {
    assert.equal(turns.perform(game, bad).ok, false);
  }
  assert.equal(JSON.stringify(game.enemies.list), snap, 'refused actions run no reaction');
  assert.equal(wolf.mode, 'hunting');
});

test('being noticed interrupts travel after that step; the rest of the route remains', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(12, 2));
  place(game, hex(4, 2));
  game.memory.reveal(hex(8, 1), 5);
  const route = planRoute(game.world, game.player.position, hex(11, 0), { knows: game.memory.isKnown });
  const evs = [];
  const queue = [];
  const travel = createTravel({ step: (to) => turns.perform(game, { type: 'move', to }), onEvent: (e) => evs.push(e), schedule: (fn) => queue.push(fn), cancel: () => {} });
  travel.start(route.path);
  while (queue.length && travel.active) queue.shift()();
  const last = evs.at(-1);
  assert.equal(last.type, 'interrupted');
  assert.equal(last.reason, 'enemy');
  assert.equal(wolf.mode, 'hunting');
  assert.ok(hexDistance(game.player.position, hex(12, 2)) <= ENEMY_TYPES.wolf.detectRange + 1);
});

// ---------------------------------------------------------------- intent, tap, text

test('intent follows mode and distance', () => {
  const { game, turns } = setup();
  const wolf = game.enemies.add('wolf', hex(12, 2));
  place(game, hex(4, 2));
  assert.equal(enemyIntent(game, wolf), 'idle');
  place(game, hex(8, 2));
  wait(turns, game);
  assert.equal(enemyIntent(game, wolf), 'approach');
  place(game, hex(10, 2));
  assert.equal(enemyIntent(game, wolf), 'attack');
  const boar = game.enemies.add('boar', hex(13, 0));
  boar.mode = 'hunting';
  place(game, hex(10, 0));
  assert.equal(enemyIntent(game, boar), 'charge');
});

test('tapping a visible enemy inspects it; routes go around visible enemies', () => {
  const { game, world } = setup();
  const wolf = game.enemies.add('wolf', hex(4, 2));
  place(game, hex(2, 2));
  game.memory.reveal(hex(10, 2), 6); // mapped, but out of sight
  const enemyAt = (h) => (game.memory.isVisible(h) ? game.enemies.at(h) : null);
  const state = { position: game.player.position, preview: null, travelling: null, knows: game.memory.isKnown, enemyAt };
  assert.deepEqual(decideTap(world, state, hex(4, 2)).action, { kind: 'enemy', at: hex(4, 2) });
  game.enemies.moveTo(wolf, hex(3, 2));
  assert.deepEqual(decideTap(world, state, hex(3, 2)).action, { kind: 'enemy', at: hex(3, 2) }, 'adjacent: inspect, not step');
  const prev = decideTap(world, state, hex(5, 2)).action;
  assert.equal(prev.kind, 'preview');
  assert.ok(!prev.preview.path.some((h) => hexEquals(h, hex(3, 2))), 'the route avoids the wolf');
  // A hidden enemy is not known: the tap behaves as for an empty hex.
  game.enemies.add('boar', hex(15, 2));
  assert.ok(game.memory.isKnown(hex(15, 2)) && !game.memory.isVisible(hex(15, 2)));
  assert.equal(decideTap(world, state, hex(15, 2)).action.kind, 'preview');
});

test('enemy text', () => {
  const wolf = { id: 0, type: 'wolf', health: 8 };
  assert.equal(enemyText.describeEnemy(wolf, 'approach'), 'Wolf · health 8/8 · hunting you');
  assert.equal(enemyText.enemyNote(null, 'idle'), '');
  assert.equal(enemyText.enemyNote(wolf, 'idle'), ' · Wolf · health 8/8 · has not noticed you');
  assert.match(enemyText.describeEnemyHex('Grassland · q 3, r 1', { type: 'boar', health: 12 }, 'charge'), /^Grassland · q 3, r 1 · Boar · health 12\/12 · about to charge · Charges/);
  assert.equal(describeEvent({ type: 'enemyDetected', enemy: 'wolf', at: hex(3, 0), from: hex(0, 0) }), 'A wolf has noticed you · 3 hexes east');
  assert.equal(describeEvent({ type: 'enemyAttack', enemy: 'wolf', charge: false, stub: true }), 'The wolf attacks (combat not implemented yet: no damage)');
  assert.equal(describeEvent({ type: 'enemyAttack', enemy: 'boar', charge: true, stub: true }), 'The boar charges into you (combat not implemented yet: no damage)');
  assert.equal(describeEvent({ type: 'enemyAttack', enemy: 'boar', charge: false }), 'The boar attacks');
  assert.equal(describeEvent({ type: 'enemyDisengaged', enemy: 'wolf', reason: 'distance' }), 'The wolf gives up the chase');
  assert.equal(describeEvent({ type: 'enemyDisengaged', enemy: 'boar', reason: 'territory' }), 'The boar turns back to its ground');
  assert.equal(describeEvent({ type: 'enemyDisengaged', enemy: 'skeleton', reason: 'sanctuary' }), 'The skeleton will not follow you into the sanctuary');
  assert.equal(enemyText.describeOccupied('Grassland · q 1, r 0', wolf), 'Grassland · q 1, r 0 · the wolf is in the way');
  assert.equal(enemyText.describeRouteBlockedBy(hex(2, 0), wolf, 3), 'Route blocked by the wolf at q 2, r 0 · stopped after 3 steps');
});

test('enemy events go to the log, not the journal', () => {
  const { game, turns } = setup();
  game.enemies.add('wolf', hex(9, 2));
  place(game, hex(6, 2));
  wait(turns, game);
  assert.ok(game.log.some((e) => e.type === 'enemyDetected'));
  assert.ok(!game.journal.entries.some((e) => e.type.startsWith('enemy')));
});
