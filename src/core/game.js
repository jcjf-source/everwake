/**
 * Game state and the turn pipeline.
 *
 * Every change to game state made by the player goes through
 * `turns.perform(game, action)`, which runs, in order:
 *
 *   1. validate   the action (actions.js). Invalid: stop here; nothing
 *                 changes, no turn passes, nothing is logged or saved.
 *   2. apply      pay the action's stride (G03, systems/stride.js), then
 *                 the player's own effect (e.g. the step, a gather); it
 *                 may return events of its own, which come first.
 *   3. advance    the world clock by the action's cost. An action that is
 *                 not a turn (cost 0: playing a card) skips this and step 4.
 *   4. react      each reaction (enemies since Task 09: systems/enemies.js;
 *                 the player's condition since Task 10: systems/combat.js)
 *                 in registration order. A reaction sees the moved player,
 *                 the new turn, where the player stood before the action
 *                 (`from`) and the turn's events so far, and may ask to
 *                 interrupt travel.
 *   5. observe    update visibility (fog of war) from the player's hex,
 *                 then discover any POI on a newly seen hex (Task 08). A
 *                 discovery interrupts travel, like an encounter. The hex
 *                 the player now stands on is marked as walked ground (G01),
 *                 wherever the turn left them: a move, a flee, a return, or
 *                 carried home by a defeat.
 *   6. log        append this turn's events to the game log, and the
 *                 journal-worthy ones (discoveries, POI uses) to the journal.
 *   7. expedition add the turn to the expedition's tally (with the stride it
 *                 spent and any card played); a return or a
 *                 defeat finishes the expedition and files its report
 *                 (systems/expedition.js, Task 12).
 *   8. save       call the save hook (main.js autosaves: systems/saveSlot.js).
 *
 * Nothing here runs on its own: time passes only when an action succeeds.
 * Between expeditions every action is refused (`noExpedition`) until
 * `setOut` starts the next one.
 * Simulation only (no DOM).
 */
import { createPlayer } from '../entities/player.js';
import { createMapMemory } from '../world/mapMemory.js';
import { createClock, advanceClock, timeOf } from './clock.js';
import { validateAction } from './actions.js';
import { createWorldChanges } from '../world/worldChanges.js';
import { createJournal } from '../systems/journal.js';
import { discoverIn } from '../systems/pois.js';
import { createEnemies } from '../systems/enemies.js';
import { createProgress } from '../systems/progression.js';
import {
  createExpedition, createExpeditionDeck, recordTurn, beginExpedition, checkSetOut, sightRadiusOf, maxHealthOf,
} from '../systems/expedition.js';
import { payStride } from '../systems/stride.js';

/** Most recent log entries kept (older ones are dropped). */
export const LOG_LIMIT = 100;

/**
 * A new game in `world`: the player on the sanctuary with empty packs, a
 * fresh map with the start revealed, an untouched world (no changes from
 * the generated baseline), every enemy at home and unaware (systems/enemies.js), an empty journal, and the clock at turn 0 (day 1,
 * morning). POIs in sight of the start are discovered at turn 0. No
 * insight or upgrades yet (`progress`), and expedition 1 under way with its
 * movement deck (`deck`, G03): the starting deck, with the first hand drawn
 * and an empty stride pool.
 */
export function createGame(world) {
  const memory = createMapMemory(world.radius);
  const game = {
    world, player: null, memory, changes: createWorldChanges(), journal: createJournal(), clock: createClock(), log: [],
    enemies: createEnemies(world.enemySpawns ?? []), progress: createProgress(), expedition: null, deck: null,
  };
  game.deck = createExpeditionDeck(game, 1);
  game.player = createPlayer(world.sanctuary, { maxHealth: maxHealthOf(game) });
  const found = discoverIn(game, memory.observe(game.player.position, sightRadiusOf(game)).newly);
  markStanding(game);
  appendLog(game, found);
  game.expedition = createExpedition(game, 1);
  return game;
}

/**
 * Walked ground (G01): the hex the player stands on is walked. The one place
 * this is recorded: after each turn's observe, at the start of a game and
 * on setting out. Call after observing, so the hex is known.
 */
function markStanding(game) {
  game.memory.markWalked(game.player.position);
}

/** Append events to the capped log and the journal, stamped with the current turn. */
function appendLog(game, events) {
  if (!events.length) return;
  game.log.push(...events);
  if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
  game.journal.record(events, game.clock.turn);
}

/**
 * Set out on the next expedition from the sanctuary (Task 12), once the last
 * one has ended. Not a turn: no time passes and nothing reacts. Resets only
 * expedition state (systems/expedition.js `beginExpedition`): note that
 * `game.player` is replaced. Returns `{ ok: true, events }` (`setOut`,
 * then any places discovered from the start; logged) or `{ ok: false, reason }`.
 */
export function setOut(game) {
  const v = checkSetOut(game);
  if (!v.ok) return v;
  const events = beginExpedition(game);
  markStanding(game);
  appendLog(game, events);
  return { ok: true, events };
}

/**
 * @typedef {({ type: 'dayPart', turn: number, day: number, part: string }
 *   | { type: 'gathered', at: object, kind: string, resource: string, amount: number, left: number, total: number }
 *   | { type: 'discovered', at: object, poi: string, name: string, from: object }
 *   | { type: 'interacted', at: object, poi: string, name: string, use: number, left: number, found?: object, revealed?: number }
 *   | { type: 'enemyDetected', id: number, enemy: string, at: object, from: object }
 *   | { type: 'enemyAttack', id: number, enemy: string, at: object, charge: boolean, damage: number, stub?: boolean,
 *       parting?: boolean, guarded?: boolean, cover?: number, health?: number, maxHealth?: number }
 *   | { type: 'enemyDisengaged', id: number, enemy: string, at: object, reason: string }
 *   | { type: 'playerAttack', id: number, enemy: string, at: object, damage: number, cover: number, health: number, maxHealth: number }
 *   | { type: 'enemyDefeated', id: number, enemy: string, at: object }
 *   | { type: 'defended', bonus: number }
 *   | { type: 'fled', at: object, direction: number, enemies: string[] }
 *   | { type: 'used', item: string, healed: number, health: number, maxHealth: number }
 *   | { type: 'recovered', amount: number, health: number, maxHealth: number }
 *   | { type: 'defeated', at: object, id: number | null, enemy: string | null }
 *   | { type: 'returned', number: number }
 *   | { type: 'setOut', number: number, maxHealth: number, sight: number }
 *   | { type: 'cardPlayed', card: string, stride: number, pool: number, drew?: string | null, sight?: number, freeGathers?: number })
 *   & Record<string, unknown>} GameEvent
 *   Events are plain data; the UI formats them (src/ui/clockText.js).
 * @typedef {(game: object, ctx: { action: object, turn: number, time: object, from: object, events: GameEvent[] }) =>
 *   void | { events?: GameEvent[], interrupt?: { reason: string } }} Reaction
 * @typedef {{ ok: true, action: object, cost: number, stride: number, turn: number, time: object,
 *   events: GameEvent[], revealed: number, interrupt: { reason: string } | null, ended: object | null }
 *   | { ok: false, action: object, reason: string, cost?: number, pool?: number }} ActionResult
 *   `cost` is turns taken, `stride` the stride spent. A `noStride` refusal
 *   says what the action would cost (`cost`) and what the pool holds.
 *
 * @param {{ reactions?: Reaction[], onSave?: ((game: object, result: ActionResult) => void) | null,
 *   sightRadius?: number | null }} [opts] `sightRadius` overrides the player's
 *   (by default the base radius plus Cartographer: expedition.js sightRadiusOf).
 */
export function createTurnSystem({ reactions = [], onSave = null, sightRadius = null } = {}) {
  return {
    /** Run one action through the pipeline. @returns {ActionResult} */
    perform(game, action) {
      // 1. validate
      const v = validateAction(game, action);
      if (!v.ok) {
        const refused = { ok: false, action, reason: v.reason };
        if (v.reason === 'noStride') Object.assign(refused, { cost: v.cost, pool: v.pool });
        return refused;
      }

      // 2. pay the stride, then apply (the action's own events come first)
      const from = { q: game.player.position.q, r: game.player.position.r };
      const paid = payStride(game, action);
      const applied = v.def.apply(game, action);
      const events = applied?.events ? [...applied.events] : [];

      let turn = game.clock.turn;
      let time = timeOf(turn);
      let interrupt = null;
      if (v.def.cost > 0) {
        // 3. advance the clock
        const tick = advanceClock(game.clock, v.def.cost);
        turn = tick.to;
        time = timeOf(turn);
        if (tick.partChanged) events.push({ type: 'dayPart', turn, day: time.day, part: time.part });

        // 4. enemies and environment react
        for (const react of reactions) {
          const out = react(game, { action, turn, time, from, events });
          if (!out) continue;
          if (out.events) events.push(...out.events);
          if (out.interrupt && !interrupt) interrupt = out.interrupt;
        }
      }

      // 5. visibility, then discovery of POIs that just came into sight
      const { revealed, newly } = game.memory.observe(game.player.position, sightRadius ?? sightRadiusOf(game));
      markStanding(game);
      const found = discoverIn(game, newly);
      if (found.length) {
        events.push(...found);
        if (!interrupt) interrupt = { reason: 'discovery' };
      }

      // 6. log and journal
      appendLog(game, events);

      // 7. the expedition's tally; a return or a defeat ends the expedition
      const ended = recordTurn(game, { action, events, stride: paid.stride });

      const result = { ok: true, action, cost: v.def.cost, stride: paid.stride, turn, time, events, revealed, interrupt, ended };
      // 8. save
      if (onSave) onSave(game, result);
      return result;
    },
  };
}
