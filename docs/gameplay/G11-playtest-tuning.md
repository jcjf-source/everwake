# Task G11 — Playtest and tuning pass

## Objective
Check that the loop gives the intended "turn back or push on" tension, and tune the numbers in `deckTuning` and the threat table. See `EXPEDITION_DECK.md` §7 and §9.4.

## Scope
- **Simulation script** (`tools/sim/expeditions.mjs`, Node, no browser): plays seeded expeditions with simple strategies: cautious (turns back when the Home estimate is above 60% of the expected next hand), greedy (turns back at 90%) and frontier-rusher. Run it across about 50 seeds. Report the median nights survived, hexes mapped, new hexes per day, the defeat rate and its causes (battle or hunger), and insight per expedition.
- **Targets** (adjust if playtests suggest better ones):
  - day 1 from home covers most of the known ground near the sanctuary;
  - by night 3 or 4, a hand gives about half the stride of day 1;
  - a cautious player is rarely defeated; a greedy one sometimes is;
  - card finds make about 1 day in 4 noticeably longer at the frontier.
- **Tune only values** (stride per card, hand size, action costs, find chance, ambush odds, threat steps, hunger penalty). Don't change rules in this task. If a rule needs to change, write it up as a proposal.
- **Manual playtest:** at least three full expeditions in the browser on desktop and portrait phone sizes (landscape phone is left to Task 14, README decision 13). Write down where it felt good and where it felt bad.
- Record the final values and the reasons for them in `docs/TECHNICAL.md`. Answer or close each open question in `EXPEDITION_DECK.md` §9 and change its status to **Built**.

## Acceptance
The sim script runs from one npm command and gives repeatable output. The chosen values meet the targets, or the report explains why not. Notes from the manual playtests are recorded. Tests and the browser check pass with the final values.
