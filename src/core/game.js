/**
 * Game state and the turn pipeline.
 *
 * Every change to game state made by the player goes through
 * `turns.perform(game, action)`, which runs, in order:
 *
 *   1. validate   the action (actions.js). Invalid: stop here; nothing
 *                 changes, no turn passes, nothing is logged or saved.
 *   2. apply      the player's own effect (e.g. the step, a gather); it
 *                 may return events of its own, which come first.
 *   3. advance    the world clock by the action's cost.
 *   4. react      each reaction (enemies since Task 09: systems/enemies.js;
 *                 the player's condition since Task 10: systems/combat.js)
 *                 in registration order. A reaction sees the moved player,
 *                 the new turn, where the player stood before the action
 *                 (`from`) and the turn's events so far, and may ask to
 *                 interrupt travel.
 *   5. observe    update visibility (fog of war) from the player's hex,
 *                 then discover any POI on a newly seen hex (Task 08). A
 *                 discovery interrupts travel, like an encounter.
 *   6. log        append this turn's events to the game log, and the
 *                 journal-worthy ones (discoveries, POI uses) to the journal.
 *   7. save       call the save hook (persistence arrives in Task 13).
 *
 * Nothing here runs on its own: time passes only when an action succeeds.
 * Simulation only (no DOM).
 */
import { createPlayer } from '../entities/player.js';
import { createMapMemory, SIGHT_RADIUS } from '../world/mapMemory.js';
import { createClock, advanceClock, timeOf } from './clock.js';
import { validateAction } from './actions.js';
import { createWorldChanges } from '../world/worldChanges.js';
import { createJournal } from '../systems/journal.js';
import { discoverIn } from '../systems/pois.js';
import { createEnemies } from '../systems/enemies.js';

/** Most recent log entries kept (older ones are dropped). */
export const LOG_LIMIT = 100;

/**
 * A new game in `world`: the player on the sanctuary with empty packs, a
 * fresh map with the start revealed, an untouched world (no changes from
 * the generated baseline), every enemy at home and unaware (systems/enemies.js), an empty journal, and the clock at turn 0 (day 1,
 * morning). POIs in sight of the start are discovered at turn 0.
 */
export function createGame(world) {
  const player = createPlayer(world.sanctuary);
  const memory = createMapMemory(world.radius);
  const game = {
    world, player, memory, changes: createWorldChanges(), journal: createJournal(), clock: createClock(), log: [],
    enemies: createEnemies(world.enemySpawns ?? []),
  };
  const found = discoverIn(game, memory.observe(player.position, SIGHT_RADIUS).newly);
  game.log.push(...found);
  game.journal.record(found, 0);
  return game;
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
 *   | { type: 'defeated', at: object, id: number | null, enemy: string | null })
 *   & Record<string, unknown>} GameEvent
 *   Events are plain data; the UI formats them (src/ui/clockText.js).
 * @typedef {(game: object, ctx: { action: object, turn: number, time: object, from: object, events: GameEvent[] }) =>
 *   void | { events?: GameEvent[], interrupt?: { reason: string } }} Reaction
 * @typedef {{ ok: true, action: object, cost: number, turn: number, time: object,
 *   events: GameEvent[], revealed: number, interrupt: { reason: string } | null }
 *   | { ok: false, action: object, reason: string }} ActionResult
 *
 * @param {{ reactions?: Reaction[], onSave?: ((game: object, result: ActionResult) => void) | null,
 *   sightRadius?: number }} [opts]
 */
export function createTurnSystem({ reactions = [], onSave = null, sightRadius = SIGHT_RADIUS } = {}) {
  return {
    /** Run one action through the pipeline. @returns {ActionResult} */
    perform(game, action) {
      // 1. validate
      const v = validateAction(game, action);
      if (!v.ok) return { ok: false, action, reason: v.reason };

      // 2. apply (the action's own events come first)
      const from = { q: game.player.position.q, r: game.player.position.r };
      const applied = v.def.apply(game, action);
      const events = applied?.events ? [...applied.events] : [];

      // 3. advance the clock
      const tick = advanceClock(game.clock, v.def.cost);
      const time = timeOf(tick.to);
      if (tick.partChanged) events.push({ type: 'dayPart', turn: tick.to, day: time.day, part: time.part });

      // 4. enemies and environment react
      let interrupt = null;
      for (const react of reactions) {
        const out = react(game, { action, turn: tick.to, time, from, events });
        if (!out) continue;
        if (out.events) events.push(...out.events);
        if (out.interrupt && !interrupt) interrupt = out.interrupt;
      }

      // 5. visibility, then discovery of POIs that just came into sight
      const { revealed, newly } = game.memory.observe(game.player.position, sightRadius);
      const found = discoverIn(game, newly);
      if (found.length) {
        events.push(...found);
        if (!interrupt) interrupt = { reason: 'discovery' };
      }

      // 6. log and journal
      if (events.length) {
        game.log.push(...events);
        if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
        game.journal.record(events, tick.to);
      }

      const result = { ok: true, action, cost: v.def.cost, turn: tick.to, time, events, revealed, interrupt };
      // 7. save
      if (onSave) onSave(game, result);
      return result;
    },
  };
}
