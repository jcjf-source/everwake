# Task G09 — Threat levels and night ambushes

## Objective
Make the wild grow more dangerous each night, and let enemies find you at camp. See `EXPEDITION_DECK.md` §4.2–4.3.

## Scope
- **Threat effects** (`src/systems/threat.js`, values in `deckTuning`), read from `game.expedition.threat`:
  - 1: enemies notice you from +1 hex. Keep detection within sight: the existing validation requires `detectRange` ≤ sight, so cap it at your sight radius rather than breaking that rule.
  - 2: **extra spawns** each dawn beyond your sight. Use seeded, type-suited hexes, within placement rules (walkable, outside the ward, not on POIs), and tag them `transient` so they are removed on return.
  - 3: wolves spawn in pairs at dawn, and boars charge from 1 hex further.
  - 4: skeletons may leave their ruins. Their leash and territory checks treat their home as any ruin hex within range. The proposal says "at night", but there is no time spent on the map at night, so this applies at every threat level of 4 or more.
  - 5 and up: enemies get +1 damage per level above 4.
  Route these through `detectRangeOf` and similar helpers so the effects are derived, not stored.
- **Ambush roll** (fills G05's placeholder): seeded on (seed, expedition, night). The chance comes from the camp site (sanctuary none, woods low, open ground normal, next to ruins or caves high) plus threat. On a hit, spawn a suitable enemy next to the camp and start a battle (G08) that you can't avoid.
- **Camp screen:** show the ambush chance in words (none, low, normal, high) and what tonight's threat increase will do.
- **Dawn report:** add the threat line, for example "Wolves now hunt in pairs".
- **Return:** threat goes back to 0 and transient enemies are removed. `enemies.reset()` keeps its current behaviour for the original enemies.
- Save transient enemies (their own save form or a flag in the enemy roster) and validate them.

## Acceptance
Tests show each threat level's effect in isolation; ambush odds by camp site and threat (seeded and repeatable); a hit starting a battle; transient enemies being removed on return; and the save round trip including transient enemies. Threat 0 plays exactly as it does after G08. The browser check covers a forced ambush on a fixed seed.
