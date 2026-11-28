# Task G07 — Battle rules

## Objective
Write the battle-scene rules as a pure, seeded, tested module, without connecting them to the world or adding UI. See `EXPEDITION_DECK.md` §5.2–5.3.

## Scope
- `src/data/battleCards.js`: battle cards and the gear that gives them. Gear stays defined in `src/data/items.js`, but each gear item gets a `battleCards` list:
  - Hunting knife: Slash ×3, Lunge (step 1, then strike)
  - Padded jerkin: Brace ×2 (block), Sidestep (move 1, then block 1)
  - Short sword and ring mail: give them comparable cards (decide and document)
  - Leave spear cards (Thrust reach 2, Set Against Charge) out until spears exist as items.
- `src/systems/battle.js`:
  - `createBattle({ seedNumber, arena, player, enemies, origin })`: the arena is a **radius-3 hex** area (README, decision 11). Copy its terrain from the world hexes: woods give cover, and water and mountains block movement. Starting positions come from where everyone stood on the map, clamped into the arena.
  - Each turn: draw 3 cards from the battle deck. The player plays **one** card or one **basic action**: Strike (weak attack), Step (move 1), Use item, or Flee (only from an arena edge hex, README decision 3). Then each enemy carries out the **intent** it showed, and shows a new one.
  - **Intents:** attack, charge, defend or move. They come from simple per-type rules that match the world AI (boars charge in a line from range, skeletons are slow, wolves close in). Make them deterministic from state plus a seed.
  - **Damage:** reuse the existing formula `max(1, attack + bonus − (defense + cover + block))` and `playerStats`. Health is the player's real health.
  - **Outcome:** `won` (every enemy at 0), `fled` or `defeated` (player at 0). Return loot rolls with the existing `rollLoot`.
  - Versioned `serialize`/`restoreBattle` with validation.

## Out of scope
Rendering, the world trigger, the defeat flow, removing the Task 10 combat code (all in G08).

## Acceptance
Unit tests cover: a deterministic battle from a fixed seed; each card and basic action; each enemy intent being carried out as shown; cover and blocking; fleeing allowed only from the edge; win, flee and defeat outcomes; and the save round trip with its refusals and a fuzz pass. Basic actions are always available, so a hand of three bad cards still has a sensible play. The game and browser check are unchanged.
