# Task G10 — Upgrades, report and save checks

## Objective
Link permanent upgrades to the deck, report the new expedition stats, and bring the save checks up to date with everything G01–G09 added. See `EXPEDITION_DECK.md` §6 and §8.

## Scope
- **Upgrades** (`src/data/upgrades.js`, effects derived through `effectsOf`):
  - **Pathfinder:** +1 stride on every Walk and Trek per level. Keeps its stealth effect.
  - **Cartographer:** keeps +sight. The first card found on each expedition is a Scout. Track this per expedition.
  - **Scavenger:** keeps +yield. Gather costs 2 stride instead of 3, at any level.
  - **Endurance** (new): +1 hand size at dawn per level. Choose the level count and costs and record them. Validate it like the other upgrades.
  - Survivor is unchanged. Update the effect text shown on the sanctuary screen.
- **Report** (`expedition.js`, `expeditionText`): add nights survived, stride spent, cards played and found, battles won and fled, and ambushes. Decide whether nights add insight (for example 2 per night survived, so pushing deeper is rewarded) and record the decision.
- **Saves:** make sure `restoreGame` cross-checks the new parts:
  - the deck's counts match the starting deck, plus finds, plus Weary cards;
  - between expeditions, there is no battle, no pool and threat is 0;
  - transient enemies exist only during an expedition;
  - the walked set is a subset of the known set.
  Add fuzz coverage for the new parts. Remove any compatibility paths for old formats that are no longer needed, and say which ones.
- Update `docs/GAME_DESIGN.md` so it describes the deck, night and battle loop instead of the turn clock and on-map combat.

## Acceptance
Each upgrade's effect is tested at each level and appears from the next set-out. The report shows the new stats. Saves from every stage (mid-day, at camp, mid-battle, between expeditions) round-trip, and corrupted versions are refused with a clear reason. GAME_DESIGN.md is consistent with the game. Tests and the browser check pass.
