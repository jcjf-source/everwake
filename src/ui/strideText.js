/**
 * Text for stride and the movement deck (G03). Plain text only for now: the
 * hand bar with card art and the route-cost readout come in G04. Pure; unit
 * tested, and mirrored by the browser check (tools/browser/check-world.mjs).
 */
import { cardDef } from '../data/movementCards.js';
import { TERRAIN } from '../data/terrain.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What the stride in use does, if anything: "hills and rocky ground at half cost". */
function effectNote(effect) {
  if (!effect) return null;
  if (effect.halfCostOn) return `${list(effect.halfCostOn.map((t) => TERRAIN[t].name.toLowerCase()))} at half cost`;
  if (effect.shallowAsGrass) return 'shallow water as grassland';
  return null;
}

/**
 * The stride line: "Stride 4 · deck 7 · discard 2", then what is in effect:
 * the stride in use's card effect, free Gathers, a sight bonus.
 * @param {object} deck the movement deck (systems/movementDeck.js)
 */
export function describeStride(deck) {
  const parts = [`Stride ${deck.pool()}`, `deck ${deck.deckCount()}`, `discard ${deck.discardCount()}`];
  const note = effectNote(deck.activeEffect());
  if (note) parts.push(note);
  if (deck.freeGathers() > 0) parts.push(plural(deck.freeGathers(), 'free Gather', 'free Gathers'));
  if (deck.sightBonus() > 0) parts.push(`sight +${deck.sightBonus()}`);
  return parts.join(' · ');
}

/**
 * One button per card in the hand, in hand order:
 * `[{ index, card, text, label, playable }]`. Weary shows, but cannot be played.
 */
export function handButtons(hand) {
  return hand.map((id, index) => {
    const def = cardDef(id);
    return {
      index, card: id, playable: def.playable,
      text: def.playable ? `${def.name} ${def.stride}` : def.name,
      label: def.playable ? `Play ${def.name}: +${def.stride} stride. ${def.about}` : `${def.name}: ${def.about}`,
    };
  });
}

/** A `cardPlayed` event: "You play Walk: +6 stride, 6 to spend", then what else it did. */
export function describeCardPlayed(e) {
  const def = cardDef(e.card);
  const parts = [`You play ${def.name}: +${e.stride} stride, ${e.pool} to spend`];
  if (e.freeGathers) parts.push(`${plural(e.freeGathers, 'free Gather', 'free Gathers')} today`);
  if (e.sight) parts.push(`sight +${e.sight} today`);
  if ('drew' in e) parts.push(e.drew ? `you draw ${cardDef(e.drew).name}` : 'no card left to draw');
  return parts.join(' · ');
}

/** Why a card cannot be played. */
export function describeCardRefused(reason) {
  switch (reason) {
    case 'unplayable': return 'Weary cannot be played: it gives no stride';
    case 'noCard': return 'That card is no longer in your hand';
    case 'noExpedition': return 'Set out on an expedition first';
    default: return `Cannot play that card (${reason})`;
  }
}

/** An action the pool cannot pay for: "Forest · q 3, r −2 · needs 4 stride, you have 1 · play a card". */
export const describeNoStride = (label, cost, pool) =>
  `${label} · needs ${cost} stride, you have ${pool} · play a card`;

/** Travel stopped before a step the pool cannot pay for; the rest of the route stays previewed. */
export const describeNeedStride = (label, done, total, cost, pool) =>
  `Out of stride after ${done} of ${plural(total, 'step', 'steps')}: the next step needs ${cost}, you have ${pool} · play a card, then tap ${label} again`;
