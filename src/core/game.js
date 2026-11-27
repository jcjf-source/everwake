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
 *   4. react      each reaction (enemies, environment; Task 09 onward) in
 *                 registration order. A reaction sees the moved player and
 *                 the new turn, and may ask to interrupt travel.
 *   5. observe    update visibility (fog of war) from the player's hex.
 *   6. log        append this turn's events to the game log.
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

/** Most recent log entries kept (older ones are dropped). */
export const LOG_LIMIT = 100;

/**
 * A new game in `world`: the player on the sanctuary with empty packs, a
 * fresh map with the start revealed, an untouched world (no changes from
 * the generated baseline), and the clock at turn 0 (day 1, morning).
 */
export function createGame(world) {
  const player = createPlayer(world.sanctuary);
  const memory = createMapMemory(world.radius);
  memory.observe(player.position, SIGHT_RADIUS);
  return { world, player, memory, changes: createWorldChanges(), clock: createClock(), log: [] };
}

/**
 * @typedef {({ type: 'dayPart', turn: number, day: number, part: string }
 *   | { type: 'gathered', at: object, kind: string, resource: string, amount: number, left: number, total: number })
 *   & Record<string, unknown>} GameEvent
 *   Events are plain data; the UI formats them (src/ui/clockText.js).
 * @typedef {(game: object, ctx: { action: object, turn: number, time: object }) =>
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
      const applied = v.def.apply(game, action);
      const events = applied?.events ? [...applied.events] : [];

      // 3. advance the clock
      const tick = advanceClock(game.clock, v.def.cost);
      const time = timeOf(tick.to);
      if (tick.partChanged) events.push({ type: 'dayPart', turn: tick.to, day: time.day, part: time.part });

      // 4. enemies and environment react
      let interrupt = null;
      for (const react of reactions) {
        const out = react(game, { action, turn: tick.to, time });
        if (!out) continue;
        if (out.events) events.push(...out.events);
        if (out.interrupt && !interrupt) interrupt = out.interrupt;
      }

      // 5. visibility
      const { revealed } = game.memory.observe(game.player.position, sightRadius);

      // 6. log
      if (events.length) {
        game.log.push(...events);
        if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
      }

      const result = { ok: true, action, cost: v.def.cost, turn: tick.to, time, events, revealed, interrupt };
      // 7. save
      if (onSave) onSave(game, result);
      return result;
    },
  };
}
