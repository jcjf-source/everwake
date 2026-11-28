/**
 * Stride for tests of other systems (G03). Moving, gathering and searching
 * cost stride from the movement deck's pool; tests about something else give
 * the player plenty, so stride never gets in their way. Stride tests
 * (tests/stride.test.js) start from the real, empty pool instead.
 */

/** More stride than any test spends. */
export const PLENTY = 5000;

/** Add `n` plain stride (no card effect) to the game's pool. Returns the game. */
export function giveStride(game, n = PLENTY) {
  game.deck.addStride(n);
  return game;
}
