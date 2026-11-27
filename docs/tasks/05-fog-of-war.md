# Task 05 — Fog of war and map memory

## Objective
Make exploration progressively reveal the world and preserve map knowledge.\n
## Scope
- Three states per tile: unknown, remembered, visible.
- Reveal a hex radius around player on start and after movement.
- Previously seen tiles remain mapped but visually dim; unknown tiles conceal terrain and entities.
- Add a compact map panel or map mode to inspect explored areas and current position.
- Store map state in game state in a way persistence can save later.

## Acceptance
Only nearby tiles are initially revealed; moving reveals new terrain; explored terrain remains visible in memory; unseen enemies/POIs are not shown; visibility calculations use hex distance. Verify reveal boundary and update behavior.
