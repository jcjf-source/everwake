# Everwake — Changelog

This file records notable project changes. It begins as a documentation scaffold.


## Unreleased

### Task 03: Deterministic terrain generation
- Added a seeded PRNG and coordinate hash (`src/core/rng.js`), seeded gradient noise (`src/world/noise.js`), and seed handling (`src/world/seed.js`: validation, normalisation, memorable random seeds such as `misty-tarn-417`).
- Added terrain definitions (`src/data/terrain.js`): deep and shallow water, sand, grassland, forest, dense forest, hills, rocky ground, and mountains. Each has walkability, a move cost, a sight modifier, whether it blocks sight, and wood/stone/herbs/food suitability, and a validator checks them.
- Added a layered generator (`src/world/worldGen.js`): elevation with masked mountain ridges, lakes with shallow margins, one-hex-wide connected rivers, moisture-driven forests, and sand and rocky transitions. Local smoothing rules remove isolated tiles. Every tile is a pure function of seed and coordinate.
- Added `src/world/world.js`, which builds the radius-40 map and places the sanctuary on open grassland near the centre, in the largest walkable region, with all six neighbours walkable.
- The map now renders terrain colours with elevation shading and procedural details (trees, peaks, hill contours, pebbles, ripples, sand, grass tufts), plus a sanctuary marker of standing stones and a hearth. Details are simplified below 18px and hidden below 11px.
- Added a **Seed** button in the top bar. It opens a dialog showing the current seed, with a seed field, **Random**, **Cancel**, and **Replace world**. Invalid seeds are rejected with a message. The seed is kept in the URL (`?seed=`), so reloading or sharing the link reopens the same world.
- The readout now shows the terrain, move cost (or "impassable"), and distance from the sanctuary. **Centre** returns to the sanctuary when nothing is selected, and the view opens centred on it.
- Renamed the "Coordinates" button to "Coords" to fit the seed button on phones. Labels now have a dark halo for legibility on pale terrain. Hex borders are thinner when zoomed in.
- Batched terrain paths no longer call `closePath()`, which was the main frame cost with thousands of hexes on screen.
- Added PRNG, noise, seed, terrain-definition, determinism, order-independence, plausibility, and sanctuary tests (93 tests total).

### Task 02: Canvas renderer and camera
- Added a camera (`src/render/camera.js`) with pan, cursor-anchored zoom (0.4×–2.5×), world-bounds clamping, and centre-on-hex positioning (ready for following the player).
- Desktop: drag to pan and use the mouse wheel to zoom. Mobile: drag with one finger and pinch with two. Small jitters under 10px still count as taps, and drags or pinches never select a hex.
- Added + / − / Centre buttons as an alternative to the wheel and pinch. The zoom buttons are disabled at the zoom limits.
- The demo grid grew to radius 40 (4,921 hexes). Only on-screen hexes are drawn, fills are batched by colour, and coordinate labels hide when hexes are too small to read.
- The wheel, pinch and Safari gesture events never scroll or zoom the page.
- Added camera, culling, wheel and pinch maths tests (76 tests total).

### Task 01: Hex grid math and selection
- Added `src/world/hex.js`: axial/cube coordinates, six neighbours, distance, cube rounding, pointy-top hex↔pixel conversion, corners, and range queries.
- Replaced the placeholder title scene with a rendered 91-hex grid (radius 5) with subtle tone variation, fitted to the viewport.
- Click or tap selects a hex, and its six neighbours get a faint rim. Clicking it again, or empty space, clears the selection. Mouse hover is highlighted.
- Added a **Coordinates** toggle that draws `q,r` on every hex, and a readout showing the selected hex's q, r, s and its distance from the centre.
- Hit-testing uses CSS pixels and the same view transform as rendering, so it stays accurate at any viewport size and device pixel ratio.
- Added unit tests for geometry, conversions, hit-testing across viewports, grid membership, and the readout (39 tests total).

### Task 00: Project setup and runnable shell
- Added a static app shell (`index.html`, `css/main.css`, `src/main.js`) with a full-screen, DPR-aware canvas and an atmospheric placeholder title scene (layered misty ridges, stars, rising moon).
- Added an on-screen error panel for uncaught errors, unhandled rejections, and startup/render failures. Errors are still logged to the console, and the panel has a working Dismiss button.
- Made the layout responsive for phone portrait/landscape, tablet, and desktop. The play area doesn't scroll the page.
- Added a zero-dependency dev server (`npm start`), unit tests (`npm test`), a favicon, `.nojekyll`, and a root README with run and GitHub Pages instructions.

### Documentation
- Initial game design and development documentation scaffold.
- Defined exploration roguelite vision, hex movement, turn-based actions, persistent seeded world, death progression, and prototype milestones.
