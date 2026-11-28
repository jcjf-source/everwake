import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import {
  MOVEMENT_CARDS, MOVEMENT_CARD_IDS, cardDef, strideEffectOf, validateCard,
} from '../src/data/movementCards.js';
import {
  STARTING_DECK, HAND_SIZE, ACTION_COSTS, FIND_CHANCE, NIGHT, THREAT,
} from '../src/data/deckTuning.js';
import {
  createDeck, restoreDeck, DECK_SAVE_VERSION, MAX_DECK_CARDS,
} from '../src/systems/movementDeck.js';

const SEED = 123456789;
const fresh = (opts = {}) => createDeck({ seedNumber: SEED, expedition: 1, ...opts });
const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

// ---- Card data -------------------------------------------------------------

test('movement cards: every definition is valid, with the drafted stride', () => {
  for (const id of MOVEMENT_CARD_IDS) assert.deepEqual(validateCard(MOVEMENT_CARDS[id]), [], id);
  const stride = Object.fromEntries(MOVEMENT_CARD_IDS.map((id) => [id, MOVEMENT_CARDS[id].stride]));
  assert.deepEqual(stride, { walk: 6, trek: 10, climb: 6, forage: 3, wade: 4, secondWind: 4, scout: 2, weary: 0 });
  assert.equal(MOVEMENT_CARDS.weary.playable, false);
  assert.ok(MOVEMENT_CARD_IDS.filter((id) => id !== 'weary').every((id) => MOVEMENT_CARDS[id].playable));
  assert.deepEqual(MOVEMENT_CARDS.climb.effect, { halfCostOn: ['hills', 'rocky'] });
  assert.deepEqual(MOVEMENT_CARDS.forage.effect, { freeGather: 1 });
  assert.deepEqual(MOVEMENT_CARDS.wade.effect, { shallowAsGrass: true });
  assert.deepEqual(MOVEMENT_CARDS.secondWind.effect, { drawOne: true });
  assert.deepEqual(MOVEMENT_CARDS.scout.effect, { sightBonus: 2 });
  assert.ok(Object.isFrozen(MOVEMENT_CARDS.climb.effect.halfCostOn));
});

test('movement cards: lookups and stride effects', () => {
  assert.equal(cardDef('walk').name, 'Walk');
  assert.equal(cardDef('toString'), null);
  assert.equal(cardDef(7), null);
  assert.deepEqual(strideEffectOf('climb'), { halfCostOn: ['hills', 'rocky'] });
  assert.deepEqual(strideEffectOf('wade'), { shallowAsGrass: true });
  for (const id of ['walk', 'trek', 'forage', 'secondWind', 'scout', 'weary', 'nope']) assert.equal(strideEffectOf(id), null, id);
});

test('validateCard refuses bad definitions', () => {
  const base = { id: 'x', name: 'X', stride: 3, playable: true, about: 'A card.' };
  const bad = [
    [{ ...base, id: '' }, /missing id/],
    [{ ...base, name: undefined }, /missing name/],
    [{ ...base, about: '' }, /missing about/],
    [{ ...base, stride: -1 }, /stride must be/],
    [{ ...base, stride: 1.5 }, /stride must be/],
    [{ ...base, stride: 0 }, /playable card must give/],
    [{ ...base, playable: 'yes' }, /playable must be/],
    [{ ...base, playable: false }, /unplayable card gives no stride/],
    [{ ...base, stride: 0, playable: false, effect: { drawOne: true } }, /cannot have an effect/],
    [{ ...base, effect: [] }, /effect must be an object/],
    [{ ...base, effect: {} }, /must contain a tag/],
    [{ ...base, effect: { fly: true } }, /unknown effect fly/],
    [{ ...base, effect: { halfCostOn: [] } }, /halfCostOn must be/],
    [{ ...base, effect: { halfCostOn: ['lava'] } }, /unknown terrain lava/],
    [{ ...base, effect: { shallowAsGrass: 1 } }, /shallowAsGrass must be true/],
    [{ ...base, effect: { freeGather: 0 } }, /freeGather must be/],
    [{ ...base, effect: { sightBonus: 'two' } }, /sightBonus must be/],
  ];
  for (const [def, re] of bad) {
    const problems = validateCard(def);
    assert.ok(problems.some((p) => re.test(p)), `${JSON.stringify(def)} → ${problems}`);
  }
  assert.deepEqual(validateCard(null), ['card must be an object']);
});

test('deck tuning: drafted values, all cards known', () => {
  assert.deepEqual({ ...STARTING_DECK }, { walk: 8, trek: 2, climb: 1, forage: 1 });
  for (const id of Object.keys(STARTING_DECK)) assert.ok(cardDef(id), id);
  assert.equal(HAND_SIZE, 5);
  assert.deepEqual({ ...ACTION_COSTS }, { gather: 3, interact: 3 });
  assert.equal(FIND_CHANCE, 0.12);
  assert.equal(NIGHT.hungerDamage, 2);
  assert.equal(NIGHT.restFood, 2);
  assert.ok(THREAT.ambushChance.none === 0 && THREAT.ambushChance.high > THREAT.ambushChance.low);
  assert.ok(Object.isFrozen(NIGHT) && Object.isFrozen(THREAT.ambushChance));
});

// ---- Draws and shuffles ----------------------------------------------------

test('a new deck holds the starting cards, in the draw pile', () => {
  const d = fresh();
  assert.deepEqual(d.cardCounts(), { ...STARTING_DECK });
  assert.equal(d.deckCount(), 12);
  assert.equal(d.hand().length, 0);
  assert.equal(d.discardCount(), 0);
  assert.equal(d.pool(), 0);
  assert.equal(d.shuffleCount(), 0);
});

test('draws are deterministic for the same seed, expedition and day', () => {
  const run = () => {
    const d = fresh();
    const days = [];
    for (let day = 1; day <= 6; day++) {
      d.discardHand();
      days.push(d.drawHand(day, HAND_SIZE));
    }
    return days;
  };
  assert.deepEqual(run(), run());
  assert.equal(run()[0].length, 5);
});

test('a different day, expedition or seed gives a different order', () => {
  const firstHand = (opts, day) => {
    const d = fresh(opts);
    d.drawHand(day, 12);
    return d.hand().join(',');
  };
  const base = firstHand({}, 1);
  assert.notEqual(firstHand({}, 2), base);
  assert.notEqual(firstHand({ expedition: 2 }, 1), base);
  assert.notEqual(firstHand({ seedNumber: SEED + 1 }, 1), base);
  // Not just a different order for one lucky case: across many days, most differ.
  const orders = new Set(Array.from({ length: 20 }, (_, i) => firstHand({}, i + 1)));
  assert.ok(orders.size >= 18, `only ${orders.size} distinct orders`);
});

test('drawHand defaults to the hand size, and day never goes backwards', () => {
  const d = fresh();
  assert.equal(d.drawHand(3).length, HAND_SIZE);
  assert.equal(d.day(), 3);
  assert.throws(() => d.drawHand(2, 5), RangeError);
  assert.throws(() => d.drawHand(3, -1), RangeError);
  assert.equal(d.drawHand(3, 0).length, 0);
});

test('when the deck runs out, the discard pile is shuffled back in', () => {
  const d = fresh();
  d.drawHand(1, 5);
  d.discardHand();
  d.drawHand(2, 5);
  d.discardHand();
  assert.equal(d.deckCount(), 2);
  assert.equal(d.discardCount(), 10);
  assert.equal(d.shuffleCount(), 1);
  const hand = d.drawHand(3, 5);
  assert.equal(hand.length, 5);
  assert.equal(d.shuffleCount(), 2);
  assert.equal(d.deckCount(), 7);
  assert.equal(d.discardCount(), 0);
  assert.deepEqual(d.cardCounts(), { ...STARTING_DECK });
});

test('drawing with nothing left returns null and draws a short hand', () => {
  const d = fresh({ cards: { walk: 3 } });
  assert.deepEqual(d.drawHand(1, 5), ['walk', 'walk', 'walk']);
  assert.equal(d.draw(), null);
  assert.equal(d.hand().length, 3);
});

test('a hand of Weary cards cannot be played and gives no stride', () => {
  const d = fresh({ cards: { weary: 6 } });
  assert.deepEqual(d.drawHand(1, 5), Array(5).fill('weary'));
  for (let i = 0; i < 5; i++) {
    const r = d.play(i);
    assert.equal(r.ok, false);
    assert.match(r.error, /Weary cannot be played/);
  }
  assert.equal(d.hand().length, 5);
  assert.equal(d.pool(), 0);
  assert.deepEqual(d.discardHand(), Array(5).fill('weary'));
  assert.equal(d.discardCount(), 5);
});

// ---- Playing, adding and removing cards ------------------------------------

test('playing a card moves it to the discard pile and adds its stride', () => {
  const d = fresh({ cards: { trek: 1, climb: 1 } });
  d.drawHand(1, 2);
  const iTrek = d.hand().indexOf('trek');
  const r = d.play(iTrek);
  assert.equal(r.ok, true);
  assert.equal(r.card, 'trek');
  assert.deepEqual(r.portion, { stride: 10, card: 'trek', effect: null });
  assert.deepEqual(d.hand(), ['climb']);
  assert.equal(d.discardCount(), 1);
  assert.equal(d.pool(), 10);
  assert.equal(d.play(0).portion.effect.halfCostOn[0], 'hills');
  assert.equal(d.pool(), 16);
  for (const bad of [-1, 0, 1, 1.5, '0', undefined]) assert.equal(d.play(bad).ok, false, String(bad));
});

test('addCard: to the discard pile, or into the draw pile at a seeded place', () => {
  const d = fresh();
  assert.equal(d.addCard('wade').ok, true);
  assert.equal(d.discardCount(), 1);
  assert.equal(d.addCard('weary', 'deck').ok, true); // before the opening shuffle: shuffled in
  assert.equal(d.deckCount(), 13);
  d.drawHand(1, 5);
  const before = d.serialize().deck;
  d.addCard('weary', 'deck');
  const after = d.serialize().deck;
  assert.equal(after.length, before.length + 1);
  // Same place for the same inputs.
  const e = fresh();
  e.addCard('wade');
  e.addCard('weary', 'deck');
  e.drawHand(1, 5);
  e.addCard('weary', 'deck');
  assert.deepEqual(e.serialize().deck, after);
  assert.throws(() => d.addCard('nope'), RangeError);
  assert.throws(() => d.addCard('walk', 'hand'), RangeError);
  assert.equal(d.cardCounts().weary, 2);
});

test('addCard refuses beyond the deck limit', () => {
  const d = fresh({ cards: { walk: MAX_DECK_CARDS } });
  assert.deepEqual(d.addCard('walk'), { ok: false, error: 'the deck is full' });
  assert.equal(d.cardCount(), MAX_DECK_CARDS);
  assert.throws(() => fresh({ cards: { walk: MAX_DECK_CARDS + 1 } }), RangeError);
});

test('removeCard takes from the discard pile, then the deck, then the hand', () => {
  const d = fresh({ cards: { weary: 2, walk: 2 } });
  d.addCard('weary');
  assert.deepEqual(d.removeCard('weary'), { ok: true, from: 'discard' });
  assert.deepEqual(d.removeCard('weary'), { ok: true, from: 'deck' });
  d.drawHand(1, 3);
  assert.deepEqual(d.removeCard('weary'), { ok: true, from: 'hand' });
  assert.deepEqual(d.hand(), ['walk', 'walk']);
  assert.deepEqual(d.removeCard('weary'), { ok: false, error: 'no Weary card to remove' });
  assert.equal(d.removeCard('scout').ok, false);
  assert.throws(() => d.removeCard('nope'), RangeError);
});

test('createDeck refuses bad options', () => {
  assert.throws(() => createDeck({ seedNumber: -1, expedition: 1 }), RangeError);
  assert.throws(() => createDeck({ seedNumber: 2 ** 32, expedition: 1 }), RangeError);
  assert.throws(() => createDeck({ seedNumber: 1, expedition: -1 }), RangeError);
  assert.throws(() => createDeck({ seedNumber: 1, expedition: 1, cards: { nope: 1 } }), RangeError);
  assert.throws(() => createDeck({ seedNumber: 1, expedition: 1, cards: { walk: -1 } }), RangeError);
  assert.throws(() => createDeck(), RangeError);
});

// ---- The stride pool -------------------------------------------------------

test('spending takes the oldest portion first, across portions', () => {
  const d = fresh();
  d.addStride(3, 'climb');
  d.addStride(4);
  d.addStride(2, 'wade');
  assert.equal(d.pool(), 9);
  assert.deepEqual(d.activeEffect(), { halfCostOn: ['hills', 'rocky'] });
  const r = d.spend(5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.spent, [
    { stride: 3, card: 'climb', effect: { halfCostOn: ['hills', 'rocky'] } },
    { stride: 2, card: null, effect: null },
  ]);
  assert.equal(d.pool(), 4);
  assert.equal(d.activeEffect(), null);
  assert.deepEqual(d.portions(), [
    { stride: 2, card: null, effect: null },
    { stride: 2, card: 'wade', effect: { shallowAsGrass: true } },
  ]);
  d.spend(2);
  assert.deepEqual(d.activeEffect(), { shallowAsGrass: true });
  assert.deepEqual(d.spend(0), { ok: true, spent: [] });
});

test('spending refuses rather than going below zero, and changes nothing', () => {
  const d = fresh();
  d.addStride(2, 'climb');
  d.addStride(3);
  const before = d.portions();
  assert.deepEqual(d.spend(6), { ok: false, error: 'not enough stride' });
  assert.deepEqual(d.portions(), before);
  assert.equal(d.spend(5).ok, true);
  assert.equal(d.pool(), 0);
  assert.equal(d.spend(1).ok, false);
  assert.equal(d.activeEffect(), null);
  assert.throws(() => d.spend(-1), RangeError);
  assert.throws(() => d.spend(1.5), RangeError);
  assert.throws(() => d.addStride(0), RangeError);
  assert.throws(() => d.addStride(2, 'nope'), RangeError);
});

test('portions returned are copies', () => {
  const d = fresh();
  d.addStride(4);
  d.portions()[0].stride = 99;
  assert.equal(d.pool(), 4);
});

// ---- Save form -------------------------------------------------------------

/** A deck partway through an expedition: a few days played, cards added. */
function playedDeck() {
  const d = fresh();
  d.drawHand(1);
  d.play(0);
  d.play(0);
  d.spend(7);
  d.discardHand();
  d.addCard('weary', 'deck');
  d.addCard('wade');
  d.drawHand(2);
  d.play(1);
  return d;
}

test('save round trip resumes the same future', () => {
  const a = playedDeck();
  const saved = a.serialize();
  assert.equal(saved.version, DECK_SAVE_VERSION);
  const r = restoreDeck(JSON.parse(JSON.stringify(saved)), SEED);
  assert.equal(r.ok, true, r.error);
  const b = r.deck;
  assert.deepEqual(b.serialize(), saved);
  assert.deepEqual(b.portions(), a.portions());
  // Both continue identically: reshuffles and inserts included.
  for (const d of [a, b]) {
    d.discardHand();
    d.addCard('weary', 'deck');
    for (let day = 3; day <= 8; day++) { d.drawHand(day); d.discardHand(); }
  }
  assert.deepEqual(b.serialize(), a.serialize());
});

test('restore never changes its input', () => {
  const saved = playedDeck().serialize();
  const copy = JSON.parse(JSON.stringify(saved));
  const r = restoreDeck(saved, SEED);
  r.deck.drawHand(9, 5);
  r.deck.spend(r.deck.pool());
  assert.deepEqual(saved, copy);
});

test('restore refuses bad saves', () => {
  const good = playedDeck().serialize();
  const cases = [
    [null, /not an object/],
    [[], /not an object/],
    [{ ...good, version: 3 }, /unsupported deck save version/],
    [{ ...good, sight: -1 }, /sight bonus/],
    [{ ...good, sight: 99 }, /sight bonus/],
    [{ ...good, freeGathers: 1.5 }, /free gathers/],
    [{ ...good, expedition: -1 }, /expedition/],
    [{ ...good, day: 0 }, /day/],
    [{ ...good, shuffles: 1.5 }, /shuffle count/],
    [{ ...good, inserts: -1 }, /insert count/],
    [{ ...good, deck: 'walk' }, /deck deck must be a list/],
    [{ ...good, hand: [...good.hand, 'roadMarch'] }, /unknown card roadMarch/],
    [{ ...good, discard: [...good.discard, 'toString'] }, /unknown card toString/],
    [{ ...good, total: good.total + 1 }, /do not add up/],
    [{ ...good, total: undefined }, /do not add up/],
    [{ ...good, deck: [...good.deck, 'walk'] }, /do not add up/],
    [{ ...good, shuffles: 0 }, /never shuffled/],
    [{ ...good, pool: {} }, /pool must be a list/],
    [{ ...good, pool: [['walk']] }, /\[card, stride\]/],
    [{ ...good, pool: [['walk', 0]] }, /stride must be an integer >= 1/],
    [{ ...good, pool: [['walk', -3]] }, /stride must be an integer >= 1/],
    [{ ...good, pool: [['nope', 3]] }, /unknown card nope/],
    [{ ...good, deck: Array(MAX_DECK_CARDS).fill('walk'), total: MAX_DECK_CARDS + good.hand.length + good.discard.length }, /at most/],
  ];
  for (const [data, re] of cases) {
    const r = restoreDeck(data, SEED);
    assert.equal(r.ok, false, JSON.stringify(data)?.slice(0, 80));
    assert.match(r.error, re);
  }
  assert.match(restoreDeck(good, -1).error, /world seed/);
  const hostile = { ...good };
  Object.defineProperty(hostile, 'deck', { get() { throw new Error('boom'); }, enumerable: true });
  assert.match(restoreDeck(hostile, SEED).error, /could not be read: boom/);
});

// ---- Fuzz ------------------------------------------------------------------

test('fuzz: random play keeps the deck consistent, and every save round-trips', () => {
  for (let run = 0; run < 40; run++) {
    const rng = createRng(1000 + run);
    const d = createDeck({ seedNumber: rng.nextUint32(), expedition: rng.int(0, 9) });
    let counts = d.cardCounts();
    let pool = 0;
    let day = 1;
    for (let step = 0; step < 200; step++) {
      const op = rng.int(0, 8);
      if (op === 0) { day += rng.int(0, 1); d.discardHand(); d.drawHand(day, rng.int(0, 7)); }
      else if (op === 1) {
        const i = rng.int(-1, d.hand().length);
        const id = d.hand()[i];
        const r = d.play(i);
        assert.equal(r.ok, !!id && cardDef(id).playable);
        if (r.ok) pool += cardDef(id).stride;
      } else if (op === 2) { const n = rng.int(0, 12); const r = d.spend(n); assert.equal(r.ok, n <= pool); if (r.ok) pool -= n; }
      else if (op === 3) { const id = MOVEMENT_CARD_IDS[rng.int(0, MOVEMENT_CARD_IDS.length - 1)]; if (d.addCard(id, rng.int(0, 1) ? 'deck' : 'discard').ok) counts[id] = (counts[id] ?? 0) + 1; }
      else if (op === 4) { const id = MOVEMENT_CARD_IDS[rng.int(0, MOVEMENT_CARD_IDS.length - 1)]; if (d.removeCard(id).ok) { counts[id]--; if (!counts[id]) delete counts[id]; } }
      else if (op === 5) { const n = rng.int(1, 6); d.addStride(n, rng.int(0, 1) ? 'climb' : null); pool += n; }
      else if (op === 6) d.draw();
      else if (op === 7) d.discardHand();
      else {
        const r = restoreDeck(JSON.parse(JSON.stringify(d.serialize())), d.seedNumber);
        assert.equal(r.ok, true, r.error);
        assert.deepEqual(r.deck.serialize(), d.serialize());
      }
      assert.deepEqual(d.cardCounts(), counts);
      assert.equal(d.pool(), pool);
      assert.ok(d.pool() >= 0);
      assert.equal(d.deckCount() + d.hand().length + d.discardCount(), total(counts));
    }
  }
});

test('fuzz: scrambled saves are refused or restore to a valid deck, never throw', () => {
  const rng = createRng(77);
  const values = [null, -1, 0, 1, 2.5, 'walk', 'weary', 'nope', [], {}, ['walk'], [['walk', 2]], true, 1e20];
  const keys = ['version', 'expedition', 'day', 'shuffles', 'inserts', 'total', 'deck', 'hand', 'discard', 'pool', 'sight', 'freeGathers'];
  for (let i = 0; i < 500; i++) {
    const data = JSON.parse(JSON.stringify(playedDeck().serialize()));
    for (let k = rng.int(1, 3); k > 0; k--) {
      const key = keys[rng.int(0, keys.length - 1)];
      if (Array.isArray(data[key]) && data[key].length && rng.int(0, 1)) data[key][rng.int(0, data[key].length - 1)] = values[rng.int(0, values.length - 1)];
      else data[key] = values[rng.int(0, values.length - 1)];
    }
    let r;
    assert.doesNotThrow(() => { r = restoreDeck(data, SEED); });
    if (r.ok) {
      const s = r.deck.serialize();
      assert.equal(s.total, s.deck.length + s.hand.length + s.discard.length);
      assert.ok(r.deck.pool() >= 0);
      r.deck.drawHand(r.deck.day() + 1, 5); // still usable
    } else assert.equal(typeof r.error, 'string');
  }
});
