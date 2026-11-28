# Expedition Deck — Design Proposal

**Status:** Draft for review. Nothing here is built yet.
**Replaces:** the turn clock as the cost of actions, and the on-map combat from Task 10.
**Keeps:** the persistent world, fog of war, health, inventory and gear, POIs, the sanctuary, insight and upgrades.

## Summary
Moving, gathering and searching are paid for with **movement cards**. Each dawn you draw a hand of them. When you can no longer pay for an action, the day is over and you must **make camp**. **Every night the expedition gets harder**: you grow wearier and the wild grows more dangerous. Ground you have walked before is cheap to cross, so your map is your advantage and the frontier is where you pay.

Combat moves to **separate battle scenes**, which use their own deck built from your gear. Fighting doesn't spend movement cards. You pay for it in health, and sometimes you can't avoid it.

The aim is to give "risk and return" a clear, visible clock. Days at the frontier get shorter and riskier, and the player decides when to turn back.

---

## 1. The movement deck

### Cards and stride
- Each movement card gives **stride** (movement points) when you play it.
- Stride goes into a pool for the day. Actions take stride from the pool.
- Leftover stride carries over until nightfall, so you never waste part of a card. At night, unspent stride is lost.
- You play a card when you need more stride. The game can do this for you when you commit to a route, but you choose which card to play.

### Starting deck (tuning values to be tested)
| Card | Stride | Notes | Starting deck |
|---|---|---|---|
| **Walk** | 6 | the standard card | 8 |
| **Trek** | 10 | a long day's stretch | 2 |
| **Climb** | 6 | hills and rocky ground cost half while this stride lasts | 1 |
| **Forage** | 3 | also gives one free Gather | 1 |

Cards found or earned (see §3):
| Card | Effect |
|---|---|
| **Wade** | 4 stride, and lets you cross shallow water at normal cost |
| **Second Wind** | 4 stride, and draw another card |
| **Scout** | 2 stride, and +2 sight until nightfall |

### The daily hand
- **At dawn, draw 5 cards** from the movement deck.
- Played cards go to a discard pile. When the deck is empty, the discard pile is shuffled back in. The deck is a cycle, not a countdown.
- All shuffles and draws are **seeded** (world seed + expedition + day), so saves, tests and replays are deterministic.
- The hand, the stride pool and how many cards are left in the deck are always shown.

---

## 2. What costs stride

| Action | Cost |
|---|---|
| Step onto a hex | see §2.1 |
| Gather (one use) | 3 |
| Search / Open / Read a POI (one use) | 3 |
| Make camp early | free (ends the day) |
| Look, plan routes, open the map, journal or pack | free |
| Eat / drink (heal) | **open question**: free or 1 |
| Equip / unequip | free outside battle |
| Battle | free (paid for in health, see §5) |

On sanctuary ground, moving and actions are free.

### 2.1 Known ground is cheaper
Terrain keeps its current move cost (1–3). How much stride a step takes depends on whether you have walked that hex before:

| Hex | Stride cost | Example: grass (1) / forest (2) / dense forest (3) |
|---|---|---|
| **New ground**: never walked | terrain cost × 2 | 2 / 4 / 6 |
| **Known ground**: walked before, on any expedition | terrain cost | 1 / 2 / 3 |

- "Walked" is a new piece of permanent map memory, stored alongside the seen/remembered fog state. Seeing a hex isn't enough. You have to have stood on it.
- Over many expeditions, the land near the sanctuary becomes cheap to cross, and the expensive frontier moves outward. This is the sense of progress we want from mapping.
- The walk home usually crosses known ground, so getting home stays possible but isn't free.

### 2.2 Route preview
The route readout shows **stride needed** and **cards needed**, for example: "Ruin: 9 stride, about 2 cards (you have 3 stride + 4 cards)."
A **Home** estimate is always available: the stride needed to reach the sanctuary along the cheapest known route.

---

## 3. Finding movement cards
- The first time you step onto a hex (ever, not just this expedition), there is a **chance to find a card**. Walking the same hex again gives nothing, so finds can't be farmed.
- The roll is seeded, so the same hex in the same world always gives the same result.
- **The terrain decides the card**:
  - riverbanks and shallow water: Wade
  - hills and rocky ground: Climb
  - grassland: Walk or Second Wind
  - beside ruins: Scout
- A found card goes into the **discard pile**, so it arrives on a later day rather than immediately.
- Found cards last **for this expedition only**. They are expedition loot and follow the same rules as your pack on death or return.
- Starting tuning: about a 12% chance per new hex.

Chests, ruins and shrines can also give movement cards, as rarer and better rewards than the terrain finds.

---

## 4. Night, camp and the nightly tick

### 4.1 Nightfall
- **Night falls when your stride pool plus your hand can't pay for any action** (the cheapest step or a Gather). You can also choose to camp early.
- You camp **on the hex where you stand**. The camp screen shows what the night will bring before you confirm.

### 4.2 Where you camp matters
| Camp site | Night ambush chance |
|---|---|
| Sanctuary ground | none, and you can end the expedition here |
| Forest / dense forest | low (cover) |
| Open ground | normal |
| Next to ruins or caves | high |

The base chance rises with the threat level (§4.3).

### 4.3 The nightly tick
Each night, in order:
1. **Supper.** You eat 1 food from your pack. With no food you lose 2 health and are **Hungry**: you draw one card fewer next dawn.
2. **Weariness.** One **Weary** card is added to the movement deck. It gives no stride, takes up a slot in your hand, and can't be played. Your days get shorter.
3. **The wild wakes.** The **threat level** goes up by 1 (see the table below).
4. **Ambush roll.** Based on where you camped and the threat level. If an enemy finds you, a battle starts that you can't avoid (§5).
5. **Dawn.** Discard what's left of your hand, draw a new hand, start the next day.

A **dawn report** sums up the night: "Night 3. You grow wearier (2 Weary). Wolves now hunt in packs."

### Threat levels (draft)
| Threat | Effect |
|---|---|
| 0 (start) | the world as it is now |
| 1 | enemies notice you from 1 hex further away |
| 2 | more enemies roam: extra spawns appear beyond your sight |
| 3 | wolves travel in pairs, and boars charge from 1 hex further |
| 4 | skeletons leave the ruins and roam at night |
| 5+ | each further level gives enemies +1 damage |

### 4.4 Recovery
- **Back at the sanctuary**, all Weary cards are removed, threat drops to 0, found cards are kept or lost according to how the expedition ended, and the starting deck is restored.
- **In the field**, a *Rest* action at camp (cost: 2 food, and the next day starts with one card fewer) removes one Weary card. This gives food a second use and lets a well-stocked player stay out longer.
- Threat level **resets with every expedition**. Nothing escalates across expeditions for now.

### 4.5 The day clock
The four day-parts (morning, afternoon, evening, night) now follow the day's hand, not a fixed number of turns. The clock shows how much of today's hand has been played. Enemies still act after each of your actions, as they do now.

---

## 5. Battle scenes

### 5.1 Starting a battle
- On the world map, enemies are visible and still hunt you as they do now. If an enemy reaches a hex next to you, or catches you at camp, a **battle scene** starts.
- You can **avoid** battles by watching enemies and routing around them, which costs stride. Once a battle has started, it can't be skipped.
- Fighting costs **no movement cards and no stride**. You pay in **health**, and possibly in consumables.

### 5.2 The scene
- A **small hex arena** (about 7×7) built from the world hexes around the place where the battle started. Woods give cover, water and mountains block movement. This reuses the existing hex grid and terrain code.
- You and the enemies start at positions based on where you stood on the map.
- Each enemy shows its **intent** for the next turn: attack, charge, defend or move.

### 5.3 The battle deck
- This is a separate deck, **built from your equipped gear**, and only exists during a battle.
  - Hunting knife: Slash ×3, Lunge (step and strike)
  - Padded jerkin: Brace ×2, Sidestep
  - Better gear found later adds or replaces cards, for example a spear adds Thrust (reach 2) and Set Against Charge.
- **Draw 3 cards** at the start of each battle turn. **Play one card per turn**, then the enemies act on the intents they showed.
- **These basic actions are always available**, whatever you draw:
  - **Strike**: a weak attack
  - **Step**: move 1 hex
  - **Use item**: a consumable from your pack
  - **Flee**: only from the arena edge (see the open questions)

  They mean a bad draw is never a death sentence.
- Health, damage and defense work as they do now. At 0 health you are defeated, with the same rules for losing your pack.

### 5.4 After a battle
You go back to the world hex where the battle started. Defeated enemies drop loot as they do now. The battle took no stride, but any time spent fleeing or healing may have.

---

## 6. Progression links
| Upgrade | Current effect | Proposed effect |
|---|---|---|
| **Survivor** | +max health | unchanged |
| **Pathfinder** | stealth | **+1 stride on every Walk and Trek**, and keeps the stealth bonus |
| **Cartographer** | +sight | unchanged, and the first card found each expedition is a Scout |
| **Scavenger** | +gather yield | unchanged, and Gather costs 2 stride instead of 3 |
| *(new)* **Endurance** | — | +1 hand size at dawn |

Movement cards from ruins and shrines could later become permanent unlocks added to the starting deck. That fits the "persistent knowledge" pillar, but it's out of scope for the first version.

---

## 7. An expedition, step by step
1. **Day 1:** leave over known ground near home. A hand of 5 cards (about 30 stride) covers a lot of it.
2. **Day 2:** reach the frontier. New hexes cost double, but they also give finds, such as a Wade card by a river.
3. **Day 3:** 2 Weary cards in the deck, threat 2. Search a ruin, and get ambushed while camping next to it.
4. **Day 4:** the hand is half Weary cards, and the Home estimate says 1.5 days. Turn back, or risk one more day.

---

## 8. Effect on existing systems
| System | Change |
|---|---|
| **Turn system / clock** (Tasks 06, 13) | turns stay as the internal step for enemy reactions; day-parts follow the hand; save adds deck, hand, discard, stride, night count, threat |
| **Movement / travel** (Task 04) | stride costs per step; the route preview shows stride and cards; travel stops when stride runs out |
| **Map memory** (Task 05) | new permanent "walked" set |
| **Gathering / POIs** (Tasks 07, 08) | cost stride instead of a turn |
| **Enemies** (Task 09) | threat-level modifiers; night ambush spawns; reaching you starts a battle, not on-map combat |
| **Combat** (Task 10) | replaced by battle scenes and the gear battle deck |
| **Items** (Task 11) | gear defines battle cards; food is used at camp |
| **Death / progression** (Task 12) | found cards count as expedition loot; upgrade effects change; the expedition report adds nights survived |
| **UI** (Task 14) | hand bar, stride pool, camp screen, dawn report, battle scene |

---

## 9. Open questions
1. **Healing outside battle:** is eating or drinking free, or does it cost 1 stride?
2. **Fleeing a battle:** free from the arena edge, a chance roll, or does it cost stride (you run, and pay for it in the world)?
3. **Running out of food:** is the Hungry penalty above harsh enough, or too harsh?
4. **Hand size and stride values:** the numbers above are first guesses and need playtesting. As written, a fresh hand gives about 30 stride: about 30 hexes of known grassland, or about 8 hexes of new forest.
5. **Movement card finds:** expedition-only (proposed), or do some become permanent?
6. **Threat after the expedition:** reset on every return (proposed), or should the world slowly escalate over many expeditions?
7. **Battle deck size:** gear only (proposed), or can you also collect battle cards from loot?
