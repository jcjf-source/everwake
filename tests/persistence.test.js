import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { hexNeighbors, hexDistance, hexEquals, hexesInRange } from '../src/world/hex.js';
import { createGame, createTurnSystem, setOut, LOG_LIMIT } from '../src/core/game.js';
import { createCombatReactions } from '../src/systems/combat.js';
import { nodeState } from '../src/systems/gathering.js';
import { poiState } from '../src/systems/pois.js';
import { buyUpgrade } from '../src/systems/progression.js';
import { sightRadiusOf } from '../src/systems/expedition.js';
import { createMapMemory, FOG } from '../src/world/mapMemory.js';
import { restoreEnemies } from '../src/systems/enemies.js';
import {
  SAVE_FORMAT, SAVE_VERSION, serializeGame, restoreGame, parseSave, gameSummary,
} from '../src/systems/persistence.js';
import {
  SAVE_KEY, DAMAGED_KEY, openStorage, readSave, writeSave, setAsideDamaged, exportText, exportFileName,
} from '../src/systems/saveSlot.js';
import * as S from '../src/ui/saveText.js';

const R = 40;
const SEED = 'everwake';
const worlds = new Map();
const worldFor = (seed) => {
  if (!worlds.has(seed)) worlds.set(seed, createWorld(seed, R));
  return worlds.get(seed);
};
const opts = { radius: R, makeWorld: (seed) => worldFor(seed) };
const AT = 'x';
const save = (game) => serializeGame(game, { savedAt: AT });
const text = (game) => JSON.stringify(save(game));
const roundTrip = (game) => {
  const r = restoreGame(JSON.parse(text(game)), opts);
  assert.ok(r.ok, r.error);
  return r.game;
};
const newGame = (seed = SEED) => createGame(worldFor(seed));
const turnsFor = () => createTurnSystem({ reactions: createCombatReactions() });

/** In-memory Web Storage stand-in. */
function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** Move the player next to `target` (test shortcut, then look around as a step would). */
function standBeside(game, target) {
  const spot = hexNeighbors(target).find((h) => game.world.isWalkable(h) && !game.enemies.at(h)) ?? target;
  game.player.position = { q: spot.q, r: spot.r };
  game.memory.observe(spot, sightRadiusOf(game));
  return spot;
}

/** Walk a few quiet steps away from the sanctuary, one move action each. */
function wander(turns, game, steps) {
  for (let i = 0; i < steps; i++) {
    const next = hexNeighbors(game.player.position)
      .filter((h) => game.world.isWalkable(h) && !game.enemies.at(h))
      .sort((a, b) => hexDistance(b, game.world.sanctuary) - hexDistance(a, game.world.sanctuary))[0];
    const r = turns.perform(game, { type: 'move', to: next });
    if (!r.ok || game.expedition.status !== 'active') return;
  }
}

/** A game with a bit of everything: steps, a gather, a used place, an enemy hunting. */
function busyGame() {
  const game = newGame();
  const turns = turnsFor();
  wander(turns, game, 6);
  const node = game.world.resourceNodes.find((n) => hexDistance(n, game.world.sanctuary) > 3);
  standBeside(game, node);
  assert.ok(turns.perform(game, { type: 'gather', at: { q: node.q, r: node.r } }).ok);
  const poi = game.world.pois.find((p) => p.type !== 'shrine');
  standBeside(game, poi);
  assert.ok(turns.perform(game, { type: 'interact', at: { q: poi.q, r: poi.r } }).ok);
  const spawn = game.world.enemySpawns[0];
  const foe = game.enemies.list.find((e) => e.id === spawn.id);
  foe.mode = 'hunting';
  foe.health -= 1;
  return { game, turns, node, poi, foe };
}

// ---------------------------------------------------------------- round trips

test('a new game saves and restores exactly', () => {
  const game = newGame();
  const data = save(game);
  assert.equal(data.format, SAVE_FORMAT);
  assert.equal(data.version, SAVE_VERSION);
  assert.equal(data.world.seed, SEED);
  assert.equal(text(roundTrip(game)), text(game));
});

test('the save is small and plain JSON', () => {
  const { game } = busyGame();
  const t = text(game);
  assert.ok(t.length < 20000, `${t.length} bytes`);
  assert.deepEqual(JSON.parse(t), save(game));
});

test('an expedition under way restores exactly and then plays on identically', () => {
  const { game, turns } = busyGame();
  const copy = roundTrip(game);
  assert.equal(text(copy), text(game));
  // Same actions on both: the same outcomes, turn by turn.
  const turns2 = turnsFor();
  for (let i = 0; i < 8; i++) {
    const n = hexNeighbors(game.player.position).find((h) => game.world.isWalkable(h) && !game.enemies.at(h));
    const a = turns.perform(game, { type: 'move', to: n });
    const b = turns2.perform(copy, { type: 'move', to: n });
    assert.deepEqual(b, a);
    assert.equal(text(copy), text(game), `after step ${i + 1}`);
    if (game.expedition.status !== 'active') break;
  }
});

test('the restored world is regenerated from the seed: same baseline terrain, nodes, places and spawns', () => {
  const game = newGame('mossy fen 12');
  const r = restoreGame(JSON.parse(text(game)), { radius: R }); // a freshly generated world, not the cached one
  assert.ok(r.ok, r.error);
  const a = game.world;
  const b = r.game.world;
  assert.notEqual(a, b);
  assert.ok(a.cells.every((h) => a.tileAt(h).terrain === b.tileAt(h).terrain && a.tileAt(h).elevation === b.tileAt(h).elevation));
  assert.deepEqual(b.resourceNodes, a.resourceNodes);
  assert.deepEqual(b.pois, a.pois);
  assert.deepEqual(b.enemySpawns, a.enemySpawns);
  assert.deepEqual(b.sanctuary, a.sanctuary);
});

test('depleted nodes, used places, the map and the journal persist', () => {
  const { game, node, poi } = busyGame();
  const copy = roundTrip(game);
  assert.equal(nodeState(copy, node).left, nodeState(game, node).left);
  assert.ok(nodeState(copy, node).left < node.uses);
  assert.equal(poiState(copy, poi).used, 1);
  assert.equal(copy.memory.knownCount, game.memory.knownCount);
  assert.deepEqual(copy.memory.knownHexes(), game.memory.knownHexes());
  assert.deepEqual(copy.journal.entries, game.journal.entries);
  assert.equal(copy.clock.turn, game.clock.turn);
});

test('the player, pack, enemies and log persist', () => {
  const { game, foe } = busyGame();
  const copy = roundTrip(game);
  assert.deepEqual(copy.player, game.player);
  const f = copy.enemies.list.find((e) => e.id === foe.id);
  assert.equal(f.mode, 'hunting');
  assert.equal(f.health, foe.health);
  assert.deepEqual(f.home, foe.home);
  assert.equal(copy.enemies.at(f.position), f, 'the hex index is rebuilt');
  assert.deepEqual(copy.log, game.log);
});

test('what was in sight is restored, and nothing new is mapped', () => {
  const { game } = busyGame();
  const copy = roundTrip(game);
  for (const h of hexesInRange(game.player.position, 6)) {
    if (game.world.has(h)) assert.equal(copy.memory.stateAt(h), game.memory.stateAt(h), `${h.q},${h.r}`);
  }
  assert.equal(copy.memory.sight, game.memory.sight);
});

test('between expeditions: the sanctuary, reports, insight and upgrades persist; Cartographer bought after the return reveals nothing on load', () => {
  const game = newGame();
  const turns = turnsFor();
  wander(turns, game, 1);
  game.player.position = { ...game.world.sanctuary };
  assert.ok(turns.perform(game, { type: 'return' }).ok);
  game.progress.insight = 500;
  assert.ok(buyUpgrade(game, 'cartographer').ok);
  assert.ok(buyUpgrade(game, 'survivor').ok);
  const known = game.memory.knownCount;
  const copy = roundTrip(game);
  assert.equal(copy.expedition.status, 'ended');
  assert.equal(copy.memory.knownCount, known);
  assert.deepEqual(copy.progress, game.progress);
  assert.equal(copy.memory.sight, game.memory.sight, 'the sight the player last looked with, not the new one');
  // Setting out from the restored game matches setting out from the original.
  const a = setOut(game);
  const b = setOut(copy);
  assert.deepEqual(b, a);
  assert.equal(text(copy), text(game));
});

test('a defeat persists: pack lost, at the sanctuary, report filed', () => {
  const game = newGame();
  const turns = turnsFor();
  wander(turns, game, 3);
  const p = game.player.position;
  const spot = hexNeighbors(p).find((h) => game.world.isWalkable(h) && !game.enemies.at(h) && hexDistance(h, game.world.sanctuary) >= 2);
  const e = game.enemies.list.find((x) => x.type === 'wolf');
  game.enemies.moveTo(e, spot);
  e.mode = 'hunting';
  game.player.health = 1;
  const r = turns.perform(game, { type: 'wait' });
  assert.equal(r.ended?.outcome, 'defeated');
  const copy = roundTrip(game);
  assert.equal(text(copy), text(game));
  assert.equal(copy.expedition.status, 'ended');
  assert.deepEqual(copy.player.position, game.world.sanctuary);
  assert.deepEqual(copy.player.inventory.items, {});
  assert.equal(copy.progress.history[0].outcome, 'defeated');
  assert.equal(copy.progress.history[0].cause, 'wolf');
  // After a defeat, the next expedition sets out with the basic kit, from either copy.
  assert.deepEqual(setOut(copy), setOut(game));
  assert.equal(text(copy), text(game));
});

// ---------------------------------------------------------------- validation

/** Restore a mutated copy of `game`'s save; returns the error (asserting it failed). */
function rejects(game, mutate, pattern) {
  const data = JSON.parse(text(game));
  mutate(data);
  const r = restoreGame(data, opts);
  assert.equal(r.ok, false, 'should be refused');
  assert.equal(typeof r.error, 'string');
  if (pattern) assert.match(r.error, pattern);
  return r.error;
}

test('not a save, a newer save, or an unknown version is refused with a reason', () => {
  const game = newGame();
  assert.match(parseSave('{"format":', opts).error, /not valid JSON/);
  assert.match(parseSave('null', opts).error, /not an Everwake save/);
  assert.match(parseSave('[1,2]', opts).error, /not an Everwake save/);
  rejects(game, (d) => { d.format = 'other'; }, /not an Everwake save/);
  rejects(game, (d) => { d.version = SAVE_VERSION + 1; }, /newer version/);
  rejects(game, (d) => { d.version = 0; }, /unsupported save format/);
});

test('a save for another world baseline is refused', () => {
  const game = newGame();
  rejects(game, (d) => { d.world.seed = '<bad>'; }, /seed/);
  rejects(game, (d) => { d.world.radius = 20; }, /map size/);
  rejects(game, (d) => { d.world.versions.terrain += 1; }, /different world generator/);
  rejects(game, (d) => { delete d.world.versions; }, /different world generator/);
  rejects(game, (d) => { d.world.sanctuary.q += 1; }, /sanctuary/);
});

test('malformed parts are refused', () => {
  const { game, node } = busyGame();
  const cases = [
    [(d) => { d.clock.turn = -1; }, /clock/],
    [(d) => { d.memory.known = d.memory.known.slice(4); }, /map memory/],
    [(d) => { d.memory.known = '%%%'; }, /map memory/],
    [(d) => { d.changes.gathered = [[node.q, node.r, 99]]; }, /do not fit/],
    [(d) => { const h = d.world.sanctuary; d.changes.gathered = [[h.q, h.r, 1]]; }, /do not fit/],
    [(d) => { d.changes.pois = [[0, 0, 0]]; }, /pois/],
    [(d) => { d.journal.entries[0].at = { ...d.world.sanctuary }; }, /journal/],
    [(d) => { d.enemies.list.pop(); }, /enemies/],
    [(d) => { d.enemies.list.push([...d.enemies.list[0]]); }, /twice/],
    [(d) => { d.enemies.list[0][0] = 99999; }, /not in this world/],
    [(d) => { d.enemies.list[0][4] = 'dancing'; }, /mode/],
    [(d) => { d.enemies.list[0][3] = 999; }, /health/],
    [(d) => { d.enemies.list[0][1] = d.world.sanctuary.q; d.enemies.list[0][2] = d.world.sanctuary.r; }, /cannot/],
    [(d) => { d.enemies.list[1][1] = d.enemies.list[0][1]; d.enemies.list[1][2] = d.enemies.list[0][2]; d.enemies.list[1][3] = 1; d.enemies.list[0][3] = 1; }, /share|cannot/],
    [(d) => { d.player.position = { q: 999, r: 0 }; }, /player stands/],
    [(d) => { d.player.health = 0; }, /health/],
    [(d) => { d.player.health = d.player.maxHealth + 1; }, /health/],
    [(d) => { d.player.inventory.items.gold = 3; }, /unknown gold/],
    [(d) => { d.player.inventory.items.rations = 0; }, /positive/],
    [(d) => { d.player.inventory.items = JSON.parse('{"__proto__": 1}'); }, /unknown __proto__/],
    [(d) => { d.player.inventory.equipped.weapon = 'paddedJerkin'; }, /cannot wear/],
    [(d) => { d.player.inventory.equipped.hat = null; }, /slot/],
    [(d) => { d.progress.insight = -5; }, /insight/],
    [(d) => { d.progress.upgrades.survivor = 9; }, /level/],
    [(d) => { d.progress.upgrades.flight = 1; }, /unknown upgrade/],
    [(d) => { d.expedition.number = 2; }, /reports/],
    [(d) => { d.expedition.status = 'paused'; }, /status/],
    [(d) => { d.expedition.startTurn = d.clock.turn + 1; }, /start turn/],
    [(d) => { d.expedition.tally.gathered = { wood: -1 }; }, /tally/],
    [(d) => { d.log = Array.from({ length: LOG_LIMIT + 1 }, () => ({ type: 'x' })); }, /log/],
    [(d) => { d.log = [5]; }, /log/],
    [(d) => { d.sight = -1; }, /sight/],
    [(d) => { d.expedition = null; }, /expedition/],
    [(d) => { d.player = 'me'; }, /player/],
  ];
  cases.forEach(([mutate, pattern], i) => { try { rejects(game, mutate, pattern); } catch (err) { throw new Error(`case ${i}: ${err.message}`); } });
});

test('malformed reports are refused; an enemy on the player or a player away from the sanctuary between expeditions is refused', () => {
  const game = newGame();
  const turns = turnsFor();
  wander(turns, game, 1);
  game.player.position = { ...game.world.sanctuary };
  assert.ok(turns.perform(game, { type: 'return' }).ok);
  rejects(game, (d) => { d.progress.history[0].insight.total += 1; }, /add up/);
  rejects(game, (d) => { d.progress.history[0].outcome = 'vanished'; }, /outcome/);
  rejects(game, (d) => { d.progress.history[0].cause = 'wolf'; }, /cause/);
  rejects(game, (d) => { d.progress.history[0].endTurn = d.clock.turn + 5; }, /turns/);
  rejects(game, (d) => { d.progress.history[0].defeated = { dragon: 1 }; }, /unknown dragon/);
  rejects(game, (d) => { d.progress.history = []; }, /reports/);
  rejects(game, (d) => { const n = d.world.sanctuary; d.player.position = { q: n.q + 1, r: n.r }; }, /sanctuary/);
  const busy = busyGame().game;
  rejects(busy, (d) => {
    const e = d.enemies.list[0];
    e[1] = d.player.position.q; e[2] = d.player.position.r; e[3] = 1;
  }, /on the player|cannot/);
});

test('restoreGame never throws and never changes its input, whatever it is given', () => {
  const { game } = busyGame();
  const base = text(game);
  const junk = [undefined, null, 0, 'save', [], {}, { format: SAVE_FORMAT }, { format: SAVE_FORMAT, version: 1 }];
  for (const j of junk) assert.equal(restoreGame(j, opts).ok, false);
  // Knock out or scramble each part in turn.
  const data = JSON.parse(base);
  const values = [null, 7, 'x', [], {}, true, -1];
  for (const key of Object.keys(data)) {
    for (const v of values) {
      const d = JSON.parse(base);
      d[key] = v;
      const frozen = JSON.stringify(d);
      const r = restoreGame(d, opts);
      assert.equal(typeof r.ok, 'boolean');
      const valid = key === 'savedAt' || (key === 'log' && Array.isArray(v)); // any savedAt; an empty log
      if (!valid) assert.equal(r.ok, false, `${key} = ${JSON.stringify(v)}`);
      assert.equal(JSON.stringify(d), frozen, 'input unchanged');
    }
  }
  for (const part of ['player', 'expedition', 'progress', 'world']) {
    for (const key of Object.keys(data[part])) {
      for (const v of values) {
        const d = JSON.parse(base);
        d[part][key] = v;
        const r = restoreGame(d, opts);
        assert.equal(typeof r.ok, 'boolean', `${part}.${key}`);
      }
    }
  }
});

test('restoreEnemies rebuilds positions, health, modes and the hex index from the spawns', () => {
  const world = worldFor(SEED);
  const game = newGame();
  const [a, b] = game.enemies.list;
  game.enemies.kill(a);
  b.mode = 'returning';
  const r = restoreEnemies(game.enemies.serialize(), world.enemySpawns, world);
  assert.ok(r.ok, r.error);
  const ra = r.enemies.list.find((e) => e.id === a.id);
  assert.equal(ra.health, 0);
  assert.equal(r.enemies.at(ra.position), null, 'the fallen hold no hex');
  assert.equal(r.enemies.list.find((e) => e.id === b.id).mode, 'returning');
  // reset() still works on a restored roster: the fallen stay fallen.
  r.enemies.reset();
  assert.equal(r.enemies.list.find((e) => e.id === a.id).health, 0);
});

test('showSight restores visibility around a hex without mapping anything', () => {
  const mem = createMapMemory(10);
  mem.observe({ q: 0, r: 0 }, 2);
  const known = mem.knownCount;
  mem.showSight({ q: 1, r: 0 }, 4);
  assert.equal(mem.knownCount, known);
  assert.equal(mem.sight, 4);
  assert.equal(mem.stateAt({ q: 0, r: 0 }), FOG.VISIBLE);
  assert.equal(mem.stateAt({ q: 5, r: 0 }), FOG.UNKNOWN);
  mem.showSight({ q: 0, r: 0 }, 0);
  assert.equal(mem.stateAt({ q: 1, r: 0 }), FOG.REMEMBERED);
});

test('gameSummary reports what a save holds', () => {
  const { game } = busyGame();
  const s = gameSummary(game);
  assert.equal(s.seed, SEED);
  assert.equal(s.expedition, 1);
  assert.equal(s.status, 'active');
  assert.equal(s.turn, game.clock.turn);
  assert.equal(s.mapped, game.memory.knownCount);
  assert.ok(s.places >= 1);
});

// ---------------------------------------------------------------- the save slot

test('save slot: empty, then saved and read back', () => {
  const st = memoryStorage();
  assert.deepEqual(readSave(st, opts), { status: 'empty' });
  const { game } = busyGame();
  const w = writeSave(st, game, { now: () => '2026-11-27T12:00:00.000Z' });
  assert.ok(w.ok);
  assert.equal(w.bytes, st.getItem(SAVE_KEY).length);
  const r = readSave(st, opts);
  assert.equal(r.status, 'ok');
  assert.equal(r.savedAt, '2026-11-27T12:00:00.000Z');
  assert.equal(text(r.game), text(game));
});

test('save slot: a damaged save is reported with its reason and left exactly as it was', () => {
  const broken = '{"format":"everwake-save","version":1,"world":';
  const st = memoryStorage({ [SAVE_KEY]: broken });
  const r = readSave(st, opts);
  assert.equal(r.status, 'damaged');
  assert.match(r.error, /not valid JSON/);
  assert.equal(r.raw, broken);
  assert.equal(st.getItem(SAVE_KEY), broken, 'not deleted or rewritten');
  assert.equal(st.map.size, 1);
  // Setting it aside copies it to the backup key before anything replaces it.
  assert.ok(setAsideDamaged(st, r.raw).ok);
  assert.equal(st.getItem(DAMAGED_KEY), broken);
  assert.ok(writeSave(st, newGame()).ok);
  assert.equal(st.getItem(DAMAGED_KEY), broken, 'the backup survives the new save');
  // A valid-JSON save that fails validation is damaged too.
  const st2 = memoryStorage({ [SAVE_KEY]: JSON.stringify({ format: SAVE_FORMAT, version: 1 }) });
  assert.equal(readSave(st2, opts).status, 'damaged');
});

test('save slot: storage that refuses is reported, never thrown', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(readSave(blocked, opts).status, 'unavailable');
  assert.equal(openStorage(() => { throw new Error('denied'); }).ok, false);
  assert.match(openStorage(() => null).error, /no local storage/);
  assert.equal(openStorage(() => memoryStorage()).ok, true);
  const full = memoryStorage();
  full.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const w = writeSave(full, newGame());
  assert.equal(w.ok, false);
  assert.equal(w.error, 'browser storage is full');
  assert.equal(setAsideDamaged(full, 'x').ok, false);
  // A write that does not stick is reported.
  const lossy = memoryStorage();
  lossy.setItem = (k, v) => lossy.map.set(k, v.slice(0, 10));
  assert.equal(writeSave(lossy, newGame()).ok, false);
});

test('export: the file is the save, and it imports back', () => {
  const { game } = busyGame();
  const file = exportText(game, { now: () => AT });
  const r = parseSave(file, opts);
  assert.ok(r.ok, r.error);
  assert.equal(text(r.game), text(game));
  assert.equal(exportFileName(game, 3), 'everwake-everwake-day-3.json');
  assert.equal(exportFileName({ world: { seed: 'Mossy fen 12' } }, 1), 'everwake-mossy-fen-12-day-1.json');
});

// ---------------------------------------------------------------- text

test('save text', () => {
  const s = { seed: 'misty-tarn-417', expedition: 3, status: 'active', day: 2, part: 'evening', turn: 70, insight: 37, upgrades: 2, mapped: 412, total: 4921, places: 5 };
  assert.equal(S.describeSummary(s), 'misty-tarn-417 · expedition 3 under way · day 2, evening');
  assert.equal(S.describeSummary({ ...s, status: 'ended' }), 'misty-tarn-417 · expedition 3 over · at the sanctuary · day 2, evening');
  assert.equal(S.describeProgress(s), '412 of 4,921 hexes mapped · 5 places found · 37 insight · 2 upgrade levels');
  assert.equal(S.describeProgress({ ...s, places: 1, upgrades: 1 }), '412 of 4,921 hexes mapped · 1 place found · 37 insight · 1 upgrade level');
  assert.match(S.describeSaveStatus({ state: 'saved', turn: 70, day: 2, part: 'evening' }), /last saved on turn 70 \(day 2, evening\)/);
  assert.match(S.describeSaveStatus({ state: 'failed', error: 'browser storage is full' }), /^Not saved: browser storage is full/);
  assert.match(S.describeSaveStatus({ state: 'unavailable', error: 'x' }), /^Not saving/);
  assert.equal(S.describeSaveStatus({ state: 'none' }), '');
  assert.equal(S.hudSaveWarning({ state: 'saved' }), '');
  assert.equal(S.hudSaveWarning({ state: 'failed', error: 'browser storage is full' }), 'Not saved · browser storage is full');
  const c = S.confirmReplace({ current: s, seed: 'new-one' });
  assert.equal(c.confirm, 'Replace world');
  assert.equal(c.cancel, 'Keep my world');
  assert.ok(c.lines.some((l) => l.includes('This erases misty-tarn-417')));
  assert.ok(c.lines.some((l) => l.includes('cannot be undone')));
  const d = S.confirmReplace({ current: null, damaged: true, seed: 'new-one' });
  assert.ok(d.lines.some((l) => l.includes('kept as a backup')));
  const i = S.confirmImport({ current: s, incoming: { ...s, seed: 'other' } });
  assert.ok(i.lines[0].startsWith('The file holds other'));
  assert.match(S.describeImportError('this is not an Everwake save'), /Your current world is unchanged/);
  assert.match(S.recoveryReason('bad'), /could not be loaded: bad\.$/);
  assert.match(S.linkNote('x'), /another world, “x”/);
});
