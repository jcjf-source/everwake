/**
 * The save format (Task 13): the whole game as versioned, validated JSON.
 *
 *   {
 *     format: 'everwake-save', version: 2, savedAt: ISO time,
 *     world:      { seed, radius, sanctuary, versions: { terrain, resources, pois, enemies } },
 *     clock:      clock.js serializeClock
 *     memory:     mapMemory.js serialize (known and walked hexes; v1, known only, still loads)   sight: last sight radius
 *     changes:    worldChanges.js serialize (spent nodes, used places)
 *     journal:    journal.js serialize
 *     enemies:    enemies.js serialize (position, health, mode per spawn)
 *     player:     { position, health, maxHealth, inventory: { items, equipped } }
 *     expedition: { number, status, startTurn, knownAtStart, tally }
 *     deck:       movementDeck.js serialize (the expedition's movement deck, G03)
 *     progress:   { insight, upgrades, history: [report…] }
 *     log:        the capped game log
 *   }
 *
 * Version 2 (G03) adds the deck and the tally's stride and cards. A version
 * 1 save still loads: its expedition gets a fresh deck (the starting deck
 * and day 1's hand, an empty pool) and its tally starts counting stride and
 * cards from 0. Reports filed before G03 have no stride or cards.
 *
 * The world itself is not saved: it is regenerated from the seed, and the
 * save records which generator versions made it (and where its sanctuary
 * is) so that a save is never applied to a different baseline. Everything
 * else in the game object is saved, including an expedition under way, so a
 * reload resumes exactly where the player stood, mid-chase if need be.
 *
 * `restoreGame` validates every part, and how the parts fit together,
 * before building anything: it never throws and never half-applies. A
 * rejected save is reported with a reason (`error`) the UI can show; it is
 * never changed or deleted here (see systems/saveSlot.js).
 *
 * Simulation only (no DOM).
 */
import { createWorld } from '../world/world.js';
import { normalizeSeed } from '../world/seed.js';
import { hexEquals } from '../world/hex.js';
import { serializeClock, restoreClock, timeOf } from '../core/clock.js';
import { restoreMapMemory, SIGHT_RADIUS } from '../world/mapMemory.js';
import { restoreWorldChanges } from '../world/worldChanges.js';
import { restoreJournal } from './journal.js';
import { restoreEnemies } from './enemies.js';
import { createPlayer } from '../entities/player.js';
import { createInventory } from './inventory.js';
import { ITEM_IDS, SLOTS, slotOf } from '../data/items.js';
import { ENEMY_TYPE_IDS } from '../data/enemies.js';
import { UPGRADE_IDS, maxLevel, effectAt } from '../data/upgrades.js';
import { sightRadiusOf, createExpeditionDeck } from './expedition.js';
import { restoreDeck, MAX_SIGHT_BONUS } from './movementDeck.js';
import { LOG_LIMIT } from '../core/game.js';

export const SAVE_FORMAT = 'everwake-save';
export const SAVE_VERSION = 2;

/** The widest sight a player can have (base plus every Cartographer level, plus Scout). */
const MAX_SIGHT = SIGHT_RADIUS + effectAt('cartographer', maxLevel('cartographer')) + MAX_SIGHT_BONUS;

const clone = (x) => JSON.parse(JSON.stringify(x));
const copyHex = (h) => ({ q: h.q, r: h.r });
/** Generator versions that together make a world's baseline. */
const worldVersions = (w) => ({
  terrain: w.generatorVersion, resources: w.resourceLayoutVersion, pois: w.poiLayoutVersion, enemies: w.enemyLayoutVersion,
});

/** The save form of `game` (plain JSON data). */
export function serializeGame(game, { savedAt = new Date().toISOString() } = {}) {
  const w = game.world;
  const p = game.player;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    world: { seed: w.seed, radius: w.radius, sanctuary: copyHex(w.sanctuary), versions: worldVersions(w) },
    clock: serializeClock(game.clock),
    memory: game.memory.serialize(),
    sight: game.memory.sight ?? sightRadiusOf(game),
    changes: game.changes.serialize(),
    journal: game.journal.serialize(),
    enemies: game.enemies.serialize(),
    player: {
      position: copyHex(p.position), health: p.health, maxHealth: p.maxHealth,
      inventory: { items: { ...p.inventory.items }, equipped: { ...p.inventory.equipped } },
    },
    expedition: clone(game.expedition),
    deck: game.deck.serialize(),
    progress: clone(game.progress),
    log: clone(game.log),
  };
}

/**
 * Parse saved text and restore it (restoreGame). Never throws.
 * @returns {{ ok: true, game: object, savedAt: string | null } | { ok: false, error: string }}
 */
export function parseSave(text, opts) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'the save is not valid JSON (it may have been cut short)' };
  }
  return restoreGame(data, opts);
}

/**
 * Validate a save and rebuild the game from it. Never throws, never
 * half-applies.
 * @param {unknown} data
 * @param {{ radius: number, makeWorld?: (seed: string, radius: number) => object }} opts
 *   `radius`: the map radius this build plays on (a save for another size is refused).
 * @returns {{ ok: true, game: object, savedAt: string | null } | { ok: false, error: string }}
 */
export function restoreGame(data, { radius, makeWorld = createWorld }) {
  try {
    return restore(data, radius, makeWorld);
  } catch (err) {
    return { ok: false, error: `the save could not be read (${err?.message ?? err})` };
  }
}

// ---------------------------------------------------------------- checks

const isInt = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isHex = (h) => isPlain(h) && Number.isSafeInteger(h.q) && Number.isSafeInteger(h.r);

/** Problem with a `{ id: count ≥ 1 }` bundle whose ids must be in `ids`, or null. */
function bundleProblem(b, ids, name) {
  if (!isPlain(b)) return `${name} must be an object`;
  for (const [id, n] of Object.entries(b)) {
    if (!ids.includes(id)) return `${name} names unknown ${id}`;
    if (!isInt(n, 1)) return `${name} ${id} must be a positive whole number`;
  }
  return null;
}

/** Problem with a pack `{ items, equipped }`, or null. */
function packProblem(inv, name) {
  if (!isPlain(inv)) return `${name} must be an object`;
  const items = bundleProblem(inv.items, ITEM_IDS, `${name} items`);
  if (items) return items;
  if (!isPlain(inv.equipped)) return `${name} equipment must be an object`;
  for (const [slot, id] of Object.entries(inv.equipped)) {
    if (!SLOTS.includes(slot)) return `${name} has unknown slot ${slot}`;
    if (id !== null && slotOf(id) !== slot) return `${name} cannot wear ${id} as ${slot}`;
  }
  return null;
}

const TALLY_COUNTS = ['steps', 'farthest', 'places', 'explored', 'stride', 'cards'];
/** Counts a report has only if it was filed since G03. */
const REPORT_COUNTS_SINCE_G03 = ['stride', 'cards'];
const REPORT_COUNTS = ['startTurn', 'endTurn', 'turns', 'steps', 'farthest', 'mapped', 'places', 'explored'];
const INSIGHT_PARTS = ['mapping', 'places', 'explored', 'enemies', 'total'];

function tallyProblem(t, name) {
  if (!isPlain(t)) return `${name} must be an object`;
  for (const k of TALLY_COUNTS) if (!isInt(t[k])) return `${name} ${k} must be a whole number`;
  return bundleProblem(t.gathered, ITEM_IDS, `${name} gathered`)
    ?? bundleProblem(t.found, ITEM_IDS, `${name} found`)
    ?? bundleProblem(t.defeated, ENEMY_TYPE_IDS, `${name} defeated`);
}

function reportProblem(r, i, turn) {
  const name = `expedition report ${i + 1}`;
  if (!isPlain(r)) return `${name} is not an object`;
  if (r.number !== i + 1) return `${name} has the wrong number`;
  for (const k of REPORT_COUNTS) if (!isInt(r[k])) return `${name} ${k} must be a whole number`;
  for (const k of REPORT_COUNTS_SINCE_G03) if (k in r && !isInt(r[k])) return `${name} ${k} must be a whole number`;
  if (r.endTurn < r.startTurn || r.turns !== r.endTurn - r.startTurn || r.endTurn > turn) return `${name} has impossible turns`;
  if (r.outcome !== 'returned' && r.outcome !== 'defeated') return `${name} has unknown outcome ${r.outcome}`;
  if (r.cause !== null && !(r.outcome === 'defeated' && ENEMY_TYPE_IDS.includes(r.cause))) return `${name} has an impossible cause`;
  const parts = bundleProblem(r.gathered, ITEM_IDS, `${name} gathered`)
    ?? bundleProblem(r.found, ITEM_IDS, `${name} found`)
    ?? bundleProblem(r.defeated, ENEMY_TYPE_IDS, `${name} defeated`)
    ?? packProblem(r.pack, `${name} pack`);
  if (parts) return parts;
  if (!isPlain(r.insight) || !INSIGHT_PARTS.every((k) => isInt(r.insight[k]))) return `${name} insight is malformed`;
  const sum = r.insight.mapping + r.insight.places + r.insight.explored + r.insight.enemies;
  if (sum !== r.insight.total) return `${name} insight does not add up`;
  return null;
}

function progressProblem(p, turn) {
  if (!isPlain(p)) return 'progress must be an object';
  if (!isInt(p.insight)) return 'insight must be a whole number';
  if (!isPlain(p.upgrades)) return 'upgrades must be an object';
  for (const [id, level] of Object.entries(p.upgrades)) {
    if (!UPGRADE_IDS.includes(id)) return `unknown upgrade ${id}`;
    if (!isInt(level, 1, maxLevel(id))) return `upgrade ${id} has impossible level ${level}`;
  }
  if (!Array.isArray(p.history)) return 'expedition history must be a list';
  for (let i = 0; i < p.history.length; i++) {
    const problem = reportProblem(p.history[i], i, turn);
    if (problem) return problem;
  }
  return null;
}

function expeditionProblem(x, { turn, known, history }) {
  if (!isPlain(x)) return 'expedition must be an object';
  if (!isInt(x.number, 1)) return 'expedition number must be at least 1';
  if (x.status !== 'active' && x.status !== 'ended') return `unknown expedition status ${x.status}`;
  if (!isInt(x.startTurn, 0, turn)) return 'expedition start turn is impossible';
  if (!isInt(x.knownAtStart, 0, known)) return 'expedition start map count is impossible';
  const finished = x.status === 'ended' ? x.number : x.number - 1;
  if (history.length !== finished) return `expedition ${x.number} does not match ${history.length} reports`;
  return tallyProblem(x.tally, 'expedition tally');
}

function playerProblem(p, world) {
  if (!isPlain(p)) return 'player must be an object';
  if (!isHex(p.position) || !world.has(p.position) || !world.isWalkable(p.position)) return 'player stands where they cannot';
  if (!isInt(p.maxHealth, 1)) return 'player maximum health must be at least 1';
  if (!isInt(p.health, 1, p.maxHealth)) return 'player health is impossible';
  return packProblem(p.inventory, 'pack');
}

function logProblem(log) {
  if (!Array.isArray(log) || log.length > LOG_LIMIT) return `log must be a list of at most ${LOG_LIMIT} entries`;
  return log.every((e) => isPlain(e) && typeof e.type === 'string') ? null : 'log entries must be events';
}

/** Recorded uses must belong to a generated node or place and not exceed what it holds. */
function changesProblem(saved, world) {
  for (const [q, r, taken] of saved.gathered ?? []) {
    const node = world.resourceAt({ q, r });
    if (!node || taken > node.uses) return `gathers recorded at ${q}, ${r} do not fit this world`;
  }
  for (const [q, r, taken] of saved.pois ?? []) {
    const poi = world.poiAt({ q, r });
    if (!poi || taken > poi.uses) return `place uses recorded at ${q}, ${r} do not fit this world`;
  }
  return null;
}

// ---------------------------------------------------------------- restore

function restore(data, radius, makeWorld) {
  const fail = (error) => ({ ok: false, error });
  if (!isPlain(data) || data.format !== SAVE_FORMAT) return fail('this is not an Everwake save');
  if (Number.isSafeInteger(data.version) && data.version > SAVE_VERSION) return fail(`the save was made by a newer version of Everwake (save format ${data.version})`);
  if (data.version !== SAVE_VERSION && data.version !== 1) return fail(`unsupported save format ${data.version}`);
  const v1 = data.version === 1;

  // The world: regenerate it and make sure it is the same baseline.
  const w = data.world;
  if (!isPlain(w)) return fail('world is missing');
  const seed = normalizeSeed(w.seed);
  if (!seed.ok || seed.seed !== w.seed) return fail('world seed is not valid');
  if (w.radius !== radius) return fail(`map size ${w.radius} does not match this version's ${radius}`);
  const world = makeWorld(seed.seed, radius);
  const want = worldVersions(world);
  if (!isPlain(w.versions) || Object.keys(want).some((k) => w.versions[k] !== want[k])) {
    return fail('the save was made with a different world generator');
  }
  if (!isHex(w.sanctuary) || !hexEquals(w.sanctuary, world.sanctuary)) return fail('the world does not match the save (sanctuary moved)');

  // Each part restores itself, validating its own form.
  const clock = restoreClock(data.clock);
  if (!clock.ok) return fail(clock.error);
  const turn = clock.clock.turn;
  const memory = restoreMapMemory(data.memory, radius);
  if (!memory.ok) return fail(memory.error);
  const changes = restoreWorldChanges(data.changes);
  if (!changes.ok) return fail(changes.error);
  const changeFit = changesProblem(data.changes, world);
  if (changeFit) return fail(changeFit);
  const journal = restoreJournal(data.journal);
  if (!journal.ok) return fail(journal.error);
  for (const e of journal.journal.entries) {
    if (e.turn > turn || !world.poiAt(e.at)) return fail('journal entries do not fit this world');
  }
  const enemies = restoreEnemies(data.enemies, world.enemySpawns ?? [], world);
  if (!enemies.ok) return fail(enemies.error);

  // A version 1 tally (before G03) has no stride or cards yet: count from 0.
  const expedition = isPlain(data.expedition) && isPlain(data.expedition.tally) && v1
    ? { ...data.expedition, tally: { stride: 0, cards: 0, ...data.expedition.tally } }
    : data.expedition;

  // The rest is checked here.
  const problem = playerProblem(data.player, world)
    ?? progressProblem(data.progress, turn)
    ?? (isPlain(data.progress) ? expeditionProblem(expedition, { turn, known: memory.memory.knownCount, history: data.progress.history }) : null)
    ?? logProblem(data.log);
  if (problem) return fail(problem);
  if (!isInt(data.sight, 0, MAX_SIGHT)) return fail('sight radius is impossible');
  const pos = data.player.position;
  if (enemies.enemies.at(pos)) return fail('an enemy stands on the player');
  if (expedition.status === 'ended' && !hexEquals(pos, world.sanctuary)) return fail('between expeditions the player must be at the sanctuary');

  // The movement deck (G03): it must belong to this expedition.
  let deck = null;
  if (!v1) {
    const restored = restoreDeck(data.deck, world.seedNumber >>> 0);
    if (!restored.ok) return fail(restored.error);
    if (restored.deck.expedition !== expedition.number) return fail('the movement deck belongs to another expedition');
    deck = restored.deck;
  }

  // Everything checks out: build the game (core/game.js createGame's shape).
  const inv = data.player.inventory;
  const player = createPlayer(pos, {
    maxHealth: data.player.maxHealth,
    inventory: createInventory({
      items: { ...inv.items },
      equipped: Object.fromEntries(Object.entries(inv.equipped).filter(([, id]) => id !== null)),
    }),
  });
  player.health = data.player.health;
  const game = {
    world, player, memory: memory.memory, changes: changes.changes, journal: journal.journal, clock: clock.clock,
    log: clone(data.log), enemies: enemies.enemies, progress: clone(data.progress), expedition: clone(expedition), deck,
  };
  // A version 1 save (before G03): a fresh deck for the current expedition.
  if (v1) game.deck = createExpeditionDeck(game, expedition.number);
  game.memory.showSight(player.position, data.sight);
  // A version 1 map (before walked ground, G01) loads with nothing walked but where the player stands.
  if (memory.version === 1) game.memory.markWalked(player.position);
  return { ok: true, game, savedAt: typeof data.savedAt === 'string' ? data.savedAt : null };
}

/**
 * What a save holds, for the start and confirm dialogs:
 * `{ seed, expedition, status, day, part, turn, insight, upgrades, mapped, total, places }`.
 */
export function gameSummary(game) {
  const t = timeOf(game.clock.turn);
  return {
    seed: game.world.seed,
    expedition: game.expedition.number,
    status: game.expedition.status,
    day: t.day,
    part: t.part,
    turn: game.clock.turn,
    insight: game.progress.insight,
    upgrades: Object.values(game.progress.upgrades).reduce((a, b) => a + b, 0),
    mapped: game.memory.knownCount,
    total: game.memory.totalCount,
    places: game.journal.entries.filter((e) => e.type === 'discovered').length,
  };
}
