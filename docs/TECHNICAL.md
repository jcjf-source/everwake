# EVERWAKE — Technical Notes

This document records implementation decisions. Decisions may evolve, but changes should be explained and recorded rather than silently rewritten.


## Target and constraints
- Static browser game suitable for GitHub Pages.
- Prefer plain HTML/CSS/JavaScript and Canvas 2D; avoid mandatory frameworks and build tooling until justified.
- No backend required for prototype.
- Desktop and mobile browsers are target environments.

## Proposed architecture (adapt to repository reality)
- `src/core/`: game state, actions, turn/time systems, seeded RNG.
- `src/world/`: hex math, chunk/region generation, terrain, world state, pathfinding, visibility.
- `src/entities/`: player, enemies, objects, resource nodes.
- `src/systems/`: combat, inventory, interactions, progression, persistence.
- `src/render/`: Canvas drawing, camera, input-to-world transforms.
- `src/ui/`: panels, buttons, log, contextual actions.
- `src/data/`: terrain, items, enemy definitions, upgrade definitions.
Names are suggestions; keep structure simple and consistent with the actual project.

## Current project layout (Tasks 00–03)
- `index.html` at the repository root is the entry point; `css/main.css` holds styles; `src/main.js` boots the app.
- `src/main.js` statically imports only `src/core/errorReporter.js`, then loads everything else with dynamic `import()`. That way a failure in any later module still appears on screen.
- `src/render/canvasSurface.js` sizes the canvas to its CSS box at `devicePixelRatio` (capped at 3) and sets the context transform so drawing uses CSS pixels. It repaints on resize and when `requestRepaint()` is called (at most once per animation frame). There is no continuous loop. `getSize()` returns the canvas box in CSS pixels.
- `src/world/hex.js`: all hex geometry (see "Hex grid" below). `src/world/hexGrid.js`: bounded hexagon membership (`has(hex)`). The map is radius 40 (4,921 hexes).
- World generation (Task 03): see "Deterministic procedural generation" below. `src/world/world.js` exposes `{ seed, radius, cells, has, tileAt, isWalkable, sanctuary }`, which is the world definition used by rendering and the HUD.
- `src/render/camera.js` (Task 02): pure camera functions.
  - **World space** is hex pixel space at `BASE_HEX_SIZE = 32`. The camera is `{ x, y, zoom, minZoom: 0.4, maxZoom: 2.5, bounds }`, where `(x, y)` is the world point at the viewport centre: `screen = viewportCentre + (world − camera) · zoom`.
  - **Functions:** `panBy`, `zoomAt` (keeps the world point under the cursor or pinch midpoint fixed), and `centerOn`/`centerOnHex` (follow-ready positioning for the player in Task 04). `cameraToView` produces the `GridView` that rendering and hit-testing share.
  - **Bounds:** the centre is clamped to `gridWorldBounds(radius)`, so the map edge can reach mid-screen but the map can't be lost.
  - **Initial zoom** fits about 11 hexes across the shorter side.
  - Resizing keeps the same world point centred.
- `src/render/gridView.js`: helpers for a `GridView { originX, originY, size }`: `hexToScreen`, `screenToHex`, and `visibleHexes(view, w, h, include, padding)`.
  - `visibleHexes` walks only the rows and columns that overlap the viewport (plus one hex of padding), so the cost scales with what's on screen, not with the grid size.
- `src/render/gridRenderer.js`: draws only the visible cells it is given.
  - Tiles are batched into one path per palette colour (9 terrains × 5 elevation shades, from `terrainStyle.js`). Corner offsets are computed once per frame, and outlines are stroked on the same batched paths.
  - Batched paths close each hex with `lineTo` rather than `closePath()`. In Chrome, `closePath()` on paths with thousands of subpaths cost about 8 ms/frame at minimum zoom.
  - Outlines are skipped below 10px hex size, and coordinate labels below 15px. Labels have a dark halo.
  - `src/render/terrainArt.js` draws procedural details, one batched path per mark type. Below 11px there are none; below 18px only simplified trees and peaks; full detail above that. It also draws the sanctuary marker at every zoom.
  - It also draws the neighbour rim, hover and selection highlights, and the `q,r` debug labels.
- `src/ui/pointerInput.js`: pointer events → canvas-local CSS pixels (`clientX - rect.left`), so device pixel ratio never affects picking.
  - **Pointers:** pointer capture keeps drags tracked off-canvas. A press-release within 10px (`TAP_SLOP`) is a tap; further movement becomes a pan, which never selects.
  - **Pinch:** a second touch starts a pinch (zoom about the midpoint, pan with the midpoint). After any multi-touch, nothing selects until all fingers lift. Lifting one finger mid-pinch continues as a pan.
  - **Wheel:** zooms about the cursor (line and page delta modes are normalised, and `ctrlKey` trackpad pinch is more sensitive). It always calls `preventDefault()` (non-passive listener), and Safari `gesture*` events are also prevented.
- `src/ui/hud.js`: the selection readout, the Coordinates toggle (`aria-pressed`), and the + / − / Centre buttons.
  - Zoom buttons step ×1.25 about the viewport centre and are disabled at the zoom limits.
  - Centre recentres on the selected hex, or on the sanctuary if nothing is selected.
  - The readout shows terrain name, move cost or "impassable", and hex distance from the sanctuary.
- `src/ui/worldPanel.js`: the Seed button and a `<dialog>` for a new world (typed or Random seed, Cancel, Replace world). Replacing is a deliberate second step, never a single tap. The seed lives in the URL query (`?seed=`) until persistence exists (Task 13). An invalid or missing URL seed falls back to a random seed.
- UI and view state (`hovered`, `selected`, `showCoords`, camera) live in `main.js`. They are not game state and are not saved. The current `world` object is replaced as a whole when a new seed is chosen.
- The Task 00 placeholder title scene (`placeholderScene.js`) was removed in Task 01 now that the grid is the main view.
- Error reporting: `window` `error` and `unhandledrejection` handlers, plus a `report()` function for caught errors, add entries to the on-screen `#error-panel`. They never call `preventDefault()`, and caught errors are also passed to `console.error`, so nothing is hidden from the console.
- `.app` uses `touch-action: none`, and `html, body` use `overflow: hidden`, so the play area doesn't scroll or zoom the page.
- Tooling: `npm start` runs `tools/serve.mjs`, a zero-dependency static server (ES modules can't load from `file://`). `npm test` runs `node --test`. There is no build step, and `package.json` has no dependencies.
- GitHub Pages: the repository root is served as-is. All asset paths are relative, and `.nojekyll` turns off Jekyll processing.

## Hex grid
- Use axial coordinates `(q, r)`; derive the third cube coordinate `s = -q-r` when needed.
- Neighbor directions: `(1,0)`, `(1,-1)`, `(0,-1)`, `(-1,0)`, `(-1,1)`, `(0,1)`.
- Hex distance: `(abs(dq) + abs(dr) + abs(ds)) / 2`.
- **Orientation: POINTY-TOP** (decided in Task 01). Rows are horizontal. `size` is the circumradius (centre to corner); hex width = `√3·size`, height = `2·size`.
  - Axial → pixel: `x = size·√3·(q + r/2)`, `y = size·1.5·r` (+y is down; (0,0) sits at the origin).
  - Pixel → axial: `q = (√3/3·x − 1/3·y)/size`, `r = (2/3·y)/size`, then cube rounding (`hexRound`).
  - Corners are at angles `60°·i − 30°`, so one points straight up.
  - Do not mix in flat-top formulas.
- `DIRECTIONS` index order is E, NE, NW, W, SW, SE (screen terms, pointy-top).
- Keep coordinate conversion, distance, neighbors, and tile picking in a dedicated module and unit-test them.
- A* should use hex distance as heuristic and terrain movement costs; blocked tiles are excluded.

## Deterministic procedural generation
- Use a seeded PRNG, not `Math.random()` directly in world generation.
- Derive per-region/chunk seeds from world seed plus coordinates so generation order does not change results.
- Separate generated baseline terrain from mutable world state (e.g., depleted node, opened chest, destroyed object).
- World generation should be reproducible from seed and coordinate.
- Prototype may use a bounded map; preserve coordinate-based generation seams and APIs to support chunking later.

### Implementation (Task 03)
- **Seeds** (`src/world/seed.js`): text up to 32 characters (letters, digits, space, `- _ .`), trimmed, with inner whitespace collapsed, case-sensitive. `seedToNumber` is FNV-1a plus a murmur finaliser (`hashString`).
- **Randomness** (`src/core/rng.js`): `createRng` (mulberry32) derives per-layer noise seeds in a fixed order. `hashInts(seed, a, b, c)` is the stateless coordinate hash behind noise gradients. `src/core/hash.js` remains cosmetic only (render jitter).
- **Noise** (`src/world/noise.js`): 2D gradient noise with 16 hashed gradients and quintic fade, and `fbm` octave sums. Samples are taken at the unit-size pointy-top hex centre, so the noise is isotropic on screen.
- **Layers** (`src/world/worldGen.js`, `createTerrainGenerator(seedNumber).tileAt(q, r)`):
  - Elevation is 4-octave fbm plus ridged noise (`(1−|n|)^4`) under a low-frequency mask, which gives mountain ridges in some regions only.
  - Water: deep below 0.315, shallow below 0.36.
  - Rivers are hexes on the negative side of the zero contour of a separate noise field that have a positive neighbour. That set is connected on a hex grid, giving one-hex-wide continuous rivers. Rivers are allowed below mountain elevation, so they rise at the peaks.
  - Moisture is its own fbm, wetter near rivers and on low ground.
  - Classification by elevation bands (sand shore, hills, rocky, mountains), then moisture (grassland, forest, dense forest, dry sand scrub). A small detail noise roughens band edges.
  - Local rules read only *raw* neighbour values, so they stay order-independent:
    - a tile matching none of its 6 neighbours takes the most common neighbouring terrain;
    - deep water next to land becomes shallow;
    - a river hex with no water neighbour reverts to its ground.
  - A raw-tile memo is only a speed-up; results never depend on it.
- **Tile** shape: `{ q, r, terrain, elevation, moisture, river }`. `GENERATOR_VERSION` (currently 1) must be bumped when output changes; a golden-fingerprint test guards this.
- **Sanctuary** (`world.js`): flood-fill the walkable regions and take the largest. Then scan hexes within 0.75·R in order of distance from the centre and pick the first grassland hex (falling back to any walkable land with cost ≤ 2) whose six neighbours are all walkable. Over 200 test seeds it always landed on grassland within 7 hexes of the centre and could reach at least 94% of walkable land.
- **Chunking later:** terrain needs no chunk seeds, because `tileAt` is already pure in (seed, q, r). A chunk is an axial block evaluated on demand, with `hashInts(worldSeed, cq, cr)` available for chunk-local features (POIs). Only sanctuary placement is global on the bounded map; an unbounded world would run the same search over a fixed spawn region around (0,0).
- **Generation cost** is about 15 ms for 4,921 tiles in Node on this machine.
- **Deferred:** roads and ruins (landmark/POI layer, Task 08). Rivers are noise contours, not flow-simulated, so a river can occasionally loop or end inland at high ground.

## State model
Keep the distinction between:
- **World definition:** seed-driven terrain and initial entities.
- **Persistent world changes:** opened containers, depleted resources, changed objects, discovered POIs.
- **Player persistent state:** map memory, knowledge, upgrades, sanctuary state.
- **Expedition state:** carried loot, current position, temporary status, expedition statistics.
- **UI state:** selected tile, open panel, hover, path preview. UI state should not contaminate saved world state unnecessarily.

## Turn/action pipeline
Actions should be explicit and validated. Suggested pipeline: validate action → apply player action → advance turn/clock → enemy/environment response → update visibility → emit log/events → save. Ensure invalid actions do not consume a turn. Path-following invokes one movement action per step and can be interrupted.

## Rendering and input
- Canvas handles world rendering; DOM/CSS handles panels and UI controls.
- Camera transform must be shared by rendering and hit-testing.
- Render visible tiles/entities only (or a practical viewport subset).
- Use requestAnimationFrame for rendering only; game simulation remains action-based and pauses when idle.
- Handle resize, device pixel ratio, touch, mouse, wheel, and prevent accidental page scrolling in the play area.

## Persistence
- Prefer IndexedDB if saved state grows; localStorage is acceptable for small initial saves if schema/versioning and error handling are included.
- Use versioned save data. Validate data on load and handle malformed saves without deleting them automatically.
- Save after significant actions. Include world seed, persistent mutations, player permanent state, map knowledge, and active expedition state if design permits resume.
- Provide a deliberate reset flow and, when feasible, save export/import.

## Testing
- Unit tests for hex geometry, coordinate conversions, distance, neighbors, deterministic generation, and pathfinding.
- Integration/manual checks for movement, action turn costs, fog updates, encounter interruption, death return, and persistence across reload.
- Avoid brittle tests tied to exact visual pixels unless rendering tests are available.
- Browser checks live in `tools/browser/` (Node 22+, Chrome). `check-world.mjs` (`npm run check:browser`) taps predicted hexes in headless Chrome across four viewports. It computes the expected readout in Node from the same pure modules, so it must be updated when the readout or UI flows change. `perf.mjs` (`npm run perf`) measures drag frame times. Pitfalls are listed at the top of `tools/browser/cdp.mjs`: no `--disable-gpu`, keep taps away from buttons, and DPR-halved wheel deltas.

## Decisions log
- 2026-11-27: Prototype targets static browser hosting; plain JavaScript/Canvas is the default to reduce setup and deployment complexity.
- 2026-11-27: Hex grid uses axial coordinates.
- 2026-11-27: Simulation is action/turn-based; idle time never advances gameplay.
- 2026-11-27: World seed and discoveries persist through death; death ends an expedition, not the world.
- 2026-11-27: Task-by-task development is preferred over one large implementation pass.
- 2026-11-27 (Task 00): The site is served from the repository root (no `dist/` folder and no build). Node is used only for the optional dev server and the tests; the game itself needs nothing but a static host.
- 2026-11-27 (Task 00): Tests use Node's built-in `node:test` runner, so there are no test dependencies.
- 2026-11-27 (Task 02): The camera stores a world-space centre and a zoom level, and works as pure functions. The world unit is fixed at `BASE_HEX_SIZE = 32` (hex pixel space at zoom 1). Zoom is limited to 0.4–2.5. Moves are instant, with no tweening: the camera changes only on input and repaints on demand.
- 2026-11-27 (Task 03): Terrain is generated per coordinate from continuous seeded noise plus neighbour-local rules, never from sequential random draws, so it is independent of generation or draw order and ready for chunking. Gameplay terrain properties (`src/data/terrain.js`) are kept separate from presentation (`src/render/terrainStyle.js`, `terrainArt.js`). Until saving exists, the world seed is kept in the URL.
- 2026-11-27 (Task 01): Pointy-top hex orientation. All geometry lives in `src/world/hex.js`, and the screen transform lives in `src/render/gridView.js`. Hit-testing works in CSS pixels, so device pixel ratio never affects which hex is picked.
