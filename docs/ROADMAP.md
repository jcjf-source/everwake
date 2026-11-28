# EVERWAKE — Roadmap

Task files are executed one at a time. Mark a task complete only after its acceptance criteria are tested. Keep the game runnable after every task.


## Milestone 0 — Project baseline
- [x] Task 00: Project setup and runnable shell (2026-11-27)

**Exit criteria:** browser opens the app; repository structure and run/deploy instructions exist.

## Milestone 1 — Hex foundation
- [x] Task 01: Hex grid math and selection (2026-11-27)
- [x] Task 02: Canvas renderer and camera (2026-11-27)
**Exit criteria:** grid draws, pans/zooms, and tile picking remains accurate.

## Milestone 2 — World and exploration
- [x] Task 03: Deterministic terrain generation (2026-11-27)
- [x] Task 04: Click-to-move and hex A* pathfinding (2026-11-27)
- [x] Task 05: Fog of war and exploration map (2026-11-27)
**Exit criteria:** explore a repeatable map and reveal/remember terrain.

## Milestone 3 — Turn-based game loop
- [x] Task 06: Action/turn clock (2026-11-27)
- [x] Task 07: Resource nodes and contextual interactions (2026-11-27)
- [x] Task 08: Points of interest and discoveries (2026-11-27)
**Exit criteria:** actions consume turns and exploration provides tangible rewards.

## Milestone 4 — Threats
- [x] Task 09: Enemy entities and basic AI (2026-11-27)
- [x] Task 10: Tactical combat and defeat handling (2026-11-27)
**Exit criteria:** encounter, fight, flee, and lose health reliably.

## Milestone 5 — Expedition progression
- [x] Task 11: Inventory, equipment, consumables (2026-11-27)
- [x] Task 12: Death, expedition summary, permanent upgrades, sanctuary return (2026-11-27)
- [x] Task 13: Persistence and save safety (2026-11-27)
**Exit criteria:** complete multiple expeditions in one persistent world and progress between them.

## Milestone 6 — Usability and deployment
- [ ] Task 14: Responsive UI, polish, accessibility pass (includes compact landscape-phone layouts for the hand bar, camp screen and battle scene, deferred from G04–G11 by `docs/gameplay/README.md` decision 13)
- [ ] Task 15: GitHub Pages deployment verification
**Exit criteria:** usable on desktop and mobile browser, documented deployment, no blocking errors.

## Gameplay: Expedition deck
Task files are in `docs/gameplay/`; the design is `docs/EXPEDITION_DECK.md`. Order, dependencies and review decisions are in `docs/gameplay/README.md`. Task 15 can go first. Do Task 14 after G11, or keep it to parts these tasks don't touch.
- [x] G01: Walked ground (2026-11-28)
- [x] G02: Movement deck core (2026-11-28)
- [x] G03: Stride costs (2026-11-28)
- [ ] G04: Hand bar and route preview
- [ ] G05: Nightfall, camp and the nightly tick
- [ ] G06: Finding movement cards
- [ ] G07: Battle rules
- [ ] G08: Battle scene
- [ ] G09: Threat levels and night ambushes
- [ ] G10: Upgrades, report and save checks
- [ ] G11: Playtest and tuning pass
**Exit criteria:** movement is paid for with cards, walked ground is cheaper, every night raises the stakes, and fights play out in separate battle scenes. Several expeditions in one world feel like progress.

## Rules for task execution
1. Read `GAME_DESIGN.md`, `TECHNICAL.md`, `AI_RULES.md`, `ROADMAP.md`, and the selected task file.
2. Work only on the selected task and its necessary dependencies. If a dependency is missing, stop and report it rather than building unrelated features.
3. Test the behavior, not only the code. Use existing tests and add focused tests where appropriate.
4. Update this roadmap, technical notes, and changelog when changes are completed.
5. Do not mark a task done until acceptance criteria are satisfied.
6. Keep the app runnable at each stopping point.
