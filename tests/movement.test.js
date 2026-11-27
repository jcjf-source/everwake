import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, hexDistance } from '../src/world/hex.js';
import { createPlayer } from '../src/entities/player.js';
import { planRoute, tryStep } from '../src/systems/movement.js';
import { createTravel } from '../src/systems/travel.js';
import { decideTap } from '../src/ui/moveIntent.js';
import * as text from '../src/ui/travelText.js';
import { TERRAIN } from '../src/data/terrain.js';
import { asciiWorld } from './helpers/asciiMap.js';

const MAP = [
  'S . . f . G',
  '. M M M . .',
  '. . . . . W',
];

/** Manual scheduler: timers run only when the test says so. */
function fakeClock() {
  const queue = [];
  return {
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; queue.push(t); return t; },
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

function setup() {
  const { world, marks } = asciiWorld(MAP);
  const player = createPlayer(marks.S);
  const clock = fakeClock();
  const events = [];
  const positions = [];
  const travel = createTravel({
    step: (to) => { const r = tryStep(player, world, to); if (r.ok) positions.push(player.position); return r; },
    onEvent: (e) => events.push(e),
    delay: 150,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { world, marks, player, clock, events, positions, travel };
}

test('player starts at the given hex with no moves', () => {
  const p = createPlayer(hex(3, -2));
  assert.deepEqual(p, { position: { q: 3, r: -2 }, moves: 0 });
});

test('tryStep: valid neighbour moves one hex and counts one move', () => {
  const { world, player, marks } = setup();
  assert.deepEqual(tryStep(player, world, hex(1, 0)), { ok: true });
  assert.deepEqual(player.position, hex(1, 0));
  assert.equal(player.moves, 1);
  assert.notDeepEqual(player.position, marks.S);
});

test('tryStep: invalid steps change nothing and cost nothing', () => {
  const { world, player } = setup();
  const before = structuredClone(player);
  assert.deepEqual(tryStep(player, world, hex(2, 0)), { ok: false, reason: 'notAdjacent' }); // no teleport
  assert.deepEqual(tryStep(player, world, hex(0, 0)), { ok: false, reason: 'notAdjacent' }); // own hex
  assert.deepEqual(tryStep(player, world, hex(-1, 0)), { ok: false, reason: 'outside' });
  player.position = hex(1, 0);
  assert.deepEqual(tryStep(player, world, hex(1, 1)), { ok: false, reason: 'impassable' }); // mountain
  assert.deepEqual(player.position, hex(1, 0));
  assert.equal(player.moves, before.moves);
});

test('planRoute statuses', () => {
  const { world, marks } = setup();
  assert.deepEqual(planRoute(world, marks.S, marks.S), { status: 'here' });
  assert.deepEqual(planRoute(world, marks.S, hex(9, 9)), { status: 'outside' });
  assert.deepEqual(planRoute(world, marks.S, hex(2, 1)), { status: 'impassable' });
  assert.deepEqual(planRoute(world, marks.S, hex(5, 2)), { status: 'impassable' }); // deep water
  const ok = planRoute(world, marks.S, marks.G);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.path.length, 5, 'path excludes the start');
  assert.deepEqual(ok.path[ok.path.length - 1], marks.G);
  assert.equal(ok.cost, 1 + 1 + 2 + 1 + 1);

  const island = asciiWorld(['S . W . .', '. . W . .', '. . W . .']);
  assert.deepEqual(planRoute(island.world, island.marks.S, hex(4, 0)), { status: 'unreachable' });
});

test('travel: one hex per step, a pause between steps, arrives and leaves no timer', () => {
  const { world, marks, player, clock, events, positions, travel } = setup();
  const route = planRoute(world, marks.S, marks.G);
  travel.start(route.path);
  assert.equal(positions.length, 1, 'the first step is taken at once');
  assert.equal(travel.active, true);
  assert.deepEqual(travel.destination, marks.G);
  assert.equal(travel.remaining.length, 4);
  assert.equal(clock.pending(), 1);
  while (clock.tick()) { /* run each scheduled step */ }
  assert.deepEqual(player.position, marks.G);
  assert.equal(player.moves, 5, 'one move per hex entered');
  let prev = marks.S;
  for (const p of positions) { assert.equal(hexDistance(prev, p), 1, 'never teleports'); prev = p; }
  assert.deepEqual(events.map((e) => e.type), ['step', 'step', 'step', 'step', 'arrived']);
  assert.deepEqual(events.map((e) => e.done), [1, 2, 3, 4, 5]);
  assert.equal(travel.active, false);
  assert.equal(clock.pending(), 0, 'idle: nothing scheduled');
});

test('travel: stop interrupts between steps; restart retargets', () => {
  const { world, marks, player, clock, events, travel } = setup();
  travel.start(planRoute(world, marks.S, marks.G).path);
  clock.tick();
  assert.equal(travel.stop(), true);
  assert.equal(clock.pending(), 0);
  assert.equal(player.moves, 2);
  assert.deepEqual(events.at(-1), { type: 'stopped', done: 2, total: 5, destination: marks.G });
  assert.equal(clock.tick(), false, 'no further steps after stopping');
  assert.equal(travel.stop(), false, 'stopping twice is harmless');

  // Retarget from where we stopped to a different destination.
  const elsewhere = hex(0, 2);
  travel.start(planRoute(world, player.position, elsewhere).path);
  while (clock.tick()) { /* */ }
  assert.deepEqual(player.position, elsewhere);

  // Starting a new route while travelling replaces the old one silently.
  travel.start(planRoute(world, player.position, marks.G).path);
  const n = events.length;
  travel.start(planRoute(world, player.position, hex(4, 2)).path);
  assert.equal(events.slice(n).some((e) => e.type === 'stopped'), false);
  while (clock.tick()) { /* */ }
  assert.deepEqual(player.position, hex(4, 2));
});

test('travel: a route that becomes blocked stops safely at the last good hex', () => {
  const { world, marks, player, clock, events, travel } = setup();
  const route = planRoute(world, marks.S, marks.G).path;
  travel.start(route);
  world.set(route[2], 'mountains'); // the third hex turns impassable mid-journey
  clock.tick(); // second step succeeds
  clock.tick(); // third step is refused
  assert.deepEqual(player.position, route[1]);
  assert.equal(travel.active, false);
  assert.equal(clock.pending(), 0);
  const e = events.at(-1);
  assert.deepEqual([e.type, e.reason, e.done, e.at], ['blocked', 'impassable', 2, route[2]]);
  assert.equal(player.moves, 2, 'the failed step cost nothing');
});

test('decideTap: idle taps', () => {
  const { world, marks } = setup();
  const idle = { position: marks.S, preview: null, travelling: null };
  assert.deepEqual(decideTap(world, idle, null), { stop: false, action: { kind: 'clear' } });
  assert.deepEqual(decideTap(world, idle, marks.S).action, { kind: 'here' });
  assert.deepEqual(decideTap(world, idle, hex(1, 0)).action, { kind: 'step', to: hex(1, 0) });
  assert.deepEqual(decideTap(world, { ...idle, position: hex(1, 0) }, hex(1, 1)).action, { kind: 'impassable', at: hex(1, 1) });
  assert.deepEqual(decideTap(world, idle, hex(2, 1)).action, { kind: 'impassable', at: hex(2, 1) });

  const first = decideTap(world, idle, marks.G).action;
  assert.equal(first.kind, 'preview');
  assert.equal(first.preview.path.length, 5);
  const second = decideTap(world, { ...idle, preview: first.preview }, marks.G).action;
  assert.equal(second.kind, 'travel', 'tapping the previewed destination travels');
  const other = decideTap(world, { ...idle, preview: first.preview }, hex(4, 2)).action;
  assert.equal(other.kind, 'preview', 'tapping elsewhere retargets the preview');
  assert.deepEqual(other.preview.destination, hex(4, 2));

  const island = asciiWorld(['S . W . .', '. . W . .', '. . W . .']);
  const cut = decideTap(island.world, { position: island.marks.S, preview: null, travelling: null }, hex(4, 0));
  assert.deepEqual(cut.action, { kind: 'unreachable', at: hex(4, 0) });
});

test('decideTap: while travelling, a tap stops; other hexes then retarget', () => {
  const { world, marks } = setup();
  const moving = { position: hex(1, 0), preview: null, travelling: marks.G };
  assert.deepEqual(decideTap(world, moving, marks.G), { stop: true, action: null });
  assert.deepEqual(decideTap(world, moving, hex(1, 0)), { stop: true, action: null });
  assert.deepEqual(decideTap(world, moving, null), { stop: true, action: null });
  assert.deepEqual(decideTap(world, moving, hex(2, 0)), { stop: true, action: { kind: 'step', to: hex(2, 0) } });
  const far = decideTap(world, moving, hex(0, 2));
  assert.equal(far.stop, true);
  assert.equal(far.action.kind, 'preview', 'retarget needs a confirming tap like any route');
});

test('movement readout text', () => {
  const sanctuary = hex(0, 0);
  const forest = text.placeLabel(hex(3, -2), TERRAIN.forest, sanctuary);
  assert.equal(forest, 'Forest · q 3, r −2');
  assert.equal(text.placeLabel(hex(0, 0), TERRAIN.grassland, sanctuary), 'Sanctuary · q 0, r 0');
  assert.equal(text.describePreview(forest, 5, 7), 'Route to Forest · q 3, r −2 · 5 steps, terrain cost 7 · tap it again to travel');
  assert.equal(text.describePreview(forest, 1, 2), 'Route to Forest · q 3, r −2 · 1 step, terrain cost 2 · tap it again to travel');
  assert.equal(text.describeTravelling(forest, 2, 5), 'Travelling to Forest · q 3, r −2 · step 2 of 5 · tap to stop');
  assert.equal(text.describeArrived(forest, 5), 'Arrived at Forest · q 3, r −2 · 5 steps');
  assert.equal(text.describeStopped(forest, 2, 5), 'Stopped after 2 of 5 steps · tap Forest · q 3, r −2 again to continue');
  assert.equal(text.describeBlocked(hex(1, 1), 1), 'Route blocked at q 1, r 1 · stopped after 1 step');
  assert.match(text.describeImpassable('Mountains · q 1, r 1'), /impassable/);
  assert.match(text.describeUnreachable('Grassland · q 9, r 0'), /no route/);
  assert.equal(text.describePlayer({ position: hex(-1, 4), moves: 1 }), 'You · q −1, r 4 · 1 move');
});
