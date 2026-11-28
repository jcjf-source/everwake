/**
 * The movement deck (G02; design: docs/EXPEDITION_DECK.md §1).
 *
 * A pure, seeded, saveable model of the expedition's movement cards and the
 * stride pool. Simulation only (no DOM). The game keeps one per expedition:
 * G03 makes actions spend stride (systems/stride.js), G04 shows the hand,
 * G05 draws at dawn.
 *
 * Piles: the draw pile (`deck`, index 0 is the top), the `hand` and the
 * `discard` pile. Cards are card ids (data/movementCards.js).
 *  - A new deck holds its cards in a fixed starting order. The first draw
 *    shuffles it (the opening shuffle).
 *  - When the draw pile is empty, the discard pile is shuffled back in.
 *  - Every shuffle is seeded by (world seed, expedition, day, shuffle count),
 *    so the same inputs always give the same order and a save resumes the
 *    same future. `day` is the day of the latest `drawHand`.
 *  - A card added to the draw pile after the opening shuffle goes in at a
 *    seeded position, seeded by (world seed, expedition, day, insert count).
 *
 * The stride pool is a list of **portions** `{ stride, card, effect }`, one
 * per card played (or `addStride` call), oldest first. `effect` is the
 * card's stride effect (Climb's `halfCostOn`, Wade's `shallowAsGrass`) or
 * null. Spending takes from the oldest portion first, so the stride in use
 * and its effect are always clear: `activeEffect()` is the oldest portion's.
 *
 * Day effects (G03): what played cards leave behind until the day ends,
 * beside the pool. `sightBonus` (Scout: +n sight, the largest bonus played
 * today; bonuses do not stack) and `freeGathers` (Forage: Gathers that cost
 * no stride). Both are cleared when a hand is drawn for a later day. The
 * rules that use them are in systems/stride.js.
 *
 * Bad arguments (unknown card ids, wrong types) throw: they are bugs. Game
 * refusals (overspending, playing an unplayable card) return
 * `{ ok: false, error }` and change nothing.
 */

import { createRng, hashInts } from '../core/rng.js';
import { cardDef, strideEffectOf, MOVEMENT_CARD_IDS } from '../data/movementCards.js';
import { STARTING_DECK, HAND_SIZE } from '../data/deckTuning.js';

/** Version 2 (G03) adds the day effects; version 1 still loads, with none. */
export const DECK_SAVE_VERSION = 2;
/** Upper bound on cards in one deck, so a save stays small. */
export const MAX_DECK_CARDS = 200;
/** The largest sight bonus any card gives (Scout). */
export const MAX_SIGHT_BONUS = Math.max(0, ...MOVEMENT_CARD_IDS.map((id) => cardDef(id).effect?.sightBonus ?? 0));
/** Upper bound on pool portions in a save. */
export const MAX_POOL_PORTIONS = 1000;

const SALT = 0x6dec4a11;
const isUint32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function requireCard(id) {
  if (!cardDef(id)) throw new RangeError(`unknown movement card ${id}`);
}

/** The starting draw pile for `cards` ({ id: count }), in a fixed order. */
function startingPile(cards) {
  if (!cards || typeof cards !== 'object') throw new TypeError('cards must be an object of counts');
  const pile = [];
  for (const [id, n] of Object.entries(cards)) {
    requireCard(id);
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`count for ${id} must be an integer >= 0`);
    for (let i = 0; i < n; i++) pile.push(id);
  }
  if (pile.length > MAX_DECK_CARDS) throw new RangeError(`a deck holds at most ${MAX_DECK_CARDS} cards`);
  return pile;
}

function makePortion(stride, card) {
  return { stride, card, effect: card === null ? null : strideEffectOf(card) };
}
const copyPortion = (p) => ({ stride: p.stride, card: p.card, effect: p.effect });

/**
 * Create the movement deck for an expedition.
 * @param {{ seedNumber: number, expedition: number, cards?: Record<string, number> }} options
 *   `seedNumber` is the world seed (uint32), `expedition` the expedition
 *   number, `cards` the starting counts (default `STARTING_DECK`).
 */
export function createDeck({ seedNumber, expedition, cards = STARTING_DECK } = {}) {
  if (!isUint32(seedNumber)) throw new RangeError(`seedNumber must be a uint32, got ${seedNumber}`);
  if (!isCount(expedition)) throw new RangeError(`expedition must be a non-negative integer, got ${expedition}`);
  return buildDeck({
    seedNumber, expedition, day: 1, shuffles: 0, inserts: 0,
    deck: startingPile(cards), hand: [], discard: [], portions: [], sight: 0, freeGathers: 0,
  });
}

function buildDeck(state) {
  const { seedNumber, expedition } = state;
  let { day, shuffles, inserts, deck, hand, discard, portions, sight, freeGathers } = state;

  const total = () => deck.length + hand.length + discard.length;
  const poolTotal = () => portions.reduce((n, p) => n + p.stride, 0);

  function shuffle(pile) {
    const rng = createRng(hashInts((seedNumber ^ SALT) >>> 0, expedition, day, shuffles));
    shuffles++;
    for (let i = pile.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [pile[i], pile[j]] = [pile[j], pile[i]];
    }
  }

  /**
   * Draw the top card into the hand. Returns its id, or null if no cards are
   * left to draw. With `reshuffle: false` an empty draw pile gives null
   * instead of shuffling the discard pile back in (Second Wind, G03: so a
   * played Second Wind can never draw itself back).
   */
  function draw({ reshuffle = true } = {}) {
    if (shuffles === 0 && deck.length > 0) shuffle(deck);
    if (deck.length === 0) {
      if (discard.length === 0 || !reshuffle) return null;
      deck = discard;
      discard = [];
      shuffle(deck);
    }
    const id = deck.shift();
    hand.push(id);
    return id;
  }

  return {
    seedNumber,
    expedition,

    /** The day of the latest `drawHand` (1 before any). */
    day: () => day,
    /** Shuffles done so far (the opening shuffle counts). */
    shuffleCount: () => shuffles,
    hand: () => hand.slice(),
    deckCount: () => deck.length,
    discardCount: () => discard.length,
    cardCount: total,
    /** How many of each card the deck holds across all piles: `{ id: n }`. */
    cardCounts() {
      const counts = {};
      for (const id of [...deck, ...hand, ...discard]) counts[id] = (counts[id] ?? 0) + 1;
      return counts;
    },

    draw: (opts) => draw(opts),

    /**
     * Draw `size` cards (default `HAND_SIZE`) for `day` (fewer if the deck
     * and discard run out). The hand is not discarded first; see
     * `discardHand`. `day` never goes backwards.
     * @returns {string[]} the ids drawn
     */
    drawHand(dayNumber, size = HAND_SIZE) {
      if (!Number.isSafeInteger(dayNumber) || dayNumber < day) throw new RangeError(`day must be an integer >= ${day}, got ${dayNumber}`);
      if (!isCount(size)) throw new RangeError(`size must be a non-negative integer, got ${size}`);
      if (dayNumber > day) { sight = 0; freeGathers = 0; }
      day = dayNumber;
      const drawn = [];
      for (let i = 0; i < size; i++) {
        const id = draw();
        if (id === null) break;
        drawn.push(id);
      }
      return drawn;
    },

    /**
     * Play the card at `index` in the hand: it goes to the discard pile and
     * its stride (if any) is added to the pool as a new portion.
     * @returns {{ ok: true, card: string, portion: object | null } | { ok: false, error: string }}
     */
    play(index) {
      if (!Number.isInteger(index) || index < 0 || index >= hand.length) return { ok: false, error: 'no card at that place in the hand' };
      const id = hand[index];
      const def = cardDef(id);
      if (!def.playable) return { ok: false, error: `${def.name} cannot be played` };
      hand.splice(index, 1);
      discard.push(id);
      let portion = null;
      if (def.stride > 0) {
        portion = makePortion(def.stride, id);
        portions.push(portion);
      }
      return { ok: true, card: id, portion: portion && copyPortion(portion) };
    },

    /** Move the whole hand to the discard pile. Returns the ids discarded. */
    discardHand() {
      const gone = hand;
      hand = [];
      discard.push(...gone);
      return gone.slice();
    },

    /**
     * Add one card to the discard pile (the default) or the draw pile.
     * @returns {{ ok: true } | { ok: false, error: string }}
     */
    addCard(id, to = 'discard') {
      requireCard(id);
      if (to !== 'discard' && to !== 'deck') throw new RangeError(`cards go to 'discard' or 'deck', not ${to}`);
      if (total() >= MAX_DECK_CARDS) return { ok: false, error: 'the deck is full' };
      if (to === 'discard') discard.push(id);
      else if (shuffles === 0) deck.push(id);
      else {
        const rng = createRng(hashInts((seedNumber ^ SALT) >>> 0, expedition, day, -(inserts + 1)));
        inserts++;
        deck.splice(rng.int(0, deck.length), 0, id);
      }
      return { ok: true };
    },

    /**
     * Remove one copy of a card, looking in the discard pile, then the draw
     * pile, then the hand.
     * @returns {{ ok: true, from: 'discard' | 'deck' | 'hand' } | { ok: false, error: string }}
     */
    removeCard(id) {
      requireCard(id);
      for (const [name, pile] of [['discard', discard], ['deck', deck], ['hand', hand]]) {
        const i = pile.indexOf(id);
        if (i >= 0) {
          pile.splice(i, 1);
          return { ok: true, from: name };
        }
      }
      return { ok: false, error: `no ${cardDef(id).name} card to remove` };
    },

    /** Extra sight from cards played today (Scout), or 0. */
    sightBonus: () => sight,
    /** Raise today's sight bonus to `n` (bonuses do not stack: the largest counts). */
    addSightBonus(n) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`sight bonus must be an integer >= 1, got ${n}`);
      sight = Math.max(sight, n);
    },
    /** Gathers left today that cost no stride (Forage). */
    freeGathers: () => freeGathers,
    addFreeGathers(n) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`free gathers must be an integer >= 1, got ${n}`);
      if (freeGathers + n > MAX_DECK_CARDS) throw new RangeError('too many free gathers');
      freeGathers += n;
    },
    /** Use one free Gather. Returns false (and changes nothing) if there is none. */
    useFreeGather() {
      if (freeGathers === 0) return false;
      freeGathers--;
      return true;
    },

    /** Stride in the pool. */
    pool: poolTotal,
    /** The pool's portions, oldest first (copies). */
    portions: () => portions.map(copyPortion),
    /** The stride effect of the stride in use (the oldest portion), or null. */
    activeEffect: () => (portions.length > 0 ? portions[0].effect : null),

    /**
     * Add `n` stride as a new portion, carrying `card`'s stride effect if
     * one is named (null: plain stride).
     */
    addStride(n, card = null) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`stride must be an integer >= 1, got ${n}`);
      if (card !== null) requireCard(card);
      if (portions.length >= MAX_POOL_PORTIONS) throw new RangeError('too many pool portions');
      const portion = makePortion(n, card);
      portions.push(portion);
      return copyPortion(portion);
    },

    /**
     * Spend `n` stride, oldest portion first. Refuses (and changes nothing)
     * if the pool holds less than `n`.
     * @returns {{ ok: true, spent: { stride: number, card: string|null, effect: object|null }[] }
     *   | { ok: false, error: string }} `spent`: how much came from each portion
     */
    spend(n) {
      if (!Number.isInteger(n) || n < 0) throw new RangeError(`stride to spend must be an integer >= 0, got ${n}`);
      if (poolTotal() < n) return { ok: false, error: 'not enough stride' };
      const spent = [];
      let left = n;
      while (left > 0) {
        const p = portions[0];
        const take = Math.min(p.stride, left);
        spent.push({ stride: take, card: p.card, effect: p.effect });
        p.stride -= take;
        left -= take;
        if (p.stride === 0) portions.shift();
      }
      return { ok: true, spent };
    },

    /**
     * Save form: `{ version, expedition, day, shuffles, inserts, total, deck,
     * hand, discard, pool, sight, freeGathers }`, where `pool` is
     * `[[card | null, stride]…]`.
     * The world seed is not included: the save records it elsewhere.
     */
    serialize() {
      return {
        version: DECK_SAVE_VERSION,
        expedition,
        day,
        shuffles,
        inserts,
        total: total(),
        deck: deck.slice(),
        hand: hand.slice(),
        discard: discard.slice(),
        pool: portions.map((p) => [p.card, p.stride]),
        sight,
        freeGathers,
      };
    },
  };
}

function checkPile(pile, name) {
  if (!Array.isArray(pile)) return `deck ${name} must be a list`;
  for (const id of pile) if (!cardDef(id)) return `deck ${name} has unknown card ${String(id)}`;
  return null;
}

/**
 * Validate and rebuild a saved deck for the world seed `seedNumber`. Never
 * throws and never changes its input; returns a new deck or a reason.
 * @returns {{ ok: true, deck: object } | { ok: false, error: string }}
 */
export function restoreDeck(data, seedNumber) {
  try {
    return restoreChecked(data, seedNumber);
  } catch (err) {
    return { ok: false, error: `deck save could not be read: ${err?.message ?? err}` };
  }
}

function restoreChecked(data, seedNumber) {
  if (!isUint32(seedNumber)) return { ok: false, error: 'deck restore needs the world seed number' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'deck save is not an object' };
  if (data.version !== DECK_SAVE_VERSION && data.version !== 1) return { ok: false, error: `unsupported deck save version ${data.version}` };
  if (!isCount(data.expedition)) return { ok: false, error: 'deck expedition must be a non-negative integer' };
  if (!Number.isSafeInteger(data.day) || data.day < 1) return { ok: false, error: 'deck day must be an integer >= 1' };
  if (!isCount(data.shuffles)) return { ok: false, error: 'deck shuffle count must be a non-negative integer' };
  if (!isCount(data.inserts)) return { ok: false, error: 'deck insert count must be a non-negative integer' };
  for (const name of ['deck', 'hand', 'discard']) {
    const problem = checkPile(data[name], name);
    if (problem) return { ok: false, error: problem };
  }
  const count = data.deck.length + data.hand.length + data.discard.length;
  if (!isCount(data.total) || data.total !== count) return { ok: false, error: `deck card counts do not add up (${count} cards, total ${data.total})` };
  if (count > MAX_DECK_CARDS) return { ok: false, error: `a deck holds at most ${MAX_DECK_CARDS} cards` };
  if (data.hand.length > 0 && data.shuffles === 0) return { ok: false, error: 'deck has a hand but was never shuffled' };

  if (!Array.isArray(data.pool)) return { ok: false, error: 'deck pool must be a list' };
  if (data.pool.length > MAX_POOL_PORTIONS) return { ok: false, error: 'deck pool has too many portions' };
  const portions = [];
  for (const entry of data.pool) {
    if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, error: 'deck pool portion must be [card, stride]' };
    const [card, stride] = entry;
    if (card !== null && !cardDef(card)) return { ok: false, error: `deck pool has unknown card ${String(card)}` };
    if (!Number.isSafeInteger(stride) || stride < 1) return { ok: false, error: 'deck pool stride must be an integer >= 1' };
    portions.push(makePortion(stride, card));
  }
  const v1 = data.version === 1;
  const sight = v1 ? 0 : data.sight;
  const freeGathers = v1 ? 0 : data.freeGathers;
  if (!Number.isSafeInteger(sight) || sight < 0 || sight > MAX_SIGHT_BONUS) return { ok: false, error: 'deck sight bonus is impossible' };
  if (!Number.isSafeInteger(freeGathers) || freeGathers < 0 || freeGathers > MAX_DECK_CARDS) return { ok: false, error: 'deck free gathers are impossible' };

  return {
    ok: true,
    deck: buildDeck({
      seedNumber,
      expedition: data.expedition,
      day: data.day,
      shuffles: data.shuffles,
      inserts: data.inserts,
      deck: data.deck.slice(),
      hand: data.hand.slice(),
      discard: data.discard.slice(),
      portions,
      sight,
      freeGathers,
    }),
  };
}
