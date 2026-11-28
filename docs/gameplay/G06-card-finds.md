# Task G06 — Finding movement cards

## Objective
Reward walking new ground with seeded movement-card finds that suit the terrain, and add movement cards to the rewards from places. See `EXPEDITION_DECK.md` §3.

## Scope
- `rollCardFind(seedNumber, hex, tile, neighbours)` (pure, world definition): seeded on (seed, q, r, a find tag). Chance from `deckTuning` (0.12). The terrain decides the card:
  - shallow water, or a hex next to a river: Wade;
  - hills and rocky ground: Climb;
  - grassland: Walk or Second Wind (second hash);
  - next to a ruin: Scout;
  - other terrain: Walk.
- **When:** only on a hex's **first walk ever** (G01's walked set, checked before marking). So there are no finds on known ground or on later expeditions, and no farming. Mark this in the same pipeline stage as G01.
- The found card goes to the **discard pile**. Add a `cardFound` event with its readout text, and log it.
- **Places:** add movement cards as rare entries in the loot tables for chests, ruins and shrines. Loot tables can now hold card entries (`{ card: 'scout' }`) alongside items. Leave the placement layout and versions unchanged. If adding entries changes existing rolls, bump the loot-roll version and update the golden test on purpose.
- **Expedition loot:** found cards are lost on defeat and also cleared on return, because the starting deck is restored (README, decision 5). Count them in the tally.

## Acceptance
The same hex in the same world always gives the same result. Walking a hex a second time, or on a later expedition, gives nothing. Over a test seed, roughly 12% of new hexes give a card, and the terrain matches. A found card shows up in the discard pile, not in the hand. Place loot can give cards. Defeat and return remove found cards. Tests and the browser check pass.
