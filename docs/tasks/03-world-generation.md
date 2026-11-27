# Task 03 — Deterministic terrain generation

## Objective
Generate a coherent, repeatable exploration map using a world seed.

## Scope
- Implement seeded PRNG and seed display/change controls.
- Generate terrain using spatially coherent noise or other deterministic methods; avoid isolated random speckles.
- Create connected water features, elevation variation, forest patches, hills, mountain ridges, grasslands, sand/rock transitions.
- Add terrain definitions with walkability, movement cost, visibility modifiers, and resource suitability.
- Place sanctuary at a safe starting location and render terrain variety.
- Keep generation independent of draw order; document how generation could expand to chunks.

## Acceptance
Same seed yields same map; different seeds noticeably differ; terrain transitions look plausible; sanctuary is accessible; generated world is visible and does not break selection/rendering. Add tests for seed determinism and tile property validity.
