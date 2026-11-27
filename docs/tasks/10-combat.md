# Task 10 — Tactical combat and defeat handling

## Objective
Implement playable turn-based encounters on the hex map.

## Scope
- Player actions: attack, defend, use consumable (if available), flee.
- Validate range and target; invalid actions do not consume turns.
- Enemies react after player action according to turn pipeline.
- Health, damage, defense, death, and flee outcomes are actual state changes.
- Terrain/position should have at least one meaningful tactical effect if practical (cover or obstacle).
- Combat UI is contextual, clear, and mobile usable.

## Acceptance
Player can start an encounter, choose actions, take enemy responses, defeat an enemy, flee, or be defeated. Combat is turn-based, idle time does not progress, logs describe actions, and no invalid action costs a turn.
