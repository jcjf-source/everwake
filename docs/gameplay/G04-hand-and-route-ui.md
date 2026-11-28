# Task G04 — Hand bar and route preview

## Objective
Show the hand, the stride pool and the deck at all times, let the player choose which card to play, and show route costs in stride and cards. See `EXPEDITION_DECK.md` §1 ("always shown") and §2.2.

## Scope
- **Hand bar** (DOM, `src/ui/handBar.js`): one button per card in hand, showing name, stride and effect. Weary cards appear but are disabled. Next to it: the stride pool (with any active effect, such as "Climb: 4"), deck count and discard count. Every card is a `playCard` action through the pipeline.
- **Route readout:** "Ruin: 9 stride, about 2 cards (you have 3 stride + 4 cards)". "About N cards" counts the playable cards in hand, largest stride first, needed to cover the shortfall. If even the whole hand can't cover it, say so ("not today: 9 stride short").
- **Home estimate:** always visible (in the hand bar or the status block). It shows the stride needed to reach the sanctuary along the cheapest route over known ground.
- **Short on stride while travelling:** when travel stops with `needStride`, show a prompt with the suggested card (the smallest playable card that covers the next step, or else the largest). One tap plays it and resumes. The player can also tap a different card. This is the proposal's "the game can do it for you, but you choose the card".
- Mobile layout: the hand bar has to fit the four browser-check viewports, including 844×390, without covering the map's focus or the context row. Touch targets must be comfortable. Panel taps must not reach the map (`pointerInput`).
- Accessible names on the cards ("Walk, 6 stride"), and keyboard focus.

## Out of scope
The camp screen and dawn report (G05), battle UI.

## Acceptance
The hand, pool and counts always match game state. Previews show the correct stride and card estimate, which tests check for known ground, new ground and mixed routes. The Home estimate updates after every step. The short-on-stride prompt plays the chosen card and travel resumes. Manual checks at desktop and phone sizes are written down. The browser check is updated and passes.
