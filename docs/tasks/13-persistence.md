# Task 13 — Save system and persistence

## Objective
Persist the game safely across browser sessions.

## Scope
- Version the save format and validate data on load.
- Save world seed, persistent world mutations, discovered map/POIs, permanent progression, sanctuary state, and active expedition state if supported.
- Autosave after meaningful actions and expedition transitions.
- Add continue/new-world options and confirmation before destructive reset.
- Handle missing/corrupt saves gracefully without silently deleting them.
- Implement export/import if feasible without jeopardizing core save reliability.

## Acceptance
Reloading the browser restores expected world/player state; same seed regenerates same baseline terrain; changed/depleted/opened states persist; new-world reset requires confirmation; corrupted data produces understandable recovery messaging and is not silently overwritten.
