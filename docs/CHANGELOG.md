# Everwake — Changelog

This file records notable project changes. It begins as a documentation scaffold.


## Unreleased

### Task 07: Resource nodes and gathering
- The wilderness now holds resource nodes of four resources: **deadfall** (wood), **loose stone** (stone), **herb patches** (herbs), and **berry bushes** or **fish shoals** (food; fish only in water). Where they appear follows each terrain's resource suitability: wood in forests, stone on rocky ground and mountains, and so on. About one hex in ten holds a node, never the sanctuary. Placement is generated from the seed and each hex's coordinates (`src/world/resourceNodes.js`), so the same world always has the same nodes.
- Nodes are drawn as small marks in the lower right of their hex (crossed logs, stones, sprigs, berries, a fish) once the hex is mapped. They appear as coloured dots when zoomed out, and as a faint dashed ring once spent. Nodes you can gather right now get a gold ring.
- **Gather** buttons appear above the readout, one for each node in reach: on your hex ("here") or a neighbouring hex (with an arrow showing its direction). Each gather is a `gather` action costing one turn: it adds the node's yield (2 wood or stone, 1 herb or food) to your packs and uses up one of its 2–4 gathers. The readout says what you got and what is left ("Gathered 2 wood from deadfall · 1 gather left").
- A new inventory line under the clock shows what you carry ("Wood 2 · Stone 0 · Herbs 1 · Food 0").
- Depletion is a persistent world change (`src/world/worldChanges.js`), separate from the generated world, so a spent node stays spent when you leave and come back. Nodes do not regrow yet. A versioned save form is ready for Task 13.
- Nodes on hexes you cannot enter (stone on a mountain, fish in deep water) are gathered from next to them:
  - tapping one next to you says it is in reach;
  - tapping a far one previews a route to the nearest hex beside it ("Route next to …"), and a second tap walks there;
  - if there is no mapped way to reach it, the readout says it is blocked.
- Readouts about a mapped hex with a node name it and what is left ("· Deadfall (wood) · 2 gathers left", or "picked clean"): inspecting, stepping, route previews, arrival, and picks from the Map dialog. The Map legend gained a resource key.
- Invalid gathers (too far, spent, nothing there, unmapped, off the map) are refused by the turn pipeline and cost no turn. The UI only offers gathers that are valid.
- An action's own events now come first in its turn's events (the gather, then any day-part change), and the log records gathers.
- Tests: node placement (deterministic, terrain-appropriate, independent of order and map size, golden fingerprint), gather turn cost, inventory and log, depletion and refusals at no cost, gathering from a neighbouring or impassable hex, staying spent after a revisit, event order, world-changes save round trip and malformed saves, tap intent on nodes (in reach / approach / blocked / spent / fog), and text (156 tests total). The browser check now walks to a node, gathers it until spent (turn, inventory and readout each time), revisits it, and walks next to a mountain node on seed `shore-42`, on four viewports. Readouts it mirrors include node notes.

### Task 06: Action turns and world clock
- Every player action now goes through one turn pipeline (`src/core/game.js`): validate → apply → advance the clock → enemy/environment reactions → update fog of war → log → save hook. Invalid actions change nothing and cost no turn; nothing happens while you are idle.
- Actions (`src/core/actions.js`): **move** (one adjacent walkable hex) and **wait**, one turn each. Moving costs one turn per hex whatever the terrain; terrain cost still decides which route is planned. Each step of a route is its own move action and turn.
- New world clock (`src/core/clock.js`): turn count with four day parts (morning, afternoon, evening, night) of 12 turns each; the game starts on day 1, morning. A versioned save form is ready for Task 13.
- The status area now shows your position and, below it, a clock chip ("Morning · day 1 · turn 0") with a day-part mark (sun, low sun, dusk, crescent). When a day part changes, the readout says so ("Evening draws in", "Day 2 dawns"). Day parts have no gameplay effect yet.
- New **Wait** button next to the clock: one turn passes where you stand. It is disabled while travelling.
- Reactions can interrupt travel after a step (for encounters, Task 09); travel then stops with "Interrupted after …", and one tap on the destination resumes.
- The player's move counter is gone: the clock's turn count replaces it.
- Tests: action costs (move and wait cost exactly one turn), invalid actions cost nothing and run no later stage, pipeline order, interrupts, day-part boundaries and events, the log cap, one turn per hex on routes (not terrain cost), blocked steps, idle time, clock save round trip and clock text (142 tests total). The browser check reads the turn from the clock and covers Wait, idle time, free inspection and previews, one turn per route hex, Wait disabled during travel, the clock reset on a new world, and the status-area layout, on four viewports.

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
