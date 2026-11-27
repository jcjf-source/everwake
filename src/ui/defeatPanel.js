/**
 * The defeat notice: shown when the player falls (systems/combat.js). By the
 * time it opens the game has already carried the player back to the
 * sanctuary, so closing it only acknowledges what happened. Task 12 replaces
 * it with the expedition report.
 */

/**
 * @param {{ dialog: HTMLDialogElement, text: HTMLElement }} el
 *   The dialog's button is a `method="dialog"` submit, so it needs no handler.
 */
export function createDefeatPanel(el) {
  return {
    /** Show `message` (combatText.describeDefeat). */
    show(message) {
      el.text.textContent = message;
      if (!el.dialog.open) el.dialog.showModal();
    },
    get open() {
      return el.dialog.open;
    },
  };
}
