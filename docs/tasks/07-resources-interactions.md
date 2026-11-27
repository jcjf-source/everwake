# Task 07 — Resource nodes and gathering

## Objective
Allow the player to gather useful materials from the wilderness.

## Scope
- Resource types: wood, stone, herbs, food.
- Place nodes appropriate to terrain (trees/wood, rocks/stone, herbs, edible plants or simple food sources).
- Contextual gather interaction on a reachable adjacent tile/node.
- Gathering costs one turn and updates inventory, event log, and node state.
- Nodes can be depleted; changes belong to persistent world state, not generated baseline.
- Provide clear feedback when too far, depleted, or blocked.

## Acceptance
Gathering produces actual inventory quantities, consumes turns, depletes nodes, and remains depleted during the current session/revisit. Invalid gathering does not consume a turn. UI makes available actions clear.
