/**
 * Stride costs (G03; design: docs/EXPEDITION_DECK.md §2, decisions in
 * docs/gameplay/README.md).
 *
 * Moving, gathering and searching are paid for with stride from the day's
 * pool (the movement deck, systems/movementDeck.js: `game.deck`). Stride is
 * a second cost beside the turn: the turn pipeline (core/game.js) refuses an
 * action the pool cannot cover (`noStride`, nothing changes) and spends the
 * stride of one that goes ahead. Turns are unchanged: every move or gather
 * is still exactly one turn (README decision 8).
 *
 * What costs what:
 *  - a step: the terrain's `moveCost` × NEW_GROUND_MULTIPLIER (2) onto a hex
 *    never walked (G01), × 1 onto walked ground;
 *  - Gather and Interact (search, open, read): ACTION_COSTS (3 each);
 *  - everything else nothing: eat, equip, unequip, attack, defend, flee,
 *    return, wait, playing a card;
 *  - nothing at all on sanctuary ground (the ward, systems/enemies.js): a
 *    step onto it, or a Gather or Interact made standing in it.
 *
 * Card effects belong to the stride their card gave (the pool's portions):
 * an action is costed with the effect of the stride in use when it starts
 * (the oldest portion, `deck.activeEffect()`), so Climb and Wade change
 * costs only while their stride lasts. If that portion runs out part way
 * through paying, the rest is taken from the next portion at the price
 * already set.
 *  - Climb (`halfCostOn`): hills and rocky ground cost half, rounded up and
 *    at least 1 (after the new-ground doubling).
 *  - Wade (`shallowAsGrass`): shallow water costs as grassland (1), and the
 *    new-ground doubling still applies (README decision 10).
 *  - Forage (`freeGather`) gives Gathers that cost nothing (day effect, kept
 *    on the deck); one is used by each Gather that would otherwise cost.
 *
 * Playing a card (`playCard`) is free and takes no turn. Its stride goes
 * into the pool; Second Wind also draws a card (from the draw pile only: it
 * never reshuffles the discard, which would let Second Winds draw each other
 * back for endless stride), Scout raises sight until the
 * day ends (read by expedition.js `sightRadiusOf`), Forage adds its free
 * Gather. Weary cannot be played.
 *
 * Simulation only (no DOM).
 */
import { TERRAIN } from '../data/terrain.js';
import { cardDef } from '../data/movementCards.js';
import { ACTION_COSTS, NEW_GROUND_MULTIPLIER } from '../data/deckTuning.js';
import { inSanctuaryWard } from './enemies.js';

/** @typedef {{ q: number, r: number }} Hex */

/**
 * The stride a step onto `to` costs: Infinity if it is off the map or
 * impassable, 0 onto sanctuary ground. Pure: the browser check calls it with
 * its own mirrors of the walked map.
 * @param {{ world: object, isWalked: (h: Hex) => boolean, effect?: object | null }} ctx
 *   `effect`: the stride effect in use (movementCards.js strideEffectOf), or null.
 * @param {Hex} to
 */
export function stepStride({ world, isWalked, effect = null }, to) {
  const tile = world.tileAt(to);
  const terrain = tile ? TERRAIN[tile.terrain] : null;
  if (!terrain || !terrain.walkable) return Infinity;
  if (inSanctuaryWard(world, to)) return 0;
  const base = effect?.shallowAsGrass && tile.terrain === 'shallowWater' ? TERRAIN.grassland.moveCost : terrain.moveCost;
  const cost = isWalked(to) ? base : base * NEW_GROUND_MULTIPLIER;
  return effect?.halfCostOn?.includes(tile.terrain) ? Math.max(1, Math.ceil(cost / 2)) : cost;
}

/** Route planning weights (world/pathfinding.js needs finite costs ≥ 1): free steps plan as 1. */
export function planningCostOf(ctx) {
  return (h) => {
    const c = stepStride(ctx, h);
    return c === 0 ? 1 : c;
  };
}

/** The step-costing context for `game` now (the walked map and the stride in use). */
const stepContext = (game) => ({ world: game.world, isWalked: game.memory.isWalked, effect: game.deck?.activeEffect() ?? null });

/** How `game` plans routes: the cheapest in stride, with the stride in use (see planningCostOf). */
export const planningCost = (game) => planningCostOf(stepContext(game));

const inWard = (game) => inSanctuaryWard(game.world, game.player.position);

/**
 * The stride `action` would cost now. Call only for an action that has
 * passed its own validation (actions.js).
 */
export function strideCost(game, action) {
  switch (action.type) {
    case 'move': return stepStride(stepContext(game), action.to);
    case 'gather':
      if (inWard(game) || (game.deck?.freeGathers() ?? 0) > 0) return 0;
      return ACTION_COSTS.gather;
    case 'interact': return inWard(game) ? 0 : ACTION_COSTS.interact;
    default: return 0;
  }
}

/**
 * Can the pool pay for `action`? Changes nothing.
 * @returns {{ ok: true, cost: number } | { ok: false, reason: 'noStride', cost: number, pool: number }}
 */
export function checkStride(game, action) {
  const cost = strideCost(game, action);
  const pool = game.deck ? game.deck.pool() : 0;
  if (cost > 0 && pool < cost) return { ok: false, reason: 'noStride', cost, pool };
  return { ok: true, cost };
}

/**
 * Pay for `action` (already checked): use a free Gather if one applies, else
 * spend its stride from the pool. The turn pipeline calls this before the
 * action's own effect, so the cost is the one that was checked.
 * @returns {{ stride: number, freeGather: boolean }}
 */
export function payStride(game, action) {
  if (action.type === 'gather' && !inWard(game) && game.deck?.useFreeGather()) return { stride: 0, freeGather: true };
  const cost = strideCost(game, action);
  if (cost === 0) return { stride: 0, freeGather: false };
  const paid = game.deck.spend(cost);
  if (!paid.ok) throw new Error(`stride was checked but cannot be paid (${paid.error})`);
  return { stride: cost, freeGather: false };
}

// ---------------------------------------------------------------- playing cards

/**
 * May the player play the card at `index` in the hand? Changes nothing.
 * @returns {{ ok: true } | { ok: false, reason: 'noDeck' | 'noCard' | 'unplayable' }}
 */
export function checkPlayCard(game, index) {
  if (!game.deck) return { ok: false, reason: 'noDeck' };
  const hand = game.deck.hand();
  if (!Number.isInteger(index) || index < 0 || index >= hand.length) return { ok: false, reason: 'noCard' };
  if (!cardDef(hand[index]).playable) return { ok: false, reason: 'unplayable' };
  return { ok: true };
}

/**
 * Play the card at `index` (checked): its stride goes into the pool and its
 * one-off effect happens.
 * @returns {object[]} one `cardPlayed` event `{ card, stride, pool, drew?, sight?, freeGathers? }`
 */
export function playCard(game, index) {
  const deck = game.deck;
  const played = deck.play(index);
  if (!played.ok) throw new Error(`card was checked but cannot be played (${played.error})`);
  const def = cardDef(played.card);
  const event = { type: 'cardPlayed', card: played.card, stride: def.stride };
  const effect = def.effect ?? {};
  if (effect.freeGather) {
    deck.addFreeGathers(effect.freeGather);
    event.freeGathers = deck.freeGathers();
  }
  if (effect.sightBonus) {
    deck.addSightBonus(effect.sightBonus);
    event.sight = deck.sightBonus();
  }
  // From the draw pile only: no reshuffle, so Second Winds cannot loop.
  if (effect.drawOne) event.drew = deck.draw({ reshuffle: false });
  event.pool = deck.pool();
  return [event];
}
