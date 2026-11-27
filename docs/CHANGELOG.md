# Everwake — Changelog

This file records notable project changes. It begins as a documentation scaffold.


## Unreleased

### Task 13: Saving and loading
- **Autosave:** the world is saved in this browser after every turn, when you set out, when you learn an upgrade, and when a new world begins. Reloading the page puts you back exactly where you were: mid-expedition, hunted if you were being hunted, or at the sanctuary screen between expeditions.
- **What is saved:**
  - the world's seed (the map is regenerated from it, identically);
  - spent resource nodes and used places;
  - the map you have explored, the journal, and the clock;
  - every enemy's position, health and state (the fallen stay fallen);
  - your position, health and pack;
  - the expedition under way, the reports of past ones, insight and upgrades.
- **Start screen:** when a save exists, the page opens on **Welcome back** with the world, expedition, time, progress and when it was saved. Choose **Continue** (or press Escape), **New world** or **Import save**. A link naming a different world no longer replaces your save: the start screen mentions it, and New world offers that seed.
- **Replacing a world needs confirmation:** creating a new world or importing a save opens **Replace this world?** / **Load this save?**. It says what will be erased (seed, hexes mapped, places, insight, upgrade levels, expedition) and that it cannot be undone. It offers **Export save first**. **Keep my world** has focus.
- **Export and import:** the Seed dialog has a **Save** section with the save status, **Export save** (downloads a .json file) and **Import save** (loads one after checking it and asking first). The sanctuary screen has a **World & save** button for the same dialog between expeditions.
- **Damaged saves:** if the save cannot be loaded, a recovery screen says why. Nothing is deleted, and the game does not save over it until you choose:
  - **Download damaged save**;
  - **Try again**;
  - **Import save**;
  - **New world**, which keeps the damaged save as a backup in the browser.
- **Saving problems are visible:** if the browser blocks storage or it is full, a red note under the title says the game is not being saved. The last good save is kept.
- Saves are versioned and fully validated on load, including whether they fit the world they name. A save from a different world generator or a newer version is refused with a reason.
- Tests: save format round trips (including playing on in lockstep after a reload), regenerated baseline, persisted world changes, sight restored without new mapping, every validation refusal and a fuzz pass, the storage slot (empty, damaged, blocked, full, writes that do not stick), export, and text (277 tests total). The browser check adds a saving-and-loading flow on two viewports: autosave, the start screen, confirmations, a link to another world, reloading between expeditions, export, import (bad and good files) and the damaged-save recovery.

### Task 12: Expeditions, the sanctuary and permanent upgrades
- **Expeditions:** the game starts on expedition 1. An expedition ends in one of two ways:
  - **Return:** a **Return** button appears on sanctuary ground (the sanctuary and its six neighbours) once you have set off. It takes one turn and ends the expedition. You keep everything you carry and wear.
  - **Defeat:** at 0 health you wake at the sanctuary and everything you carried and wore is lost.
- **Expedition report:** the sanctuary screen opens with the report:
  - steps and the farthest point reached;
  - turns and the time of day at the start and end;
  - hexes mapped;
  - places discovered and explored;
  - what you gathered and found;
  - enemies defeated, by kind;
  - how it ended, and what you kept or lost.
- **Insight**, earned from exploring and the same for either ending: 1 per 5 hexes mapped, 5 per place discovered, 2 per place explored, 3 per enemy defeated.
- **Upgrades** are learned at the sanctuary with insight and last for good, from your next expedition:
  - **Survivor:** +4 maximum health per level (3 levels).
  - **Cartographer:** +1 sight radius per level (2 levels).
  - **Pathfinder:** enemies notice you 1 hex closer per level, never less than 1 (2 levels).
  - **Scavenger:** +1 from every gather per level (2 levels).
  Each shows its effect now and next, and a Learn button that is disabled with the reason when it can't be bought.
- **Set out · expedition N** starts the next expedition. No turn passes; the world clock carries on.
  - You start at the sanctuary at full health.
  - After a return, you carry your kept pack, topped up to the starting rations and potion, with the knife and jerkin worn if a slot is empty.
  - After a defeat, you start with the basic kit.
  - Enemies still alive go home healed and unaware. Enemies you defeated stay gone.
- **What survives:** the world and its seed, your map, the journal, spent nodes and used places, insight and upgrades all carry over.
- The sanctuary screen replaces the Task 10 defeat notice. Escape does not close it; Set out does. Between expeditions every action is refused (no turn passes).
- Tests:
  - upgrade data, insight and its formula;
  - returning (refusals at no cost, report, pack kept, insight);
  - setting out (pack kept and resupplied; nothing else reset; one expedition at a time);
  - defeat (pack lost; map, journal and world changes kept; basic kit);
  - enemy reset, with the fallen staying fallen;
  - the tally of places, uses and finds;
  - buying upgrades (refusals, maximum);
  - each of the four upgrade effects;
  - the Return button, and the text.
  255 tests in total.
- **Browser check:**
  - The defeat flow now checks the sanctuary screen against a Node mirror: report rows, insight, upgrade buttons, fit on screen, touch-sized buttons, and that Escape doesn't dismiss it. It then sets out with the basic kit and checks that survivors are home and the fallen stay fallen.
  - A new flow on all four viewports walks 12 hexes out on a quiet route and back, presses Return, checks the report, learns Survivor, and sets out with 28 health and the kept pack.

### Task 11: Inventory, equipment and consumables
- **One inventory for everything.** Gathering, POI finds, enemy loot, consumables, equipment and the UI all read and write the same `player.inventory` (`{ items, equipped }`). Items are defined in `src/data/items.js`, which replaces `src/data/consumables.js`.
- **Items:** wood and stone (materials); herbs (+5), food (+3, gathered), rations (+4, packed at the sanctuary) and the healing potion (+12) are consumables; the hunting knife (+2 attack) and short sword (+3) are weapons; the padded jerkin (+1 defense) and ring mail (+2) are armor.
- **Starting kit:** you set out wearing the hunting knife and padded jerkin, carrying 2 rations and 1 healing potion. Bare-handed stats are now attack 2 and defense 0, so the kit gives the same attack 4 / defense 1 as before. Attack and defense are always derived from what is worn.
- **New actions, one turn each, through the turn pipeline (enemies react):** `equip { item }` (what it replaces goes back into the pack) and `unequip { slot }`. `use { item }` now covers every consumable. Refusals cost nothing: `notEquipment`, `noItem`, `alreadyEquipped`, `badSlot`, `emptySlot`, `notUsable`, `fullHealth`.
- **Pack dialog** (the Pack button beside the inventory line): health, attack and defense; what is worn, each with **Take off**; everything carried, with what it does and an **Eat / Use / Drink** or **Equip** button. A button that cannot be used now is disabled, with the reason beside it ("full health", "worn"). The dialog stays open after an action and shows the outcome ("You equip the short sword (hunting knife put away) · Attack 5 · Defense 1"). On short landscape phones it drops its title and note and scrolls as one panel.
- **Loot:** chests, ruins, camps and caves can now hold healing potions, rations, short swords and ring mail. Fallen enemies leave loot straight in your pack ("The wolf falls · you take 2 food"): beasts give food; skeletons carry a potion, a short sword or ring mail. Like a chest's contents, each enemy's loot is fixed by the seed (`enemyPlacement.rollLoot`).
- While hurt, the action row offers every carried consumable (Eat rations, Drink healing potion, …).
- The HUD inventory line still lists the four gathered resources only, so it never covers the map on small screens. Supplies, loot and gear are listed in the Pack.
- Tests: item and loot-table data, weighted picks, inventory equip and unequip, the starting kit and stats, equip/unequip through the pipeline (turn cost, swaps, changed blows, the log), an enemy striking while you change armor, 14 refused item actions at no cost, healing potions and rations, seeded enemy loot reaching the inventory, the Pack view model, context Use buttons, and item text (238 tests total). The browser check now drinks the potion from the Pack mid-fight, checks the loot readout and inventory line after the kill, and runs a Pack flow on all four viewports (fits the screen, touch-sized buttons, disabled Drink at full health costs nothing, Take off and Equip take a turn each and change the stats). Its route picker now avoids destinations that a recentre would put under the HUD.

### Task 10: Combat and defeat
- Fights happen on the hex map, one turn at a time, through the same turn pipeline: you act, then every enemy reacts. Nothing happens while you are idle.
- You now have **health** (24), shown under your position as "Health 22/24" with a bar that turns red when low. Your attack is 4 and defense 1.
- Blows are fixed, not rolled: attack − defense, at least 1. **Cover:** whoever stands in forest gets +1 defense, in dense forest +2. A boar's charge hits 2 harder.
- When an enemy is beside you, combat buttons appear above the readout (before any Search or Gather buttons):
  - **Attack wolf ↗ 3**: one per enemy beside you, with the direction and the damage the blow will deal. A struck enemy that was unaware or heading home turns to fight. At 0 health it falls ("The wolf falls"), frees its hex and is gone.
  - **Defend +2**: +2 defense against every blow that turn (shown while something in sight is hunting you).
  - **Flee ←**: step to the safest neighbouring hex (away from every enemy in sight, toward the sanctuary on ties). The enemies you fled from lose that turn.
  - **Use herbs +5** / **Eat food +3**: while hurt; uses one item and one turn.
- **Parting strike:** walking away from an enemy beside you lets it strike as you go ("The wolf strikes as you pull away: 2 damage · health 20/24"). Flee avoids this.
- Enemy blows are real: "The wolf attacks: 2 damage · health 22/24", "(defended)" and "(cover)" when they apply. The readout after a combat action lists the turn's events in order, and every event goes into the turn log.
- No fighting from sanctuary ground (enemies cannot reach you there). Ending a turn on sanctuary ground while hurt restores 2 health.
- **Defeat:** at 0 health you fall ("You fall to the boar · you wake at the sanctuary, wounds tended"). A **Defeated** notice opens; you are back at the sanctuary with full health, and every enemy that was hunting you heads home. What you carried is kept for now: Task 12 decides what a defeat costs and adds the expedition report.
- Every refused combat action costs nothing and says why (too far, no enemy there, nothing hunting you, nowhere to flee, already at full health…). Only valid buttons are shown.
- Boars now have defense 1 (was 2) and skeletons 2 (was 3), so a fight takes 3–5 blows.
- Tests: terrain cover, blow formula, attacking (turn cost, event order, counterattack, a full fight to the enemy's fall, freed hex), refused attacks (too far, empty, unseen, off map, malformed, from the sanctuary) at no cost, Defend (one turn only; against a charge), the parting strike, Flee (no strike, enemy loses its turn, never next to another enemy, refused when not engaged or cornered), consumables (healing, cap, refusals), defeat (to the sanctuary, healed, items kept, hunters return, later enemies do not act, travel interrupted), sanctuary recovery, idle, and text (226 tests total). The browser check now fights: it takes a real blow, checks the health line and the combat buttons (labels, fit, touch size), Defends, Flees, retreats and recovers at the sanctuary, goes back and kills the wolf with the Attack button, then waits beside a boar until defeated and checks the defeat notice, on four viewports, mirroring every turn with a Node game.

### Task 09: Enemies and basic AI
- The wilds now hold three kinds of enemy, placed from the seed (`src/world/enemyPlacement.js`); each map has around 35–45:
  - **wolves** in woods and hills: they notice you from 4 hexes and chase a long way;
  - **boars** in grassland and forest: they hit hardest, charge from 3 hexes along a straight line, and won't leave their ground;
  - **skeletons** beside most ruins: slow (they move every other turn) but persistent.
  No enemy lives within 10 hexes of the sanctuary.
- Enemies act only after you do. Each successful action (a step, Wait, Gather, Search) gives every enemy one turn; nothing moves while you are idle or when an action is refused.
  - An unaware enemy stays home until you come within its detection range.
  - It then hunts you. It moves one hex per turn over walkable ground, around mountains, deep water and other creatures.
  - It attacks only when beside you.
  - It gives up and walks home if you get far enough away, leave a boar's territory, or reach the sanctuary.
  - The sanctuary and the six hexes around it are safe ground that enemies never enter.
- Being noticed or attacked interrupts travel, and the readout says what happened: "A wolf has noticed you · 3 hexes north-east", "The wolf gives up the chase", "The boar turns back to its ground".
- **Combat is not part of this task.** An attack is passed to a combat handoff that Task 10 will fill in. Until then it does nothing, and the readout says so: "The wolf attacks (combat not implemented yet: no damage)".
- Enemies take up their hex: you can't step onto one, routes go around the ones you can see, and a route an enemy steps onto stops with "Route blocked by the wolf at …".
- Enemies are drawn only while in sight:
  - each archetype has its own figure: a grey wolf, a humped brown boar with a pale tusk, a bone-white skeleton;
  - when zoomed out they become coloured tokens (wedge, block, diamond);
  - a red health bar sits above each one;
  - a ring shows its intent: amber while it hunts you, red when it is about to strike or charge, dashed grey while it heads home.
- Tapping an enemy inspects it without taking a turn ("Wolf · health 8/8 · hunting you · Aggressive pursuit: …"). Readouts about a hex with an enemy in sight include it.
- Tests: archetype data, placement (deterministic, in habitat, guards beside ruins, clear of the sanctuary, one per hex, independent of map size, golden fingerprint), detection range, approach and attack only when adjacent, the combat handoff, pathing around walls and waiting when cut off, leash and territory disengagement, returning home, the boar's charge, the skeleton's pace, occupancy, nothing moving while idle or on refused actions, travel interruption, intent, tap and route behaviour, and text (206 tests total). The browser check walks to the nearest enemy, is interrupted when it notices, waits for its attack, inspects it, checks that nothing moves while idle, and retreats to the sanctuary until it gives up. Every turn is compared against a Node game run through the same pipeline, on four viewports. The other flows choose routes that wake no enemy.

### Task 08: Points of interest and discovery journal
- The world now holds five kinds of point of interest, placed from the seed to fit the land (`src/world/poiPlacement.js`):
  - **ruins** on hills, rocky ground and hilltops;
  - **abandoned camps** on grassland or in forest beside water;
  - **chests** tucked into woods, rocks and dunes;
  - **shrines** in forest clearings and on rises;
  - **cave mouths** on rocky ground or hills at the foot of mountains.
  Each map has about 50, spread out (at least 4 hexes apart, 9 for two of the same kind), never on water, a resource node, or within 3 hexes of the sanctuary. Each place has its own name ("Fallen watchtower", "Trapper's camp", "Mossy strongbox", "Wayshrine", "Dark hollow" and others).
- **Discovery:** a place is discovered when it first comes into sight. The readout names it and gives its bearing ("Discovered Broken chapel (ruins) · 4 hexes north-east"), travel stops there (one tap resumes), and the discovery goes into the journal. Places in sight of the start are discovered at once.
- **Interaction:** standing on or next to an undepleted place shows a context button before any Gather buttons: **Search ruins / camp / cave**, **Open chest**, **Read shrine**. Each use is an `interact` action costing one turn:
  - ruins hold 2–3 searches; camps, chests, caves and shrines one;
  - searches and chests yield resources from the place's find table (chests the most); what each use yields is fixed by the seed, not rolled when you open it;
  - a shrine maps the land within 7 hexes of it and discovers any places there.
  The readout reports the outcome ("Opened Mossy strongbox (chest): found 2 herbs, 3 food").
- Used places stay used: each use is a persistent world change, so leaving and coming back finds the camp searched and the chest open. The world-changes save form is now version 2 (version 1 still loads).
- Places are drawn in the upper left of their hex once mapped: broken pillars, a tent, a chest, a carved stele with a pale rune, a dark arch in rock. A gold glint marks one with something left; a used-up one is dim (an opened chest shows its lid up, a read shrine's rune goes dark). Zoomed out and on the Map they are diamonds in their kind's colour. Places you can use right now get a gold ring.
- New **Journal** button (book icon) under the Map button. It opens a dialog listing discoveries and outcomes, newest first, with the day and time of day, and a summary ("3 places discovered · 1 explored"). Tapping an entry closes it and centres the view on that place. Opening it stops travel, like the Map.
- Readouts about a mapped hex with a place name it and its state ("· Broken chapel (ruins) · 2 searches left", "· opened").
- The Gather row is now a general row of context actions (`#context-actions`).
- Cave interiors are not part of this task: a cave mouth is searched once from outside.
- Tests: POI data validation, terrain rules, placement (deterministic; terrain-appropriate; spaced; off nodes; clear of the sanctuary; every kind present over 20 seeds; independent of scan extent; golden fingerprint), seeded finds, discovery (at start, on sight, once only, interrupting travel and resuming), interactions (turn cost, finds, multi-use ruins, shrine reveal, refusals at no cost, staying used after a revisit, save round trips), the journal save form, and text (179 tests total). The browser check now covers the Journal, walking to and searching a camp, its state on revisit, picking a Journal entry, a route interrupted by a discovery, and reading a shrine on seed `shrine-64`, on four viewports. Its readout mirror now includes POI notes, discoveries and day-part changes.

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
