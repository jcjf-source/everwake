/**
 * World seed and save controls: the seed button in the top bar and the
 * dialog for viewing the current seed, creating a new world from a typed or
 * random seed, and exporting or importing the save (Task 13).
 *
 * Creating is never a single tap: "Replace world" here hands the seed to
 * main.js, which asks for confirmation (ui/savePanels.js) before anything
 * is replaced. The panel itself holds no game state.
 */
import { normalizeSeed, randomSeed, MAX_SEED_LENGTH } from '../world/seed.js';

/**
 * @param {{
 *   button: HTMLButtonElement, buttonText: HTMLElement,
 *   dialog: HTMLDialogElement, form: HTMLFormElement, current: HTMLElement,
 *   input: HTMLInputElement, error: HTMLElement,
 *   random: HTMLButtonElement, cancel: HTMLButtonElement,
 *   saveStatus: HTMLElement, saveMessage: HTMLElement,
 *   exportSave: HTMLButtonElement, importSave: HTMLButtonElement,
 * }} el
 * @param {{
 *   onCreate: (seed: string) => void,
 *   onExport: () => string,
 *   onImport: (show: (text: string) => void) => void,
 * }} handlers `onExport` downloads the save and returns what to show;
 *   `onImport` picks a file and reports through `show`.
 */
export function createWorldPanel(el, handlers) {
  let currentSeed = '';
  el.input.maxLength = MAX_SEED_LENGTH;
  const showMessage = (text) => { el.saveMessage.textContent = text; };

  /** Open the dialog, with `seed` (or a random one) ready to create. */
  function open(seed = null) {
    el.current.textContent = currentSeed;
    el.input.value = seed ?? randomSeed();
    el.error.textContent = '';
    el.saveMessage.textContent = '';
    el.input.removeAttribute('aria-invalid');
    if (typeof el.dialog.showModal === 'function') { if (!el.dialog.open) el.dialog.showModal(); } else el.dialog.setAttribute('open', '');
    el.input.focus();
    el.input.select();
  }

  function close() {
    if (typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  el.button.addEventListener('click', () => open());
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
  el.exportSave.addEventListener('click', () => showMessage(handlers.onExport()));
  el.importSave.addEventListener('click', () => handlers.onImport(showMessage));
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
    open,
    close,
    showSeed(seed) {
      currentSeed = seed;
      el.buttonText.textContent = seed;
      el.button.title = `World seed: ${seed}. View it, create a new world, or export and import your save.`;
      el.current.textContent = seed;
    },
    /** The save status line (ui/saveText.js describeSaveStatus). */
    showSaveStatus(text) { el.saveStatus.textContent = text; },
  };
}
