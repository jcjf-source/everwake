/**
 * World seed controls: the seed button in the top bar and the dialog for
 * viewing the current seed and creating a new world from a typed or random
 * seed. Creating is a deliberate second step ("Replace world") inside the
 * dialog, so a world is never replaced by a single stray tap.
 */
import { normalizeSeed, randomSeed, MAX_SEED_LENGTH } from '../world/seed.js';

/**
 * @param {{
 *   button: HTMLButtonElement, buttonText: HTMLElement,
 *   dialog: HTMLDialogElement, form: HTMLFormElement, current: HTMLElement,
 *   input: HTMLInputElement, error: HTMLElement,
 *   random: HTMLButtonElement, cancel: HTMLButtonElement,
 * }} el
 * @param {{ onCreate: (seed: string) => void }} handlers
 */
export function createWorldPanel(el, handlers) {
  let currentSeed = '';
  el.input.maxLength = MAX_SEED_LENGTH;

  function open() {
    el.current.textContent = currentSeed;
    el.input.value = randomSeed();
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
    el.input.focus();
    el.input.select();
  }

  function close() {
    if (typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  el.button.addEventListener('click', open);
  el.cancel.addEventListener('click', close);
  el.random.addEventListener('click', () => {
    el.input.value = randomSeed();
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
    el.input.focus();
  });
  el.input.addEventListener('input', () => {
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
  });
  // Tapping the backdrop (outside the form) closes the dialog.
  el.dialog.addEventListener('click', (e) => {
    if (e.target === el.dialog) close();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = normalizeSeed(el.input.value);
    if (!result.ok) {
      el.error.textContent = result.error;
      el.input.setAttribute('aria-invalid', 'true');
      el.input.focus();
      return;
    }
    close();
    handlers.onCreate(result.seed);
  });

  return {
    showSeed(seed) {
      currentSeed = seed;
      el.buttonText.textContent = seed;
      el.button.title = `World seed: ${seed}. View it or create a new world.`;
    },
  };
}
