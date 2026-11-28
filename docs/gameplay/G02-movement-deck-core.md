# Task G02 — Movement deck core

## Objective
Build the movement deck as a pure, seeded, saveable module, with no gameplay connected to it yet. See `EXPEDITION_DECK.md` §1.

## Scope
- `src/data/movementCards.js`: card definitions `{ id, name, stride, playable, effect?, about }` for **Walk (6), Trek (10), Climb (6), Forage (3), Wade (4), Second Wind (4), Scout (2)** and the unplayable **Weary (0)**. Include a `validateCard` with tests. Effects are data tags (`halfCostOn: ['hills','rocky']`, `freeGather: 1`, `shallowAsGrass`, `drawOne`, `sightBonus: 2`). G03 and later tasks carry them out.
- `src/data/deckTuning.js`: every tuning number in one place: starting deck counts (Walk 8, Trek 2, Climb 1, Forage 1), hand size 5, action costs (Gather 3, Interact 3), find chance (0.12) and the nightly values used by G05 and G09.
- `src/systems/movementDeck.js`: `createDeck({ seedNumber, expedition })` with `draw`, `drawHand(day, size)`, `play(index)`, `discardHand()` and `addCard(id, to: 'discard' | 'deck')`. It also manages `removeCard(id)` and the stride pool: `pool`, `addStride` and `spend(n)`, which refuses rather than going below zero. When the deck runs out, shuffle the discard pile back in. Every shuffle is seeded by (world seed, expedition, day, reshuffle count), so the same inputs always give the same order.
- Active-effect state: the stride from a Climb or Wade card carries its effect "while this stride lasts". Track the pool in **portions** (`[{ stride, effect }]`) and spend the oldest portion first, so it's always clear which stride is which.
- Versioned save form `serialize`/`restoreDeck`, with validation (known ids, non-negative pool, card counts that add up). It must never half-apply.

## Out of scope
Spending stride on actions, UI, Weary/Hungry effects, finds.

## Acceptance
Unit tests cover: deterministic draws for the same seed, expedition and day; a different order for a different day; a reshuffle when the deck is empty; a hand of Weary cards; spending across portions and refusing to overspend; the save round trip and its refusals; and a fuzz pass. No gameplay or UI change. Existing tests pass.
