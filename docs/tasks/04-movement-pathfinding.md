# Task 04 — Tap-to-move and hex pathfinding

## Objective
Move the player across the hex terrain with click/tap destination and stepwise path following.

## Scope
- Add player marker and starting position at sanctuary.
- Adjacent click moves one hex; distant click requests a route using hex A*.
- Terrain movement costs and impassable terrain respected.
- Each traversed hex is one player action/turn placeholder (formal turn system arrives in Task 06).
- Preview destination/path, allow retarget/cancel, and stop safely at blocked/unreachable routes.
- Never teleport.

## Acceptance
Player can reach valid destinations, routes do not cross impassable terrain, unreachable targets give clear feedback, tile clicks work at zoom/pan settings, and path movement can be interrupted/retargeted. Test pathfinding against known small maps.
