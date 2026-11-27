# Task 01 — Hex grid math and selection

## Objective
Build and verify the core hex-grid geometry, without implementing gameplay movement.

## Scope
- Use axial coordinates `(q,r)` and document chosen orientation (pointy-top or flat-top).
- Implement six neighbors, cube/axial conversion if useful, hex distance, coordinate-to-pixel and pixel-to-hex conversion.
- Render a small grid of hexes on Canvas with subtle variation and coordinate debug mode.
- Support click/tap selection and highlight selected/hovered hex.
- Ensure hit testing remains correct with canvas scaling and device pixel ratio.

## Out of scope
World generation, pathfinding, player movement, combat.

## Acceptance
Grid is aligned; all six neighbors and distance calculations are correct; clicking selects the expected hex at different viewport sizes/scales; add unit tests for geometry and conversions; no console errors.
