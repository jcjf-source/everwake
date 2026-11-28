/**
 * Movement card definitions (G02; design: docs/EXPEDITION_DECK.md §1).
 * Gameplay data only: nothing reads these yet except the deck module
 * (src/systems/movementDeck.js).
 *
 * Every card has an `id`, a `name`, the `stride` it gives when played,
 * whether it is `playable`, an optional `effect` and a short `about` line.
 *
 * Effects are data tags. The deck module stores them; later tasks carry
 * them out (G03 stride costs, G04 hand UI, ...):
 *  - `halfCostOn: [terrain ids]`: steps onto these terrains cost half while
 *    this card's stride lasts (Climb);
 *  - `shallowAsGrass: true`: shallow water costs as grassland (1) while this
 *    card's stride lasts (Wade; README decision 10);
 *  - `freeGather: n`: n Gathers cost no stride (Forage);
 *  - `drawOne: true`: draw another card when played (Second Wind);
 *  - `sightBonus: n`: +n sight until nightfall (Scout).
 * The first two are *stride effects*: they belong to the stride the card
 * gave, so the pool keeps them with that portion (see movementDeck.js).
 * The others happen once, when the card is played.
 */

import { TERRAIN } from './terrain.js';

/** Effect tags whose effect lasts as long as the card's stride. */
export const STRIDE_EFFECT_TAGS = Object.freeze(['halfCostOn', 'shallowAsGrass']);
/** Effect tags that happen once, when the card is played. */
export const PLAY_EFFECT_TAGS = Object.freeze(['freeGather', 'drawOne', 'sightBonus']);

const defs = [
  { id: 'walk', name: 'Walk', stride: 6, playable: true, about: 'A steady day on foot.' },
  { id: 'trek', name: 'Trek', stride: 10, playable: true, about: "A long day's stretch." },
  { id: 'climb', name: 'Climb', stride: 6, playable: true, effect: { halfCostOn: ['hills', 'rocky'] }, about: 'Hills and rocky ground cost half while this stride lasts.' },
  { id: 'forage', name: 'Forage', stride: 3, playable: true, effect: { freeGather: 1 }, about: 'A slow pace, with time for one free Gather.' },
  { id: 'wade', name: 'Wade', stride: 4, playable: true, effect: { shallowAsGrass: true }, about: 'Shallow water costs as grassland while this stride lasts.' },
  { id: 'secondWind', name: 'Second Wind', stride: 4, playable: true, effect: { drawOne: true }, about: 'Draw another card.' },
  { id: 'scout', name: 'Scout', stride: 2, playable: true, effect: { sightBonus: 2 }, about: '+2 sight until nightfall.' },
  { id: 'weary', name: 'Weary', stride: 0, playable: false, about: 'Gives no stride and cannot be played.' },
];
for (const d of defs) {
  if (d.effect) {
    for (const v of Object.values(d.effect)) if (Array.isArray(v)) Object.freeze(v);
    Object.freeze(d.effect);
  }
  Object.freeze(d);
}

/** Cards keyed by id. */
export const MOVEMENT_CARDS = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

/** Card ids in display order. */
export const MOVEMENT_CARD_IDS = Object.freeze(defs.map((d) => d.id));

/** The card with `id`, or null (own properties only). */
export const cardDef = (id) => (typeof id === 'string' && Object.hasOwn(MOVEMENT_CARDS, id) ? MOVEMENT_CARDS[id] : null);

/**
 * The part of a card's effect that lasts while its stride lasts, or null.
 * Climb → `{ halfCostOn: [...] }`, Wade → `{ shallowAsGrass: true }`.
 */
export function strideEffectOf(id) {
  const effect = cardDef(id)?.effect;
  if (!effect) return null;
  const tags = STRIDE_EFFECT_TAGS.filter((t) => Object.hasOwn(effect, t));
  if (tags.length === 0) return null;
  return Object.freeze(Object.fromEntries(tags.map((t) => [t, effect[t]])));
}

/** Problems with a card definition (empty if valid). */
export function validateCard(d) {
  const problems = [];
  if (!d || typeof d !== 'object') return ['card must be an object'];
  if (typeof d.id !== 'string' || !d.id) problems.push('missing id');
  if (typeof d.name !== 'string' || !d.name) problems.push(`${d.id}: missing name`);
  if (typeof d.about !== 'string' || !d.about) problems.push(`${d.id}: missing about`);
  if (typeof d.playable !== 'boolean') problems.push(`${d.id}: playable must be true or false`);
  if (!Number.isInteger(d.stride) || d.stride < 0) problems.push(`${d.id}: stride must be an integer >= 0`);
  else if (d.playable === true && d.stride < 1) problems.push(`${d.id}: a playable card must give stride >= 1`);
  else if (d.playable === false && d.stride !== 0) problems.push(`${d.id}: an unplayable card gives no stride`);

  if (d.effect === undefined) return problems;
  if (!d.effect || typeof d.effect !== 'object' || Array.isArray(d.effect)) {
    problems.push(`${d.id}: effect must be an object`);
    return problems;
  }
  if (d.playable === false) problems.push(`${d.id}: an unplayable card cannot have an effect`);
  const entries = Object.entries(d.effect);
  if (entries.length === 0) problems.push(`${d.id}: effect must contain a tag`);
  const posInt = (v) => Number.isInteger(v) && v >= 1;
  for (const [tag, v] of entries) {
    switch (tag) {
      case 'halfCostOn':
        if (!Array.isArray(v) || v.length === 0) problems.push(`${d.id}: halfCostOn must be a non-empty list of terrain ids`);
        else for (const t of v) if (typeof t !== 'string' || !Object.hasOwn(TERRAIN, t)) problems.push(`${d.id}: halfCostOn has unknown terrain ${t}`);
        break;
      case 'shallowAsGrass':
      case 'drawOne':
        if (v !== true) problems.push(`${d.id}: ${tag} must be true`);
        break;
      case 'freeGather':
      case 'sightBonus':
        if (!posInt(v)) problems.push(`${d.id}: ${tag} must be an integer >= 1`);
        break;
      default:
        problems.push(`${d.id}: unknown effect ${tag}`);
    }
  }
  return problems;
}
