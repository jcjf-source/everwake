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

## Current project layout (Tasks 00–11)
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
  - Centre recentres on the player (Task 04; previously the selected hex or the sanctuary).
  - The readout is the single feedback line: the movement hint, the inspected hex, the route preview, travel progress, or why a hex cannot be reached. `#player-status` shows position; `#clock-status` shows the day part, day and turn (Task 06), with the Wait button beside it.
- `src/ui/worldPanel.js`: the Seed button and a `<dialog>` for a new world (typed or Random seed, Cancel, Replace world). Replacing is a deliberate second step, never a single tap. The seed lives in the URL query (`?seed=`) until persistence exists (Task 13). An invalid or missing URL seed falls back to a random seed.
- UI and view state (`hovered`, `selected`, `showCoords`, camera) live in `main.js`. They are not game state and are not saved. The current `world` object is replaced as a whole when a new seed is chosen.
- The Task 00 placeholder title scene (`placeholderScene.js`) was removed in Task 01 now that the grid is the main view.
- Error reporting: `window` `error` and `unhandledrejection` handlers, plus a `report()` function for caught errors, add entries to the on-screen `#error-panel`. They never call `preventDefault()`, and caught errors are also passed to `console.error`, so nothing is hidden from the console.
- `.app` uses `touch-action: none`, and `html, body` use `overflow: hidden`, so the play area doesn't scroll or zoom the page.
- Tooling: `npm start` runs `tools/serve.mjs`, a zero-dependency static server (ES modules can't load from `file://`). `npm test` runs `node --test`. There is no build step, and `package.json` has no dependencies.
- GitHub Pages: the repository root is served as-is. All asset paths are relative, and `.nojekyll` turns off Jekyll processing.

## Movement and pathfinding (Task 04)
- **Pathfinding** (`src/world/pathfinding.js`): `findPath(start, goal, { costOf, minCost, maxExpanded })` is a pure A* over the hex grid.
  - `costOf(h)` is the cost of *entering* `h`. Anything other than a finite number ≥ 1 is impassable, which also covers hexes off the map.
  - The heuristic is hex distance × `minCost` (1), so routes are optimal.
  - It uses a binary heap ordered by (f, h, insertion order), so results are deterministic.
  - It returns `{ found, path (start…goal), cost }`, or a `reason`: `blocked` (goal impassable), `unreachable`, or `limit` (the `maxExpanded` cap; kept for an unbounded world later).
  - A failed search on the radius-40 map explores at most the start's region, which takes a few ms.
- **Player** (`src/entities/player.js`): `{ position }` is expedition state. Elapsed time lives only in the world clock (Task 06). It is not saved yet.
- **Rules** (`src/systems/movement.js`):
  - `planRoute(world, from, to)` returns `here | outside | impassable | unreachable | ok`; the `ok` path excludes the start.
  - `checkStep(player, world, to)` is the one-hex step rule: on the map, adjacent, walkable. It changes nothing; the `move` action (Task 06) uses it and applies the step.
  - **Turn cost (decided in Task 06):** one turn per hex entered, whatever the terrain. Terrain `moveCost` only weights route choice.
- **Travel** (`src/systems/travel.js`): `createTravel({ step, onEvent, delay, schedule, cancel })` walks a path by calling `step` once per hex.
  - The first step happens immediately, then one every `STEP_DELAY_MS` (150 ms). The delay is presentation pacing only; nothing runs while idle, and no timer survives the end of travel.
  - Events: `step`, `arrived`, `stopped`, `blocked` (a re-validated step failed).
  - `stop()` interrupts between steps, and `start()` silently replaces an active route.
  - The timer is injectable, so tests drive it deterministically.
  - Each step is a `move` action through the turn pipeline (Task 06). A step result with `interrupt` (from a reaction) ends travel after that step with an `interrupted` event; the rest of the route stays previewed, as after a stop.
- **Tap intent** (`src/ui/moveIntent.js`): `decideTap(world, { position, preview, travelling }, hex)` is pure and returns `{ stop, action }`.
  - Idle taps:
    - your own hex: inspect it;
    - a walkable neighbour: step;
    - a farther hex: preview the route;
    - the previewed destination again: travel;
    - an impassable or unreachable hex: explain why;
    - off the map: clear.
  - While travelling, any tap stops first. Tapping yourself, the destination, or empty space only stops; other hexes are then handled as idle taps (retarget).
  - Distant moves always need a confirming second tap, on mouse and touch alike. There is no hover preview, because touch has no hover.
  - After a stop, the rest of the route stays previewed, so one tap resumes.
- **UI state** (`main.js`): `ui.preview`, `ui.noWay` and `ui.selected` are view state and are not saved. Readout strings come from `src/ui/travelText.js`, which the browser check mirrors.
  - **Camera follow:** after each step, the camera recentres if the player is within max(2 hexes, 18%) of a viewport edge.
  - **Centre** recentres on the player.
  - **Escape** acts like tapping empty space.
- **Fog (Task 05):** tap intent and route planning take map memory's `isKnown` (see "Fog of war and map memory").
- **Rendering:** `src/render/entityArt.js` draws the step rim, the route (dashed, pale for a preview and gold while travelling, with a dark underlay), the red "no way" cross, and the player. Overlay draw order: terrain, details, sanctuary, step rim, hover, selection, route, cross, player, labels, vignette.

## Fog of war and map memory (Task 05)
- **Storage** (`src/world/mapMemory.js`): `createMapMemory(radius)` keeps one byte per hex in the same dense layout as `world.js`: `FOG.UNKNOWN`, `REMEMBERED` or `VISIBLE`.
  - `observe(center, sightRadius = SIGHT_RADIUS)` demotes the previous visible set to remembered and marks every map hex within `sightRadius` (hex distance, `hexesInRange`) visible. It returns how many hexes were seen for the first time. `SIGHT_RADIUS` is 4.
  - It also offers `stateAt`, `isKnown`, `isVisible`, `knownCount`, `totalCount`, and `knownHexes()` (row order).
  - Sight is a plain radius: no line of sight. Terrain `sightModifier`/`blocksSight`, time of day and the Cartographer upgrade are later modifiers to the radius or to the observed set; storage does not change.
- **State model:** map memory is *player persistent state* (it survives death; see "State model"). `main.js` holds it beside `world` and `player` and replaces it when a new world is created.
  - `serialize()` returns `{ version: 1, radius, known }`, where `known` is a base64 bitset of known hexes in row order. Visibility is not saved; it is recomputed with `observe(player.position)` after loading.
  - `restoreMapMemory(data, radius)` returns `{ ok, memory }` or `{ ok: false, error }` for a wrong version, a radius mismatch, bad base64 or a wrong length, and never half-applies. Nothing calls it yet (Task 13).
- **Update point:** the turn pipeline's visibility stage (`src/core/game.js`) calls `observe` after every successful action. A rejected action reveals nothing.
- **Entities:** `canSee(memory, { at, kind })`: a `landmark` (sanctuary, POIs) is shown once its hex is known; a `mobile` entity (enemies) only while its hex is visible. The renderer uses it for the sanctuary. Since Task 09, enemy drawing, readouts, tap intent and route avoidance use only enemies on visible hexes.
- **No leaks through movement:** `planRoute(world, from, to, { knows })` treats unknown hexes as impassable and returns `unexplored` for an unknown destination before it checks walkability. `decideTap` takes `knows` in its state and returns `{ kind: 'unexplored', at }`. Neighbours are always within sight, so single steps are unaffected. A known hex reachable only through unknown land reads as "cut off" until more is mapped.
- **Rendering** (`gridRenderer.js`, `frame.fog`): unknown hexes are skipped entirely, so only the background shows, and hidden terrain cannot be inferred from colour or outline. Remembered hexes get one batched veil (`REMEMBERED_VEIL`) drawn over terrain, details and the sanctuary. Overlays (route, player, highlights) are drawn above the veil. Without `frame.fog`, everything is drawn as visible.
- **Fog edge** (`src/render/fogArt.js`, drawn by `drawGrid` after the veil and before overlays):
  - `fogFrontier(cells, stateAt)` finds the unknown on-screen hexes next to known ones (`edge`, with the summed direction back toward the map) and the ring after them (`outer`). It works outward from the known cells, so a mostly unexplored screen stays cheap.
  - Four cloud sprites (soft radial blobs on a 128px offscreen canvas) are built once and stamped with `drawImage`: two puffs per edge hex, pushed toward the map so they spill about half a hex over it, and one faint puff per outer hex. Offsets, sizes and sprite choice come from coordinate hashes, so the clouds are static and stable.
  - Clouds are skipped below a 6px hex size, and where no canvas API exists (Node tests).
  - Placement depends only on knowledge, never on hidden terrain.
  - Drag cost at minimum zoom is about 0.45–0.65 ms script per frame (before the clouds: about 0.3).
- **Map dialog** (`src/ui/mapPanel.js`, `#map-button` in the view-control stack): an overview canvas drawn by the same `drawGrid`, with a view from `fitView(memory.knownHexes(), w, h, { maxSize: 16 })` (`gridView.js`; fits the explored area, capped so a small area is not blown up).
  - Tapping a known hex closes the dialog, selects that hex and centres the camera on it. Unknown hexes ignore taps.
  - Opening the map stops travel, because travel steps are timed and would otherwise continue behind the modal.
  - Below 500px viewport height the dialog drops its title and note so it fits without scrolling.
- **Cost:** a per-hex byte lookup while drawing, plus the fog edge (see above).

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
- **Deferred:** roads. (Ruins are points of interest since Task 08.) Rivers are noise contours, not flow-simulated, so a river can occasionally loop or end inland at high ground.

## State model
Keep the distinction between:
- **World definition:** seed-driven terrain and initial entities.
- **Persistent world changes:** opened containers, depleted resources, changed objects, discovered POIs.
- **Player persistent state:** map memory, knowledge, upgrades, sanctuary state.
- **Expedition state:** carried loot, current position, temporary status, expedition statistics.
- **UI state:** selected tile, open panel, hover, path preview. UI state should not contaminate saved world state unnecessarily.

## Turn/action pipeline
Actions should be explicit and validated. Suggested pipeline: validate action → apply player action → advance turn/clock → enemy/environment response → update visibility → emit log/events → save. Ensure invalid actions do not consume a turn. Path-following invokes one movement action per step and can be interrupted.

### Implementation (Task 06)
- **Game state** (`src/core/game.js`): `createGame(world)` returns `{ world, player, memory, changes, journal, clock, log, enemies }` (`changes` since Task 07, `journal` since Task 08, `enemies` since Task 09): the player on the sanctuary, map memory with the start observed, the clock at turn 0. `main.js` holds one `game` and replaces it whole for a new world; its `world`/`player`/`memory` variables are shorthands for the game's parts.
- **Actions** (`src/core/actions.js`): plain objects `{ type, ...params }`. Each definition has `cost` (integer ≥ 1), `validate` (must not change anything) and `apply`. Current actions: `move { to }` (adjacent walkable hex), `wait`, `gather { at }` (Task 07), `interact { at }` (Task 08), and `attack { at }`, `defend`, `flee`, `use { item }` (Task 10), `equip { item }`, `unequip { slot }` (Task 11); each costs 1 turn. `validateAction` also rejects non-objects (`badAction`), unknown types (own properties only: `unknownAction`) and malformed targets (`badTarget`).
- **Not actions:** inspecting, previewing or planning routes, panning, zooming, the Map and Seed dialogs. They change UI state only and never take a turn.
- **Pipeline** (`createTurnSystem({ reactions, onSave, sightRadius }).perform(game, action)`):
  1. validate: on failure return `{ ok: false, action, reason }`; nothing changed, logged, reacted or saved;
  2. apply the player's effect;
  3. advance the clock by `cost`; a day-part boundary adds a `dayPart` event;
  4. reactions, in registration order: `(game, { action, turn, time, from, events })` (`from` and `events` since Task 10) may return `{ events, interrupt }`. They see the applied action and the new turn but the previous visibility. The first `interrupt` wins. `main.js` registers `createCombatReactions()`: the enemy reaction (Task 09) with real blows, then the player's condition (Task 10, `src/systems/combat.js`);
  5. visibility: `memory.observe(player.position)`;
  6. log: events appended to `game.log` (plain data, newest last, capped at `LOG_LIMIT` = 100);
  7. save: `onSave(game, result)` (`null` until Task 13).
  It returns `{ ok: true, action, cost, turn, time, events, revealed, interrupt }`.
- **Clock** (`src/core/clock.js`): `{ turn }` is the only time state. `timeOf(turn)` derives `{ day (from 1), part, partIndex, turnInPart }`. Four day parts (morning, afternoon, evening, night) of `TURNS_PER_DAY_PART` = 12 turns, so 48 turns a day (about half an hour per turn); turn 0 is day 1, morning. `advanceClock` reports `partChanged`/`dayChanged`. `serializeClock`/`restoreClock` give a versioned, validated save form (`{ version: 1, turn }`), not called yet (Task 13). Day parts have no gameplay effect yet; sight, enemies and events can read `timeOf` later.
- **Idle:** nothing advances time except `perform`. Travel's 150 ms step delay is pacing only: each step is a separate `perform`, and stopping leaves no timer.
- **UI:** `src/ui/clockText.js` formats the clock ("Morning · day 1 · turn 0") and events ("Evening draws in", "Day 2 dawns"); an action's events are appended to its readout line. The clock chip has a day-part mark (`data-part`). **Wait** is disabled while travelling (taps already stop travel; disabling avoids a button that does two things). There is no log panel yet; `game.log` is kept for the journal/log UI (Task 14).

## Resources and gathering (Task 07)
- **Data** (`src/data/resources.js`): `RESOURCES` (wood, stone, herbs, food) and `NODE_KINDS`: `deadfall` (wood), `looseStone` (stone), `herbPatch` (herbs), `berryBushes` (food, land only), `fishShoal` (food, water only). Each kind has `yield` (units per gather: 2 for wood and stone, 1 otherwise) and `uses` [min, max] (gathers before it is spent). `nodeKindFor(resource, terrain)` picks the kind; `validateNodeKind` is tested.
- **Placement** (`src/world/resourceNodes.js`, *world definition*): `nodeForTile(seedNumber, tile)` is pure.
  - A hex holds a node if `hash(seed, q, r, 1) < NODE_DENSITY (0.15) × the terrain's best suitability`.
  - The resource is drawn from a second hash, weighted by suitability (`TERRAIN[...].resources`), and `uses` from a third.
  - The sanctuary hex never holds one.
  - `createWorld` adds `resourceAt(h)`, `resourceNodes` (row order) and `resourceLayoutVersion` (`RESOURCE_LAYOUT_VERSION` = 1; a golden test guards it). The everwake map has 490 nodes (about 10%).
  - Nodes can sit on impassable hexes (mountain stone, deep-water fish).
- **World changes** (`src/world/worldChanges.js`, *persistent world changes*): `game.changes` records gathers taken per hex (`gathersTaken`, `recordGather`). Remaining = `node.uses − gathersTaken`; the generated node is never modified.
  - `serialize()` → `{ version: 1, gathered: [[q, r, taken], …] }` (sorted).
  - `restoreWorldChanges` validates it (version, shape, positive counts, no duplicates) and never half-applies. Nothing calls it yet (Task 13).
  - There is no regrowth: spent stays spent.
- **Inventory** (`src/systems/inventory.js`, *expedition state*): gathering adds to the one inventory with `addItem`. Since Task 11 it also holds equipment; see "Inventory, items and equipment (Task 11)".
- **Rules** (`src/systems/gathering.js`):
  - `nodeState(game, h)` returns `{ at, node, def, left }`.
  - `checkGather(game, at)` checks in this order: `outside`, `unexplored` (so nothing about an unmapped hex leaks), `noNode`, `tooFar` (more than `GATHER_REACH` = 1 hex), `depleted`.
  - `gatherFrom` records one gather, adds the yield, and returns a `gathered` event.
  - `gatherOptions(game)` lists the nodes in reach: own hex first, then neighbours in `DIRECTIONS` order.
  - `planApproach(world, from, target, { knows })` finds the cheapest mapped route to a walkable neighbour of `target`, or `null`.
- **Action:** `gather { at }`, cost 1 (`src/core/actions.js`). `apply` may now return `{ events }`; the pipeline puts the action's own events before the clock's `dayPart` event. Gathers go into `game.log`.
- **Tap intent:** `decideTap` takes `nodeAt` (a mapped hex with a node that has gathers left) and `travelTarget`. For an *impassable* hex with a live node:
  - `node` when adjacent (inspect; gather with the button);
  - otherwise `approach`: a preview `{ destination: approach hex, target: node, path, cost }`. Tapping the node again (`preview.target`) travels;
  - `blocked` when `planApproach` finds no route.
  A spent node there is plain `impassable`. Walkable node hexes keep the normal step/preview behaviour (you gather standing on them). While walking to a node, tapping it only stops. Stop/interrupt keeps `target` on the remaining preview, so one tap on the node resumes.
- **UI** (`main.js`, `hud.js`, `src/ui/gatherText.js`):
  - **Gather buttons:** `#gather-actions` holds one button per option ("Gather wood", plus "here" or a direction arrow; the accessible name spells out node, direction and gathers left). It is hidden when there are none and while travelling. The buttons are rebuilt only when the set changes, and a click still goes through the pipeline.
  - **Inventory:** `#inventory-status` shows "Wood n · Stone n · Herbs n · Food n" with colour dots (`itemText.inventoryEntries` since Task 11; it stays limited to the four resources so the line never covers the map).
  - **Readouts:** readouts about a mapped node hex append `nodeNote` ("· Deadfall (wood) · 2 gathers left" / "· … · picked clean"). After a gather, the readout is the turn's events (`clockText.describeEvents`).
  - **Layout:** `.hud-bottom` stacks the Gather row above the readout.
- **Rendering** (`src/render/resourceArt.js`):
  - **Glyphs:** a node glyph sits on a dark disc at (0.34, 0.4)·size from the hex centre, clear of the player figure. Glyphs are batched per kind.
  - **Zoom levels:** below a 12px hex they are coloured dots, and below 6px nothing is drawn.
  - **Spent nodes:** a faint dashed ring.
  - **Fog:** nodes are drawn after the sanctuary and before the remembered veil, only on mapped hexes (landmarks).
  - **Gather rings:** `drawGatherTargets` rings the nodes in reach after the step rim.
  - The Map dialog also draws nodes.
  - Drag cost at minimum zoom is unchanged (about 0.5–0.6 ms script per frame).

## Points of interest and the journal (Task 08)
- **Data** (`src/data/pois.js`): `POI_TYPES` ruins, camp, chest, shrine, cave. Each type has `names` (a place's name is picked by hash), `verb`/`done` (Search/searched, Open/opened, Read/read), `uses` [min, max] (ruins 2–3, the rest 1) and an `effect`:
  - `finds`: a weighted `finds` table of `{ resource: count }`. Every entry is non-empty, and `validatePoiType` is tested.
  - `reveal`: the shrine, with `revealRadius` 7.
- **Placement** (`src/world/poiPlacement.js`, *world definition*): axial cells of `CELL` = 7.
  - A cell proposes at most one POI (70% chance): it samples 6 hashed hexes and scores every type on each with `poiSuitability(tile, neighbours)`, times a per-type weight and hashed jitter. It proposes the best if the score is at least 0.45.
  - A proposal is dropped if a higher-priority proposal (hash, then cell order) lies within `MIN_SPACING` = 4, or a same-type one within `SAME_TYPE_SPACING` = 9. Only cells up to two away are read, so the result is order-independent and chunk-ready.
  - Allowed hexes: walkable, not water, no resource node, at least `SANCTUARY_CLEARANCE` = 3 from the sanctuary. So placement depends on the node layout and on the sanctuary (the sanctuary is global on the bounded map).
  - `createWorld` adds `seedNumber`, `poiAt(h)`, `pois` (row order) and `poiLayoutVersion` (`POI_LAYOUT_VERSION` = 1; a golden test guards it). The everwake map has 50 POIs. Placement adds about 5 ms to world creation.
  - `rollFind(seedNumber, poi, useIndex)`: what each use yields is a hash of (seed, hex, use), so it is part of the world definition. Opening a chest reveals it; it is not rolled at that moment.
- **Discovery** (`src/systems/pois.js` `discoverIn`):
  - A POI is discovered when its hex becomes known. "Discovered" therefore means "its hex is mapped", and there is no separate flag to keep in sync.
  - `mapMemory.observe` now also returns `newly` (the hexes seen for the first time), and `mapMemory.reveal(center, radius)` marks unknown hexes REMEMBERED without sight, returning `newly` too.
  - The pipeline's visibility stage passes `newly` to `discoverIn`. Its `discovered` events (`{ at, poi, name, from }`, nearest first) follow the reactions' events, and the first discovery sets `interrupt: { reason: 'discovery' }` unless a reaction already did. So travel stops when a POI is sighted. A discovery on a route's last step still reads as arrival.
  - `createGame` discovers what is in sight of the start at turn 0 (log and journal).
  - Shrine discoveries come from the action's own apply step and do not interrupt.
- **Rules:**
  - `poiState(game, h)` returns `{ at, poi, def, used, left }`.
  - `checkInteract` checks, in order: `outside`, `unexplored`, `noPoi`, `tooFar` (more than `INTERACT_REACH` = 1, as for gathering), `spent`.
  - `interactWith` records one use, then either adds the find to the inventory or reveals the shrine's radius and discovers what is there.
  - `interactOptions`: own hex first, then neighbours in `DIRECTIONS` order.
- **Action:** `interact { at }`, cost 1 for every type, so turn costs are uniform. Events: `interacted { at, poi, name, use, left, found? | revealed? }`, then any `discovered`.
- **World changes:** `recordPoiUse` and `poiUsesTaken`; remaining = `poi.uses − taken`. The save form is version 2: `{ version, gathered, pois }`. `restoreWorldChanges` still accepts version 1 (read as no POI uses).
- **Journal** (`src/systems/journal.js`, *player persistent state*): `game.journal`.
  - The pipeline's log stage records every `discovered`/`interacted` event with its turn (`record(events, turn)`).
  - It is not capped (it is bounded by the POIs on the map), unlike `game.log`.
  - `serialize`/`restoreJournal` give a versioned, validated form (turns in order, known types, hex and names). Nothing calls them yet (Task 13).
- **UI:**
  - `main.js` `contextOptions()` lists POI options, then gather options. `hud.showActions` builds one row (`#context-actions`, `hud-button--interact` / `hud-button--gather`), and `onAction(index)` sends `interact` or `gather` through the pipeline.
  - Readouts append `poiText.poiNote` after the node note.
  - Event text lives in `src/ui/poiText.js`, which `clockText.describeEvent` uses. Bearings are screen sectors (E, NE, NW, W, SW, SE) of the pixel offset from the player.
  - The **Journal** dialog (`src/ui/journalPanel.js`, `#journal-button` under Map) lists entries newest first, with day and day part. Tapping an entry closes the dialog, selects that hex and centres on it. Opening it stops travel.
- **Rendering** (`src/render/poiArt.js`):
  - **Glyphs:** a glyph sits on a dark disc at (−0.42, −0.2)·size from the hex centre, so it stays visible beside the player and opposite resource glyphs. A gold glint means uses are left; a used POI is drawn at 55% opacity, with an open chest lid and a dark shrine rune.
  - **Zoom levels:** below an 18px hex, POIs are type-coloured diamonds; below 4px nothing is drawn.
  - **Fog:** POIs are drawn after nodes and before the remembered veil, on mapped hexes only.
  - **Interact rings:** `drawInteractTargets` rings the POIs in reach.
  - The Map dialog draws POIs too and has a "Place" legend key.
  - Drag cost is unchanged against Task 07 (`npm run perf` on both builds, within noise).
- **Deferred:** cave interiors (a cave mouth is searched once from outside), items other than the four resources as loot (done in Task 11), and any use of journal knowledge for progression (Task 12).

## Enemies and AI (Task 09)
- **Data** (`src/data/enemies.js`): `ENEMY_TYPES` wolf, boar, skeleton. Each has `health`, `attack`, `defense` (for combat, Task 10), `detectRange`, `leashRange`, `moveEvery`, `attackRange`, an optional `territory` and `charge`, a `behaviour` line and a terrain `habitat`. `validateEnemyType` is tested. It requires `detectRange` ≤ the player's sight radius (4) and `leashRange` > `detectRange`.
  - **Wolf:** health 8, attack 3. Notices you at 4 hexes and gives up beyond 8. Lives in woods and hills.
  - **Boar:** health 12, attack 5, defense 1 (2 until Task 10). Notices you at 3 hexes. Gives up beyond 5 hexes, or when you are more than 5 from its home (`territory`). Charges from exactly 3 hexes along a straight hex line. Lives in grassland and forest.
  - **Skeleton:** health 10, defense 2 (3 until Task 10). Notices you at 3 hexes and gives up beyond 10. Moves only on even turns (`moveEvery` 2). Guards ruins.
- **Placement** (`src/world/enemyPlacement.js`, *world definition*): `placeEnemies(seedNumber, ctx)`.
  - **Beasts:** axial cells of `CELL` = 8. 45% of cells hold one. It goes on the best of 5 hashed hexes in the cell's interior, so beasts from neighbouring cells are at least 2 apart. Its archetype is the one whose habitat suits that terrain best, with hashed jitter.
  - **Ruin guards:** a skeleton beside 80% of ruins, on the first allowed neighbour from a hashed direction. A beast within `GUARD_SPACING` = 3 of a guard is dropped.
  - **Allowed hexes:** walkable, not water, no POI, and at least `CLEARANCE` = 10 from the sanctuary. So nothing within sight of the start can notice you there.
  - `createWorld` adds `enemySpawns` (`{ id, type, q, r }` in row order, where `id` is the index) and `enemyLayoutVersion` (`ENEMY_LAYOUT_VERSION` = 1; a golden test guards it).
  - The everwake map has 34 enemies: 9 skeletons, 11 wolves and 14 boars.
- **Roster** (`src/systems/enemies.js` `createEnemies`, *live world state*): `game.enemies` is `{ list, at(h), add(type, at), moveTo(enemy, h) }`.
  - Each enemy is `{ id, type, home, position, health, mode }`.
  - `at(h)` returns the living enemy on a hex. `moveTo` keeps the hex index in step.
  - It is not saved yet. Task 13 decides how much of it persists, and Task 12 whether enemies reset between expeditions.
- **AI** (`createEnemyReaction({ attack })`, registered in `main.js`): every living enemy acts once per successful action, in id order. It acts after the player's action and the clock, and before visibility. Nothing runs on refused actions or while idle.
  - **`idle`** (at home): when the player comes within `detectRange`, it switches to `hunting`, emits an `enemyDetected` event and sets `interrupt: { reason: 'enemy' }`. It then acts in the same turn.
  - **`hunting`:** it may give up (`enemyDisengaged`, reason `distance`, `territory` or `sanctuary`) and switch to `returning`. Otherwise:
    - within `attackRange`, it attacks (calls `attack`; interrupts);
    - else, on its move turns, it moves one hex along an A* route (`findPath`, terrain move costs, `PATH_LIMIT` = 400 nodes). The route avoids other enemies, the player and the ward. If there is no route, it waits;
    - a charger at exactly `charge` hexes on a straight line with clear ground dashes `charge − 1` hexes and attacks with `{ charge: true }`.
  - **`returning`:** walks home the same way and becomes `idle` there. If it notices the player again on the way (and the player is not out of bounds), it switches back to hunting.
  - Being noticed and being attacked interrupt travel. A chase in progress does not.
  - **Sanctuary ward:** the hexes closer than `SANCTUARY_WARD` = 2 to the sanctuary (the sanctuary and its six neighbours). Enemies never enter them. A player inside the ward is never noticed, and stepping into it ends any chase.
  - **Occupancy:** at most one enemy per hex, and never on the player's hex. The `move` action is refused with `occupied` (no turn passes) for a hex with a living enemy.
  - `enemyIntent(game, enemy)` derives `idle | approach | charge | attack | return` from mode and positions. Intent is not stored.
- **Combat handoff:** `attack(game, enemy, { charge, parting, action })` returns events. The game passes `systems/combat.js` `enemyStrike` (Task 10). The default `stubAttack` (damage 0, `stub: true`) is kept so AI tests do not depend on damage.
- **Breaking off (Task 10):** reactions receive `from` (the player hex before the action). A hunting enemy that was within reach of `from`:
  - after a plain `move` out of its reach gets a **parting strike** (`parting: true`) and does not move that turn;
  - after `flee` loses its turn (no move, no attack).
  Once the player is at 0 health, no further enemy acts that turn.
- **Player-facing rules:**
  - `decideTap` takes `enemyAt` (visible enemies only). Tapping an enemy hex inspects it (`kind: 'enemy'`, no turn), even when it is adjacent.
  - `planRoute` takes `avoid`; the page plans routes around visible enemies.
  - If an enemy steps onto a route, that travel step is refused (`occupied`) and the readout says which enemy blocks it.
- **UI text** (`src/ui/enemyText.js`):
  - **Readout notes:** "· Wolf · health 8/8 · hunting you". The intents read "has not noticed you", "hunting you", "about to charge", "in striking range" and "heading back".
  - **Inspecting** an enemy also shows its archetype's behaviour line.
  - **Events:** "A wolf has noticed you · 3 hexes north-east", "The boar charges into you …", "The wolf gives up the chase", "The boar turns back to its ground", "The skeleton will not follow you into the sanctuary".
  - `clockText.describeEvent` routes `enemy*` events here. Enemy events go to `game.log`, not to the journal.
- **Rendering** (`src/render/enemyArt.js`, drawn after the route and the "no way" marker, before the player):
  - **Figures:** a wolf (lean grey profile, pointed ears, amber eye), a boar (brown and humped, with bristles and a pale tusk) and a skeleton (skull, ribcage, limbs).
  - **Zoom levels:** below a 14px hex they are type-coloured tokens (wedge, block, diamond). Below 4px nothing is drawn.
  - **Health bar:** a red bar above each enemy from a 10px hex.
  - **Intent ring** around the hex: amber while hunting, red when about to strike or charge, dashed grey when heading back, none while unaware.
  - Only enemies on visible hexes are drawn. The Map dialog shows none, because it is a map of remembered land. The step rim skips hexes with an enemy.
- **Browser check:** the general flows only choose routes that never come within any enemy's detection range (`quietPath`). Enemies therefore stay home, and the existing mirrors still hold. Idle enemies in sight appear in the expected readouts. `verifyEnemies` mirrors every turn with a Node game run through the real pipeline.
- **Deferred:**
  - enemy persistence and respawning (Tasks 12–13);
  - line of sight, and night or terrain effects on detection;
  - wandering while unaware;
  - packs;
  - enemies in the Map dialog.

## Combat (Task 10)
- **Where:** `src/systems/combat.js` (rules), `src/data/consumables.js`, terrain `cover` (`src/data/terrain.js`), `src/ui/combatText.js`, `src/ui/contextActions.js`, `src/ui/defeatPanel.js`. There is no combat mode: an encounter is ordinary turns on the hex map, through the same pipeline.
- **Player stats** (`src/entities/player.js`): `player.health` / `player.maxHealth` (24) are expedition state. Attack and defense are not stored: `playerStats(player)` derives them from `PLAYER_BASE` plus worn equipment (Task 11: base 2/0, starting kit 4/1). Upgrades (Task 12) plug in there too.
- **Blows** are deterministic: `damage = max(1, attack + charge bonus − (defense + cover + defend bonus))`.
  - `cover` is the defender's terrain: forest 1, dense forest 2, else 0. It applies to the player and to enemies.
  - Defend adds `DEFEND_BONUS` = 2 against every blow that turn (the enemy strike reads `action.type === 'defend'`; nothing is stored).
  - A boar's charge adds `CHARGE_BONUS` = 2.
  - Enemy stats were retuned: boar defense 1 (was 2), skeleton defense 2 (was 3). With base stats a wolf takes 3 blows, a boar 4, a skeleton 5.
- **Actions** (`src/core/actions.js`, one turn each; refusals cost nothing):
  - `attack { at }`: a living enemy in sight on a neighbouring hex. Refusals in order: `badTarget`, `outside`, `noEnemy` (also for unseen hexes, so nothing leaks), `tooFar`, `sanctuary` (no fighting from the ward: enemies never enter it, so it would be a free hit). An idle or returning enemy that is struck turns to hunt. At 0 health it is removed (`enemies.kill`, which frees its hex), emits `enemyDefeated` and never acts again. Dead enemies stay dead for now (respawning: Tasks 12–13).
  - `defend`: only while an enemy in sight is hunting you (`noThreat`).
  - `flee`: only while a hunting enemy is within its reach of you (`notEngaged`). `fleeTarget` picks the walkable, unoccupied neighbour farthest from every enemy in sight, which must be at least 2 from all of them (else `cornered`); ties go nearer the sanctuary, then cheaper ground, then `DIRECTIONS` order. See "Breaking off" under Enemies for its effect.
  - `use { item }`: herbs heal 5, food 3, capped at maximum health. Refusals: `notUsable`, `noItem`, `fullHealth`. `inventory.removeItem` was added. (Task 11 moved this to `systems/items.js` and extended it to every consumable.)
- **Reactions** (`createCombatReactions()`, registered by `main.js` and the browser check): the enemy reaction with `enemyStrike`, then `createConditionReaction()`:
  - at 0 health, **defeat**: the player is moved to the sanctuary with full health, every hunting enemy switches to `returning`, and a `defeated { at, id, enemy }` event is emitted (the felling blow is found in the turn's events, which reactions now receive as `ctx.events`). Carried items are kept: Task 12 decides what a defeat costs and adds the report;
  - otherwise, ending a turn on sanctuary ground while hurt restores `SANCTUARY_RECOVERY` = 2 (`recovered` event).
- **Events:** `playerAttack`, `enemyDefeated`, `defended`, `fled`, `used`, `recovered`, `defeated`; `enemyAttack` now carries `parting`, `guarded`, `cover`, `health`, `maxHealth`. All go to `game.log`; none to the journal. Text: `combatText.describeCombatEvent` (routed by `clockText.describeEvent`), and `enemyText` words real blows ("The wolf strikes as you pull away: 2 damage · health 22/24").
- **UI:**
  - `#health-status` under the position line: "Health 22/24" over a bar (`--hp`), red border at a third or less; `role="meter"` with value attributes.
  - The context row (`src/ui/contextActions.js`, shared with the browser check): Attack per adjacent enemy (arrow and damage), Defend, Flee (arrow), Use/Eat while hurt, then POI and Gather buttons. Only valid options are shown, and each press still goes through the pipeline; a refusal is explained by `describeCombatRefused`.
  - The readout after a combat action is the turn's events ("You strike the wolf for 3 · wolf 5/8 · The wolf attacks: 2 damage · health 22/24").
  - Defeat: `main.js` drops any route, recentres on the sanctuary, sets the readout to the turn's events and opens `#defeat-dialog` (closing it only acknowledges). Task 12 replaces it with the expedition report.
  - Tapping an enemy still only inspects it (no turn); attacking is always a button, so a mis-tap never starts a fight.
- **Deferred:** loot and rewards from enemies (done in Task 11), defeat costs and the report (Task 12), enemy persistence and respawning (Tasks 12–13), ranged attacks, randomness in blows, elevation effects.

## Inventory, items and equipment (Task 11)
- **Data** (`src/data/items.js`, replaces `data/consumables.js`): `ITEMS` keyed by id, each with `name` (`plural` where it differs), `kind` and `about`:
  - `material`: wood, stone;
  - `consumable` (`verb`, `heal`): herbs 5, food 3, rations 4, healingPotion 12;
  - `weapon` (`attack`): huntingKnife 2, shortSword 3;
  - `armor` (`defense`): paddedJerkin 1, ringMail 2.
  The gathered resources keep their ids, so gathering is unchanged. `SLOTS` = weapon, armor; `slotOf(id)` is the item's kind when that is a slot. `validateItem` is tested. Loot tables (POI `finds`, enemy `loot`) are `[weight, { item: count }]`: `pickWeighted(table, u32)` rolls one, `validateLootTable` checks that the items exist, and `freezeLootTable` freezes one.
- **Inventory** (`src/systems/inventory.js`, *expedition state*): `{ items: { id: count }, equipped: { weapon, armor } }`. It is the single source of truth for everything carried. A worn item sits in its slot and is **not** counted in `items`. `equip(inv, id)` moves one unit in and returns the replaced id (which goes back into `items`); `unequip(inv, slot)` moves it out. `equipmentBonus` sums worn stats. `addItem` now refuses unknown ids. `createInventory(start)` takes a starting kit.
- **Starting kit** (`entities/player.js` `STARTING_KIT`): knife and jerkin worn, 2 rations and 1 healing potion carried. `PLAYER_BASE` is bare-handed (attack 2, defense 0), so the kit restores the Task 10 tuning (4/1).
- **Rules** (`src/systems/items.js`): three actions, each costing **1 turn** through the pipeline, so enemies react (changing gear mid-fight has a price):
  - `use { item }`: refusals `notUsable` (unknown, material or gear), `noItem`, `fullHealth`. The `used` event now also carries `left`.
  - `equip { item }`: refusals `notEquipment`, `noItem` (none spare), `alreadyEquipped` (the same item is already worn). Emits `equipped { item, slot, replaced, attack, defense }`.
  - `unequip { slot }`: refusals `badSlot` (own-property check), `emptySlot`. Emits `unequipped { item, slot, attack, defense }`.
  Checks change nothing, so a refusal costs no turn. `useOptions` (the context row's Use buttons) lists every carried consumable while hurt. `inventoryView(game)` is the Pack's whole view model (stats, slots with their unequip check, carried items in item order, each with a `use`/`equip` action and its check).
- **Rewards:** POI find tables now include potions, rations and gear (ruins, chests, camps, caves; `rollFind` uses `pickWeighted`; the placement layout is unchanged). Enemy types have `loot`: wolf food 1–2, boar food 2–3, skeleton a potion, short sword or ring mail. `enemyPlacement.rollLoot(seed, enemy)` hashes (seed, home hex), so loot is part of the world definition like a chest's contents. `attackEnemy` adds it to the inventory when the enemy falls, and `enemyDefeated` carries `loot`.
- **UI:**
  - `src/ui/itemText.js`: item nouns and bundles ("1 stone, 2 healing potions"; `poiText.describeFound` delegates to it), the HUD line, item events (routed by `clockText.describeEvent` before combat), refusals, and the Pack's lines and buttons.
  - `src/ui/inventoryPanel.js`: the **Pack** dialog (`#pack-dialog`), opened by `#pack-button` beside the inventory line. Every button is one pipeline action via `main.js` `onAction`. Buttons that fail their check are disabled, with a short reason beside them. The dialog stays open, re-renders and shows the outcome in `#pack-message`; focus returns to the same button (`data-key`). Opening it stops travel, and a defeat closes it before the defeat notice.
  - The Pack button sits in the status block rather than the right-hand icon stack: a sixth icon crowded the stack into the top bar at 844×390. On short screens the dialog hides its title and note and scrolls as one panel (no nested scrolling list).
- **Deferred:** carry capacity and weight (the design allows deferring it, and nothing displays it); dropping items; durability; crafting with materials; what a defeat costs in carried items (Task 12); saving the inventory (Task 13).

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
- Browser checks live in `tools/browser/` (Node 22+, Chrome). `check-world.mjs` (`npm run check:browser`, `VIEWPORT=<fragment>` for one viewport) taps predicted hexes in headless Chrome across four viewports and drives the movement flows (it reads the player position from `#player-status`; seed `island-133` provides a cut-off islet for the unreachable case, and since Task 07 seed `shore-42` has mountain stone near the start for the approach-a-node flow; since Task 08 seed `shrine-64` has a shrine three steps from the start that reveals a chest). Since Task 08 the check also mirrors POI discoveries (`walked` returns the last step's discoveries; `discoversAlong` and `peekDiscoveries` predict them without changing the mirror) and day-part events where it predicts an interrupted readout. Flows that compare exact arrival text pick routes that discover nothing; the POI flow covers interruption on purpose. On short screens it drags the map to bring a target out from under the HUD. It computes the expected readout in Node from the same pure modules, so it must be updated when the readout or UI flows change. Since Task 05 it also mirrors map memory: it calls `observe` for every hex the player is known to have stood on, and explores toward impassable or unreachable targets before tapping them. `perf.mjs` (`npm run perf`) measures drag frame times. Pitfalls are listed at the top of `tools/browser/cdp.mjs`: no `--disable-gpu`, keep taps away from buttons, and DPR-halved wheel deltas.

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
- 2026-11-27 (Task 04): Distant moves need two taps: the first previews and the second travels, the same on touch and mouse. Route following is a timed sequence of individually validated one-hex steps, and the pacing is presentation only. Terrain cost weights routes; each hex counts as one move until Task 06 decides turn costs.
- 2026-11-27 (Task 06): Every player state change goes through one pipeline (validate → apply → clock → reactions → visibility → log → save). Moving costs one turn per hex regardless of terrain (the design's "move one hex = one turn"); terrain cost only shapes routes. The clock is a single turn counter with a derived four-part day of 12 turns per part. Reactions run before visibility so that anything they move is seen correctly the same turn. Log entries are structured data formatted by the UI.
- 2026-11-27 (Task 07): Resource nodes are part of the generated world definition, placed per coordinate from hashes and terrain suitability. Gathering only ever records changes in a separate persistent layer (gathers taken per hex), so the baseline is reproducible and saves stay small. Nodes are gathered from their hex or any neighbour, so nodes on impassable terrain are usable from beside them; tapping a far one routes next to it, and "blocked" means no mapped approach exists. The UI offers one Gather button per valid option rather than a target-picking mode, which keeps it to one tap on touch. Nodes do not regrow (deferred).
- 2026-11-27 (Task 08): Points of interest are part of the world definition, placed per cell from hashes and local terrain, with spacing rules that read only nearby cells, so placement is order-independent. What a POI yields is also seeded; only uses taken are stored, as persistent world changes. A POI counts as discovered once its hex is mapped (no second flag). Sighting one interrupts travel, because discovery is the kind of meaningful event the design says should stop movement. Every interaction is one `interact` action costing one turn from the POI's hex or a neighbour, the same reach as gathering. Shrines give knowledge (they map the land around them) rather than items. The journal is a separate, uncapped, persistent record of discovery and interaction events, distinct from the capped turn log.
- 2026-11-27 (Task 09): Enemy homes are part of the world definition (seeded per cell, plus ruin guards). Where enemies are and what they are doing is live state in `game.enemies`, changed only by the enemy reaction in the turn pipeline, so nothing moves while idle. The AI is a three-mode state machine (idle, hunting, returning) with derived intent, a fixed order and no randomness, so it is easy to debug. Detection range never exceeds the player's sight, so being noticed is always visible and nothing leaks through fog. Enemies occupy hexes and route with the same A* and walkability as the player. The sanctuary and its neighbours are safe ground. Attacks are a handoff (`attack(game, enemy, { charge })`): until Task 10 the stub reports them and deals no damage, and the readout says so.
- 2026-11-27 (Task 11): Items are data, and one inventory object holds everything carried and worn, so gathering, finds, loot and the UI cannot drift apart. A worn item is held in its slot, not counted among the carried items, so the counts mean "spare". Using, equipping and unequipping are ordinary one-turn actions in the pipeline (enemies react), and every check is side-effect free, so a refusal costs nothing. Stats are derived (base plus gear), and the starting kit reproduces the Task 10 tuning. Enemy loot is seeded per enemy home, like chest contents. Carry capacity is deferred rather than shown as a number that does nothing.
- 2026-11-27 (Task 10): Combat happens on the hex map inside the normal turn pipeline, with no separate combat mode or screen. Blows are deterministic (attack − defense, at least 1, adjusted by cover, Defend and charges) so a fight can be read and planned, and the Attack button shows the damage in advance. Walking away from an adjacent enemy gives it a parting strike; that is what makes Flee (a clean break that also costs the enemy its turn) worth having, since stepping away was otherwise always free. Defeat is handled minimally but for real: the player wakes at the sanctuary healed and hunters lose the trail; what a defeat costs (loot, report) is left to Task 12. Herbs and food heal, so the existing resources serve as consumables until Task 11. Boar defense went 2→1 and skeleton 3→2 so fights with base stats take 3–5 blows.
- 2026-11-27 (Task 05): Fog uses three per-hex states with a plain hex-distance sight radius of 4. Only known/unknown is persisted; visibility is derived from position. Route planning and tap feedback use only mapped hexes, so fog cannot be seen through via previews or error messages. Unknown hexes are not drawn at all. The map view is a dialog that reuses the main renderer, not an always-on minimap, to keep the phone screen clear.
- 2026-11-27 (Task 01): Pointy-top hex orientation. All geometry lives in `src/world/hex.js`, and the screen transform lives in `src/render/gridView.js`. Hit-testing works in CSS pixels, so device pixel ratio never affects which hex is picked.
