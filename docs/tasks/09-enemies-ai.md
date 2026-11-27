# Task 09 — Enemy entities and basic AI

## Objective
Add visible enemies that detect and react to the player in turn-based play.

## Scope
- Implement wolf, boar, skeleton archetypes with distinct stats and simple behavior.
- Spawn enemies in appropriate biomes/locations.
- Enemies detect player within defined range, approach when appropriate, attack only when in range, and disengage/return when player escapes detection.
- Enemies occupy hexes and respect obstacles/pathfinding.
- Show enemy health/intent feedback and log messages.
- Do not advance enemy AI during idle.

## Acceptance
Enemies react only after player actions; they navigate without stepping through blocked terrain; archetypes are distinguishable; detection and disengagement work; no enemy movement occurs while the game is idle. Combat can be stubbed only as a clearly defined handoff to Task 10.
