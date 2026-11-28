# Task G03 — Stride costs

## Objective
Make moving, gathering and searching cost stride from the day's pool, with new ground costing double. See `EXPEDITION_DECK.md` §2.

## Scope
- Add `game.deck` (G02) to the game. At the start of each expedition, build the starting deck and draw the first hand of 5 cards. For now, day 1 is the only day: G05 adds nights.
- `strideCost(game, action)` in a new `src/systems/stride.js`:
  - step: terrain `moveCost` ×2 on hexes not yet walked, ×1 on walked hexes (G01);
  - Gather 3 and Interact 3 (from `deckTuning`);
  - everything else 0: eat, equip, unequip, attack, defend, flee, return;
  - zero on sanctuary ground (the ward).
  Card effects apply while their portion is being spent: Climb halves the cost on hills and rocky ground (round up, at least 1), and Wade makes shallow water cost 1. Forage gives one free Gather.
- Pipeline: `validate` refuses with `noStride` when the pool can't cover the cost, and nothing changes. `apply` spends the stride. Turns and enemy reactions are unchanged (README, decision 8).
- **Playing cards:** add a `playCard { index }` action. It costs no stride and takes no turn: playing a card changes deck state only, so enemies don't react. Second Wind draws one card. Scout adds +2 sight until the end of the day (stored on the deck, read by `sightRadiusOf`). Weary can't be played (`unplayable`).
- **Travel:** before each step, if the pool is short, travel stops with a `needStride` reason and the rest of the route stays previewed. Travel never plays cards by itself. The one-tap auto-play option is in G04.
- Route planning stays based on terrain cost (A*), but uses `strideCost` as `costOf` so the planned route is the cheapest in stride. Check that `findPath` still accepts the costs (finite, ≥ 1). On sanctuary ground, where the cost is 0, use 1 for planning.
- Expedition tally: add stride spent and cards played.
- Save the deck with the game. Bump the save format version and keep older saves loading: give them a fresh deck for the current expedition.

## Out of scope
The hand bar UI (show the pool and hand as plain text in the HUD for now), nightfall, finds, the route-cost readout.

## Acceptance
Tests show: new grass costs 2 and walked grass 1; dense forest costs 6 new and 3 walked; the sanctuary costs nothing; Climb and Wade change costs only while their stride lasts; an unaffordable action is refused and nothing changes; travel stops when stride runs out; and every move or gather is still exactly one turn. The save round trip includes the deck. The browser check is updated for the new costs and passes.
