/**
 * Expeditions (Task 12): one trip out from the sanctuary, from setting out
 * until the player returns or falls, and what each ending keeps.
 *
 *   game.expedition = { number, status: 'active' | 'ended', startTurn, knownAtStart, tally }
 *
 * *Expedition state*: the tally (steps, the farthest point reached, what was
 * gathered and found, enemies defeated, places discovered and explored) is
 * kept by the turn pipeline (core/game.js `recordTurn`) from each turn's
 * events, so it never drifts from what actually happened. Hexes mapped are
 * derived from map memory (`knownCount − knownAtStart`).
 *
 * An expedition ends in one of two ways, both ordinary turns through the
 * pipeline:
 *  - **return**: the `return` action, taken on sanctuary ground (the ward)
 *    once the expedition has taken at least one turn. The pack is kept: the
 *    next expedition sets out with it, topped up with the starting kit's
 *    basics (`resupply`);
 *  - **defeat**: health reaches 0 (systems/combat.js carries the player
 *    home). Everything carried and worn is lost; the next expedition sets
 *    out with the basic starting kit.
 * Either way the expedition is finished: its report goes into
 * `game.progress.history`, its insight is added to the balance
 * (systems/progression.js), and actions are refused (`noExpedition`) until
 * the player sets out again.
 *
 * What survives an ending is everything that is not expedition state: the
 * world and its seed, map memory, the journal, world changes (spent nodes,
 * used places), fallen enemies (they stay fallen), the clock, insight and
 * upgrades. Setting out (`beginExpedition`) resets the rest: a fresh player
 * at the sanctuary at full health (with the Survivor bonus), the pack as
 * above, and every surviving enemy back home, healed and unaware.
 *
 * Simulation only (no DOM).
 */
import { createPlayer, PLAYER_BASE, STARTING_KIT } from '../entities/player.js';
import { SIGHT_RADIUS } from '../world/mapMemory.js';
import { hexDistance } from '../world/hex.js';
import { effectsOf } from '../data/upgrades.js';
import { SLOTS } from '../data/items.js';
import { createInventory, addItem, countOf, equip, equippedIn } from './inventory.js';
import { inSanctuaryWard } from './enemies.js';
import { discoverIn } from './pois.js';
import { insightFor } from './progression.js';

/** The player's sight radius: the base plus Cartographer. */
export const sightRadiusOf = (game) => SIGHT_RADIUS + effectsOf(game).sight;

/** The player's maximum health at the start of an expedition: the base plus Survivor. */
export const maxHealthOf = (game) => PLAYER_BASE.maxHealth + effectsOf(game).maxHealth;

const emptyTally = () => ({ steps: 0, farthest: 0, gathered: {}, found: {}, defeated: {}, places: 0, explored: 0 });

/** A new active expedition starting now (after the start's sight has been observed). */
export function createExpedition(game, number) {
  return { number, status: 'active', startTurn: game.clock.turn, knownAtStart: game.memory.knownCount, tally: emptyTally() };
}

const isActive = (game) => game.expedition?.status === 'active';
const add = (bundle, id, n) => { bundle[id] = (bundle[id] ?? 0) + n; };
const addBundle = (bundle, from) => { for (const [id, n] of Object.entries(from ?? {})) add(bundle, id, n); };
const copyPack = (inv) => ({ items: { ...inv.items }, equipped: { ...inv.equipped } });

/** The expedition so far, as a report would show it (also used for the finished report). */
export function summarize(game) {
  const x = game.expedition;
  const t = x.tally;
  const mapped = game.memory.knownCount - x.knownAtStart;
  const summary = {
    number: x.number, startTurn: x.startTurn, endTurn: game.clock.turn, turns: game.clock.turn - x.startTurn,
    steps: t.steps, farthest: t.farthest, mapped,
    gathered: { ...t.gathered }, found: { ...t.found }, defeated: { ...t.defeated },
    places: t.places, explored: t.explored,
  };
  summary.insight = insightFor(summary);
  return summary;
}

// ---------------------------------------------------------------- returning

/** Can the player end the expedition here by returning? (changes nothing) */
export function checkReturn(game) {
  if (!isActive(game)) return { ok: false, reason: 'noExpedition' };
  if (!inSanctuaryWard(game.world, game.player.position)) return { ok: false, reason: 'notAtSanctuary' };
  if (game.clock.turn === game.expedition.startTurn) return { ok: false, reason: 'notStarted' };
  return { ok: true };
}

/** The `return` action's effect (validated): step onto the sanctuary itself. */
export function returnHome(game) {
  const s = game.world.sanctuary;
  game.player.position = { q: s.q, r: s.r };
  return [{ type: 'returned', number: game.expedition.number }];
}

// ---------------------------------------------------------------- the tally and the ending

/**
 * Add one successful turn to the tally (the turn pipeline calls this after
 * logging). A `returned` or `defeated` event finishes the expedition; the
 * finished report is returned, else null.
 * @param {object} game
 * @param {{ action: object, events: object[] }} turn
 */
export function recordTurn(game, { action, events }) {
  if (!isActive(game)) return null;
  const t = game.expedition.tally;
  const home = game.world.sanctuary;
  if (action.type === 'move' || action.type === 'flee') t.steps += 1;
  t.farthest = Math.max(t.farthest, hexDistance(game.player.position, home));
  let ending = null;
  for (const e of events) {
    switch (e.type) {
      case 'gathered': add(t.gathered, e.resource, e.amount); break;
      case 'discovered': t.places += 1; break;
      case 'interacted': t.explored += 1; addBundle(t.found, e.found); break;
      case 'enemyDefeated': add(t.defeated, e.enemy, 1); addBundle(t.found, e.loot); break;
      case 'defeated': t.farthest = Math.max(t.farthest, hexDistance(e.at, home)); ending = e; break;
      case 'returned': ending = e; break;
      default: break;
    }
  }
  return ending ? finishExpedition(game, ending) : null;
}

/**
 * End the active expedition with the `returned` or `defeated` event `e`.
 * The report records what the pack held when it ended: kept on a return,
 * lost (and emptied) on a defeat. Insight is added to the balance.
 */
export function finishExpedition(game, e) {
  const outcome = e.type === 'defeated' ? 'defeated' : 'returned';
  const report = {
    ...summarize(game), outcome, cause: outcome === 'defeated' ? e.enemy ?? null : null,
    pack: copyPack(game.player.inventory),
  };
  if (outcome === 'defeated') game.player.inventory = createInventory();
  game.expedition.status = 'ended';
  game.progress.insight += report.insight.total;
  game.progress.history.push(report);
  return report;
}

/** The last finished expedition's report, or null. */
export const lastReport = (game) => game.progress.history.at(-1) ?? null;

// ---------------------------------------------------------------- setting out

/**
 * The pack a returning player sets out with again: what they brought back,
 * topped up to the starting kit's supplies, and the kit's gear worn in any
 * empty slot (a spare one carried is put on first). Changes `inventory`.
 */
export function resupply(inventory) {
  for (const [id, n] of Object.entries(STARTING_KIT.items)) {
    const have = countOf(inventory, id);
    if (have < n) addItem(inventory, id, n - have);
  }
  for (const slot of SLOTS) {
    const id = STARTING_KIT.equipped[slot];
    if (!id || equippedIn(inventory, slot)) continue;
    if (countOf(inventory, id) === 0) addItem(inventory, id, 1);
    equip(inventory, id);
  }
  return inventory;
}

/** Can a new expedition set out now? (changes nothing) */
export function checkSetOut(game) {
  return isActive(game) ? { ok: false, reason: 'onExpedition' } : { ok: true };
}

/**
 * Start the next expedition (checked). Resets expedition state only: a new
 * player at the sanctuary (Survivor health; the pack kept on a return,
 * the starting kit after a defeat), surviving enemies home and unaware.
 * Observes the start with the current sight radius (Cartographer) and
 * returns the events: `setOut`, then any places discovered from the start.
 * The caller (core/game.js `setOut`) logs them.
 */
export function beginExpedition(game) {
  const last = lastReport(game);
  const number = (game.expedition?.number ?? 0) + 1;
  const inventory = last?.outcome === 'returned' ? resupply(game.player.inventory) : createInventory(STARTING_KIT);
  game.player = createPlayer(game.world.sanctuary, { maxHealth: maxHealthOf(game), inventory });
  game.enemies.reset();
  const found = discoverIn(game, game.memory.observe(game.player.position, sightRadiusOf(game)).newly);
  game.expedition = createExpedition(game, number);
  return [{ type: 'setOut', number, maxHealth: game.player.maxHealth, sight: sightRadiusOf(game) }, ...found];
}
