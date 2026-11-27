# Everwake — Changelog

This file records notable project changes. It begins as a documentation scaffold.


## Unreleased

### Task 05: Fog of war and map memory
- The world starts hidden. Only hexes within 4 steps of you (hex distance) are revealed at the start, and each step reveals the hexes that come into sight.
- Every hex is unknown, remembered or visible. Unknown hexes are not drawn at all, so neither their terrain nor anything on them shows. Hexes you have seen but are no longer in sight stay mapped under a dim veil, and hexes in sight are drawn in full.
- Soft banks of mist sit along the edge of the explored area, spilling about half a hex over it, with a fainter ring behind. The map fades into cloud instead of ending in hard hexagon edges. The clouds don't move, stay put while panning, and depend only on which hexes are mapped, so they reveal nothing.
- The sanctuary, and later points of interest, appear only once their hex has been seen, and stay on the map after that. Moving things (enemies, Task 09) will be shown only while in sight; that rule is in place and tested.
- Routes only cross mapped hexes, so a route preview never reveals hidden terrain. Tapping an unmapped hex says "Unexplored · … · not on your map yet" without naming its terrain. A mapped hex that can only be reached through unmapped land is reported as cut off ("…by water, mountains or unmapped land").
- New **Map** button (below Centre) opens an overview of everything you have mapped, fitted to the explored area. It shows what is in sight, what is remembered, you, and the sanctuary, with a count of hexes explored. Tap a mapped hex to close the map and centre the view on it. Opening the map stops travel; one tap on the destination resumes.
- Map knowledge is stored as player state with a compact, versioned save form (a bitset of known hexes, about 820 characters for the full map) and validated restore, ready for persistence (Task 13). It is not saved yet: reloading starts a fresh map.
- Tests: reveal boundary (ring 4 seen, ring 5 not), reveal on movement, memory kept, map-edge clipping, landmark versus moving-entity visibility, save round trip and malformed saves, fog-aware routes and taps, a generated-world walk, the map framing, and the renderer drawing only known hexes and veiling remembered ones (125 tests total, including where the fog-edge clouds are placed). The browser check now mirrors map memory. It checks the reveal boundary by tapping, reveal on a step, pixel brightness going unknown → visible → remembered, and the Map dialog, on four viewports.

### Task 04: Tap-to-move and hex pathfinding
- The player now starts on the sanctuary, drawn as a hooded wanderer with a lantern (a ringed token when zoomed out). A status line under the title shows your position and move count.
- Tap a neighbouring walkable hex to step onto it at once. Those hexes have a faint rim.
- Tap a farther hex to preview a route: a dashed line to a ringed destination, with step count and terrain cost in the readout. Tap the same hex again to travel. You move one hex every 150 ms and never jump; the camera recentres when you near the edge of the view.
- Tapping during travel stops it. Tap the destination again to resume the rest of the route, or tap another hex to plan a new one. **Escape** stops travel, or clears a planned route.
- Impassable hexes (mountains, deep water) and walkable hexes cut off from you get a red cross and an explanation. Nothing moves and no move is counted.
- Each step is validated (on the map, adjacent, walkable). A route that becomes blocked stops at the last good hex.
- Added hex A* (`src/world/pathfinding.js`): terrain move costs as weights, impassable tiles excluded, hex-distance heuristic, deterministic tie-breaking.
- The **Centre** button now recentres on the player. The Task 01 gold rim around the selected hex's neighbours is replaced by the rim around hexes you can step to.
- Tests: hand-drawn small maps (detours, terrain-cost choices, enclosed goals, deep vs shallow water), A* checked against Dijkstra on 150 random maps, generated-world routes checked against flood fill, plus step validation, travel (stop, retarget, blocked mid-route) and tap handling (113 tests total). The browser check now covers stepping, previewing, stepwise travel, interrupt/resume, retargeting, Escape, and impassable/unreachable feedback on four viewports.

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
