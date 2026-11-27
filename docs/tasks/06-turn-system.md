# Task 06 — Action turn and world clock

## Objective
Create the action-driven turn system. Gameplay never advances while idle.

## Scope
- Define validated game actions and a central action/turn pipeline.
- Invalid actions cost no turn.
- Successful actions advance turn/time, then run relevant enemy/environment reactions, visibility updates, log messages, and save hooks.
- Add a simple day-part clock (morning/afternoon/evening/night) advanced by actions.
- Movement path steps each invoke a distinct movement action/turn.
- Add visible turn and day-part display.

## Acceptance
Each successful test action advances turn exactly as specified; invalid actions do not; idle time does not advance; movement routes cost one turn per tile; clock display changes predictably. Add tests for action costs and turn ordering.
