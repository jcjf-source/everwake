# Task G05 — Nightfall, camp and the nightly tick

## Objective
End each day when the hand runs out, make the player camp, and make every night harder. See `EXPEDITION_DECK.md` §4 (except the threat effects and ambushes, which are in G09).

## Scope
- **Nightfall rule** (`src/systems/night.js`, pure): night falls when the pool can't pay for the cheapest available action (the cheapest neighbouring step, or a Gather or Interact in reach) **and** the hand has no playable card. On sanctuary ground, night never forces itself, because actions there are free. Test the rule on its own.
- **`camp` action:** allowed at any time on an expedition; forced at nightfall. It costs one turn and no stride. It opens the **camp screen** before you confirm: where you're camping (forest, open ground, next to ruins or caves), what will happen tonight (supper, food left, Weary count after tonight) and the Rest option. Show the ambush chance as "—" until G09.
- **Nightly tick**, in order, as one pure function with events:
  1. **Supper:** eat 1 food (README, decision 9). If you have none, lose 2 health and become **Hungry**: one card fewer at the next dawn. Hunger can cause a defeat, and that uses the existing defeat flow.
  2. **Weariness:** add one Weary card to the deck (shuffled into the draw pile).
  3. **Threat:** add 1 to `game.expedition.threat`. Nothing reads it until G09.
  4. **Ambush roll:** leave a no-op placeholder for G09.
  5. **Dawn:** discard the hand, lose any unspent stride and active effects, and draw a new hand (5, −1 if Hungry, −1 after Rest).
- **Rest:** an option on the camp screen. It costs 2 food and draws one card fewer at the next dawn, and removes one Weary card. Refuse it if you don't have the food.
- **Dawn report:** a short dialog or readout, for example "Night 3. You grow wearier (2 Weary)." Add the threat line in G09.
- **Recovery:** on a return to the sanctuary, remove all Weary cards and reset threat and night count to 0. The next expedition starts with the restored starting deck.
- **Day clock** (`src/core/clock.js`, `clockText`): the day number comes from the expedition's nights, and the day part from the share of today's hand played (§4.5). Keep `turn` as the internal counter. Update the report's "time" stat so it means days and nights.
- Save the night count, the Hungry flag, threat and the deck state, and check them in `restoreGame`.

## Out of scope
Threat effects, ambushes, the ambush chance, battle.

## Acceptance
Tests show: night falls exactly when nothing is affordable; camping early works; supper eats food in the right order; hunger costs health and a card; each night adds a Weary card; Rest removes one and costs food and a card; and returning home clears everything. The camp screen and dawn report work on desktop and phone sizes, with keyboard and touch. A reload at camp or mid-day resumes correctly. The browser check covers a full day → camp → dawn cycle.
