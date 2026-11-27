import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, pathCost } from '../src/world/pathfinding.js';
import { hex, hexDistance, hexKey } from '../src/world/hex.js';
import { createRng } from '../src/core/rng.js';
import { createWorld, floodWalkable } from '../src/world/world.js';
import { moveCostFn } from '../src/systems/movement.js';
import { TERRAIN } from '../src/data/terrain.js';
import { asciiWorld, dijkstraCost } from './helpers/asciiMap.js';

/** Every step is to a neighbour and enters a passable hex. */
function assertValidPath(path, start, goal, costOf) {
  assert.deepEqual(path[0], start, 'starts at start');
  assert.deepEqual(path[path.length - 1], goal, 'ends at goal');
  for (let i = 1; i < path.length; i++) {
    assert.equal(hexDistance(path[i - 1], path[i]), 1, `step ${i} is to a neighbour`);
    assert.ok(Number.isFinite(costOf(path[i])), `step ${i} (${hexKey(path[i])}) is passable`);
  }
  assert.equal(new Set(path.map(hexKey)).size, path.length, 'no hex visited twice');
}

test('open ground: straight route of hex-distance length', () => {
  const { marks: { S, G }, costOf } = asciiWorld(['S . . . G']);
  const r = findPath(S, G, { costOf });
  assert.equal(r.found, true);
  assert.deepEqual(r.path, [hex(0, 0), hex(1, 0), hex(2, 0), hex(3, 0), hex(4, 0)]);
  assert.equal(r.cost, 4);
});

test('start equals goal: a zero-cost path of one hex', () => {
  const { marks: { S }, costOf } = asciiWorld(['S .']);
  assert.deepEqual(findPath(S, S, { costOf }), { found: true, path: [S], cost: 0, expanded: 0 });
});

test('a mountain wall forces a detour that never crosses it', () => {
  const { world, marks: { S, G }, costOf } = asciiWorld([
    'S . M . .',
    '. . M . .',
    '. . M . G',
    '. . . . .',
  ]);
  const r = findPath(S, G, { costOf });
  assert.equal(r.found, true);
  assertValidPath(r.path, S, G, costOf);
  assert.ok(r.path.every((h) => world.tileAt(h).terrain !== 'mountains'));
  assert.equal(r.cost, dijkstraCost(S, G, costOf, world.cells()));
  assert.equal(r.cost, 7); // through the only gap, below the wall
});

test('terrain cost: walks around dense forest when that is cheaper', () => {
  const { world, marks: { S, G }, costOf } = asciiWorld([
    '. . . . .',
    'S d d d G',
  ]);
  const r = findPath(S, G, { costOf });
  assert.equal(r.cost, 5); // through the top row, not 3+3+3+1 = 10
  assert.ok(r.path.every((h) => world.tileAt(h).terrain !== 'denseForest'));
  assert.equal(r.cost, pathCost(r.path, costOf));
});

test('terrain cost: pushes through when the detour is longer', () => {
  const { marks: { S, G }, costOf } = asciiWorld([
    'M M M M M',
    'S f . f G',
    '~ ~ ~ ~ ~',
  ]);
  const r = findPath(S, G, { costOf });
  assert.equal(r.cost, 2 + 1 + 2 + 1);
  assert.equal(r.path.length, 5);
});

test('enclosed goal is unreachable; impassable goal is blocked', () => {
  const { marks: { S, G }, costOf } = asciiWorld([
    'S . . M M .',
    '. . M G M .',
    '. . M M . .',
  ]);
  const r = findPath(S, G, { costOf });
  assert.equal(r.found, false);
  assert.equal(r.reason, 'unreachable');
  const wall = findPath(S, hex(3, 0), { costOf });
  assert.deepEqual([wall.found, wall.reason, wall.expanded], [false, 'blocked', 0]);
  const outside = findPath(S, hex(40, 40), { costOf });
  assert.equal(outside.reason, 'blocked', 'off-map goal counts as blocked');
});

test('deep water separates; shallow water can be waded', () => {
  const deep = asciiWorld(['S . W . G', '. . W . .', '. . W . .']);
  assert.equal(findPath(deep.marks.S, deep.marks.G, { costOf: deep.costOf }).reason, 'unreachable');
  const shallow = asciiWorld(['S . ~ . G', '. . W . .']);
  const r = findPath(shallow.marks.S, shallow.marks.G, { costOf: shallow.costOf });
  assert.equal(r.found, true);
  assert.equal(r.cost, 1 + 3 + 1 + 1);
});

test('expansion limit gives up with reason "limit"', () => {
  const { marks: { S, G }, costOf } = asciiWorld(['S . . . . . . . . G']);
  const r = findPath(S, G, { costOf, maxExpanded: 3 });
  assert.deepEqual([r.found, r.reason], [false, 'limit']);
});

test('random small maps: A* matches Dijkstra and paths are valid and deterministic', () => {
  const rng = createRng(4242);
  const chars = ['.', '.', '.', 'f', 'd', '~', 'M', 'W'];
  let found = 0;
  let missing = 0;
  for (let trial = 0; trial < 150; trial++) {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => chars[rng.int(0, chars.length - 1)]).join(''));
    const { world, costOf } = asciiWorld(rows);
    const walkable = world.cells().filter(world.isWalkable);
    if (walkable.length < 2) continue;
    const start = walkable[rng.int(0, walkable.length - 1)];
    const goal = walkable[rng.int(0, walkable.length - 1)];
    const r = findPath(start, goal, { costOf });
    const ref = dijkstraCost(start, goal, costOf, world.cells());
    if (r.found) {
      found++;
      assertValidPath(r.path, start, goal, costOf);
      assert.equal(r.cost, ref, `optimal on\n${rows.join('\n')}`);
      assert.equal(r.cost, pathCost(r.path, costOf));
      assert.deepEqual(findPath(start, goal, { costOf }).path, r.path, 'deterministic');
    } else {
      missing++;
      assert.equal(ref, Infinity, `really unreachable on\n${rows.join('\n')}`);
    }
  }
  assert.ok(found > 50 && missing > 5, `covered both outcomes (${found} found, ${missing} unreachable)`);
});

test('generated world: routes from the sanctuary agree with flood fill and never cross impassable terrain', () => {
  const world = createWorld('everwake', 40);
  const costOf = moveCostFn(world);
  const reachable = new Set(floodWalkable(world.sanctuary, world.isWalkable).map(hexKey));
  const rng = createRng(7);
  let routes = 0;
  let unreachable = 0;
  for (let i = 0; i < 60; i++) {
    const goal = world.cells[rng.int(0, world.cells.length - 1)];
    const r = findPath(world.sanctuary, goal, { costOf });
    if (!world.isWalkable(goal)) {
      assert.equal(r.reason, 'blocked');
    } else if (reachable.has(hexKey(goal))) {
      routes++;
      assert.equal(r.found, true, `route to ${hexKey(goal)}`);
      assertValidPath(r.path, world.sanctuary, goal, costOf);
      assert.ok(r.path.every((h) => TERRAIN[world.tileAt(h).terrain].walkable));
    } else {
      unreachable++;
      assert.equal(r.reason, 'unreachable', `${hexKey(goal)} is cut off`);
    }
  }
  assert.ok(routes >= 20, `found ${routes} routes (${unreachable} unreachable)`);
});
