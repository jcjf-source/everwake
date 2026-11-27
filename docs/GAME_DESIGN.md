# EVERWAKE — Game Design Document

**Working title:** EVERWAKE  
**Genre:** Turn-based, hex-grid exploration roguelite  
**Platform:** Browser (desktop and mobile), static hosting compatible with GitHub Pages  
**Status:** Prototype design; details may evolve

## Vision
Everwake is an exploration game set in a vast world that exists independently of the player. The player begins relatively weak at a sanctuary and ventures into wilderness to map, discover, gather, and take risks. Expeditions may end in retreat or death; permanent knowledge and selected progression make the next expedition more capable. The world does not reset on death.

**Design pillars**
1. Curiosity is the primary motivation: the horizon should invite exploration.
2. A coherent world: geography, biomes, ruins, settlements, and encounters should make sense together.
3. Turn-based and deliberate: no real-time pressure while idle; meaningful actions advance the world.
4. Risk and return: the player decides how far to push before heading home.
5. Persistent discovery: maps, knowledge, and world changes survive expeditions.
6. Accessible interaction: tap/click hexes; no WASD required.

**Core loop:** Explore → discover → gather / encounter → decide whether to push on → return or die → retain knowledge / progress → embark again.

## World
- A single seeded world persists across expeditions. The same seed and coordinates produce stable terrain.
- The long-term design is chunk-based and expandable in every direction; prototype scope may use a bounded region if the architecture permits later expansion.
- Generate terrain in coherent layers: elevation and water flow; temperature/moisture; biome; terrain and vegetation; roads and landmarks; structures; creatures and events.
- Initial terrain: grassland, forest, dense forest, water, shallow water, hills, mountains, sand, rocky ground, roads, ruins.
- Points of interest should fit their surroundings. Ruins may be near old roads or defensible terrain; caves in rocky/mountainous regions; settlements near water and fertile land.
- World seed is displayed and retained. New-world creation must confirm before replacing an existing world.

## Hex movement and map
- Use axial hex coordinates `(q, r)` and six neighbors.
- Tap/click a neighboring tile to move one step. Tap a farther reachable tile to request a path; pathfinding moves one hex per turn, never teleports.
- Use hex-aware A* pathfinding. Cancel/re-target paths with another click.
- Movement stops or pauses when interrupted by an encounter, obstruction, or meaningful event.
- Camera follows player, supports pan and zoom. Tile selection must remain accurate at every zoom.
- Fog has three states: unknown, remembered, currently visible. Previously seen areas remain dimly mapped.
- Initial visibility is a simple hex radius; later modifiers may include terrain, elevation, weather, time, skills, and equipment.

## Turn-based rules
- No real-time simulation while idle.
- A player action resolves first, then advances turn/time and allows relevant enemies/environment to react.
- Typical actions cost one turn: move one hex, attack, gather, search, interact, use item. Rest/craft may take multiple turns.
- Path movement consumes a turn for each hex.
- Time-of-day advances by actions and may eventually affect visibility, NPC routines, weather, and events. Prototype can use a simple day-part clock.

## Player and expedition
- Player has health, stamina (optional in earliest prototype), attack, defense, carry capacity, inventory, equipment, discoveries, and permanent upgrades.
- Starts at sanctuary with modest supplies and basic gear.
- Expedition summary records distance, tiles discovered, resources, enemies defeated, locations, elapsed game time, and cause of death/return.
- Returning voluntarily should preserve carried items. Death ends the expedition and drops/loses carried expedition loot according to prototype rules, but must not erase the world or permanent knowledge.

## Combat
- Tactical turn-based combat on the hex map. Player actions: attack, defend, item, flee.
- Position and terrain can matter (cover, choke points, obstacles) as systems mature.
- Initial enemy archetypes: wolf (aggressive pursuit), boar (charge/high damage), skeleton (slow, persistent, ruin-associated).
- AI should be understandable and deterministic enough to debug: detect, approach, attack when adjacent, disengage when target leaves range.
- Combat should be interruptible and readable, not animation-heavy.

## Gathering, objects, and locations
- Initial resources: wood, stone, herbs, food. Nodes are terrain-appropriate, gatherable, and can deplete.
- Initial POIs: ruins, abandoned camp, cave, chest, shrine. Interaction should cost turns and produce real state changes.
- Prototype cave can be a small separate map with an exit, enemy, and reward; defer if scope threatens core stability.
- Discoveries and lore can be recorded in a journal.

## Inventory and equipment
- Basic item list, quantities, use/equip actions. No drag-and-drop requirement initially.
- Consumables include healing potion and food. Starter weapon and armor are simple.
- Carry capacity can be implemented simply or deferred, but displayed values must be functional.

## Death and permanent progression
- At zero health, show expedition report and return player to sanctuary.
- Lose carried expedition loot/resources according to clear rules; retain world seed, map knowledge, discoveries, permanent upgrades, and persistent world changes.
- Award progression currency based on exploration/discovery, not only kills.
- Initial upgrades: Pathfinder (movement/exploration efficiency), Survivor (maximum health), Cartographer (starting visibility/map knowledge), Scavenger (gathering efficiency). At least three should function in the first progression implementation.
- Progression should unlock capabilities rather than hard-gate the world. Dangerous areas may be attempted early.

## Sanctuary
- A safe starting point and return destination. Initial prototype can be a simple camp screen/location.
- Future facilities: map room, library/bestiary, healer, smith, storage, merchants, other explorers.
- Sanctuary upgrades are persistent and provide long-term goals.

## Interface and visual direction
- Atmospheric, quiet, mysterious, natural, slightly melancholic. Avoid bright generic MMO fantasy.
- Muted greens, moss, slate, earthy browns, desaturated blues, parchment, restrained gold accents.
- World view is the primary focus; hex borders subtle, terrain varied, layered vegetation/objects/entities/fog.
- Canvas renders world; HTML/CSS handles panels and accessible controls.
- UI: health/status, time/day, seed, contextual actions, inventory, map, character, journal, event log.
- Desktop and mobile responsive. Touch targets usable. No emoji as primary world art.
- Use procedural canvas/vector artwork if no art assets; keep style consistent.

## Prototype definition of done
A player can open the browser game, start or continue a seeded world, move by tapping/clicking hexes, explore generated terrain with fog of war, gather resources, find a point of interest, encounter and fight an enemy, die or return, receive permanent progress, and start another expedition in the same world. Saving survives browser closure. Every visible control works. No core mechanic is merely a placeholder.

## Deferred scope
Do not attempt full infinite world, complex NPC simulation, deep crafting, large quest chains, extensive lore, multiplayer, backend, elaborate animations, or hundreds of item/enemy types in the initial prototype. Add these only after the core loop is fun and stable.
