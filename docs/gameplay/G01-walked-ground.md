# Task G01 — Walked ground

## Objective
Remember every hex the player has **stood on**, permanently, as a separate record from seen and remembered fog. Later tasks use it for stride costs (G03) and card finds (G06). See `EXPEDITION_DECK.md` §2.1.

## Scope
- Add a permanent "walked" set to map memory (`src/world/mapMemory.js`), using the same dense row-order layout: `markWalked(h)`, `isWalked(h)`, `walkedCount()`. Seeing a hex doesn't mark it as walked.
- Mark a hex as walked whenever the player ends a step on it: `move`, `flee`, setting out (the sanctuary hex) and the defeat return. Do this in one place in the pipeline, not in each action.
- The set survives defeat and new expeditions, like the rest of map memory. A new world clears it.
- Save form: bump map memory to version 2 with a second base64 bitset. Version 1 saves still load: treat their walked set as empty, but mark the player's current hex. Validation checks that every walked hex is also known.
- Optional debug view: a faint footprint overlay on walked hexes, behind a query flag only. No player-facing art yet.
- Add a "Gameplay: Expedition deck" milestone listing G01–G11 to `docs/ROADMAP.md`.

## Out of scope
Any change to movement cost or turn cost. Card finds.

## Acceptance
Walking a route marks exactly the hexes entered. Hexes you have only seen are not marked. The set persists across defeat, return, set-out and reload. Old (v1) saves load. Round-trip, validation and fuzz tests in `tests/fog.test.js` / `tests/persistence.test.js` pass. The browser check passes unchanged.
