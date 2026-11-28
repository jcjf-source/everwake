# Gameplay tasks — Expedition Deck

These tasks build the design in [`../EXPEDITION_DECK.md`](../EXPEDITION_DECK.md): movement cards pay for actions, every night makes the expedition harder, and fights move to separate battle scenes. Run them one at a time with the usual prompt ([`../TASK_PROMPT.md`](../TASK_PROMPT.md)) and rules ([`../AI_RULES.md`](../AI_RULES.md)). Read the proposal as well as the task file. Where this folder and the proposal disagree, this folder wins, because it records the decisions made during review (see below).

## Order
| # | Task | Depends on |
|---|---|---|
| G01 | [Walked ground](G01-walked-ground.md) | — |
| G02 | [Movement deck core](G02-movement-deck-core.md) | — |
| G03 | [Stride costs](G03-stride-costs.md) | G01, G02 |
| G04 | [Hand bar and route preview](G04-hand-and-route-ui.md) | G03 |
| G05 | [Nightfall, camp and the nightly tick](G05-nightfall-and-camp.md) | G04 |
| G06 | [Finding movement cards](G06-card-finds.md) | G03 |
| G07 | [Battle rules](G07-battle-rules.md) | — (pure module) |
| G08 | [Battle scene](G08-battle-scene.md) | G07, G04 |
| G09 | [Threat levels and night ambushes](G09-threat-and-ambush.md) | G05, G08 |
| G10 | [Upgrades, report and save checks](G10-progression-and-report.md) | G06, G09 |
| G11 | [Playtest and tuning pass](G11-playtest-tuning.md) | G10 |

G06 and G07 can be done earlier or in parallel with the others. Everything else follows the order above.

**Where this fits in the roadmap:** Tasks 14 (UI polish) and 15 (GitHub Pages) are still open. Task 15 doesn't conflict with this work and can go first. Task 14 polishes a HUD that G04, G05 and G08 will change a lot, so do it **after** G11, or keep it to the parts these tasks don't touch.

## Decisions made during review
These settle the proposal's open questions (§9) and the gaps found when the proposal was checked against the code. Change them here if you decide differently.

1. **No roads.** Roads have been dropped from the game, and the Road March card and road terrain have been removed from the proposal. Don't add road terrain or road rules.
2. **Healing outside battle** (§9.1) costs **no stride**. Eating is still an action, so it still takes one internal turn and enemies still react.
3. **Fleeing a battle** (§9.2) is **free from the arena edge**, as drafted. Enemies you flee from switch to `returning`, so the battle doesn't start again on your next step.
4. **Hungry** (§9.3), **hand size and stride values** (§9.4): use the drafted values. All tuning numbers live in one data module so G11 can change them in one place.
5. **Found cards** (§9.5) last for **this expedition only**.
6. **Threat** (§9.6) **resets with every expedition**.
7. **Battle deck** (§9.7) comes from **gear only**.
8. **Turns stay** as the internal step. Every action that costs stride, plus eating, equipping, making camp and every battle turn, is still one turn through the existing pipeline (`src/core/game.js`), so enemy reactions, logging, the tally and autosave keep working. Stride is a second cost checked in `validate`. A refused action costs neither.
9. **Food for supper** means one unit of any food-like consumable (`food`, then `rations`). Healing items (herbs, potions) don't count.
10. **Shallow water with Wade:** "normal cost" means shallow water costs **1** (as if it were grassland) while that stride lasts. The ×2 new-ground rule still applies on top.
11. **The arena** is a **radius-3 hex** area (37 hexes) around the place where the battle started, not a 7×7 block, because the map is a hex grid.
12. **Saving mid-battle and mid-day:** as in Task 13, everything in the game object is saved. A reload resumes the same hand, pool and battle.

## Notes for every task
- Keep the simulation pure and seeded. Shuffles and rolls use `src/core/rng.js` / `hashInts` with seeds from (world seed, expedition, day), never `Math.random()`.
- Add a versioned save form for every new piece of state, and validation in `restoreGame` that never half-applies (see TECHNICAL.md, "Persistence").
- `tools/browser/check-world.mjs` mirrors readouts and turn results in Node. Update it with every task that changes readouts, costs or flows, and run `npm run check:browser`.
- Record decisions in `docs/TECHNICAL.md` under a new "Expedition deck" section, update `docs/CHANGELOG.md`, and add a milestone for this set to `docs/ROADMAP.md` in G01.
