/**
 * Dialogs for saving and loading (Task 13). They hold no game state: main.js
 * passes in what to show and handles every choice.
 *
 *  - confirm:  asks before anything replaces the current world (a new world,
 *              an imported save). Cancel, Escape or the backdrop keep it.
 *              Can offer "Export save first" without closing.
 *  - start:    on loading a page with a saved world: Continue (also Escape),
 *              New world, or Import save.
 *  - recovery: when the saved world cannot be loaded. It cannot be
 *              dismissed: the player chooses to download the damaged save,
 *              try again, import a save or start a new world. Autosave is
 *              off until then, so the damaged save is never overwritten
 *              behind their back.
 */

const openModal = (d) => { if (!d.open) d.showModal(); };
const closeModal = (d) => { if (d.open) d.close(); };

/**
 * @param {{ dialog: HTMLDialogElement, title: HTMLElement, lines: HTMLElement,
 *   confirm: HTMLButtonElement, cancel: HTMLButtonElement, exportFirst: HTMLButtonElement, message: HTMLElement }} el
 * @param {{ onExport: () => string }} handlers `onExport` downloads the save and returns what to show.
 */
export function createConfirmPanel(el, handlers) {
  let settle = null;
  const finish = (answer) => {
    const s = settle;
    settle = null;
    closeModal(el.dialog);
    if (s) s(answer);
  };
  el.confirm.addEventListener('click', () => finish(true));
  el.cancel.addEventListener('click', () => finish(false));
  el.exportFirst.addEventListener('click', () => { el.message.textContent = handlers.onExport(); });
  el.dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
  el.dialog.addEventListener('click', (e) => { if (e.target === el.dialog) finish(false); });

  return {
    /**
     * Ask; resolves true only if the player confirms.
     * @param {{ title: string, lines: string[], confirm: string, cancel: string }} text
     * @param {{ offerExport?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    ask(text, { offerExport = false } = {}) {
      if (settle) finish(false);
      el.title.textContent = text.title;
      el.lines.replaceChildren(...text.lines.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }));
      el.confirm.textContent = text.confirm;
      el.cancel.textContent = text.cancel;
      el.exportFirst.hidden = !offerExport;
      el.message.textContent = '';
      openModal(el.dialog);
      el.cancel.focus(); // the safe choice has focus
      return new Promise((resolve) => { settle = resolve; });
    },
    get open() { return el.dialog.open; },
  };
}

/**
 * @param {{ dialog: HTMLDialogElement, summary: HTMLElement, detail: HTMLElement, link: HTMLElement,
 *   message: HTMLElement, cont: HTMLButtonElement, newWorld: HTMLButtonElement, importSave: HTMLButtonElement }} el
 * @param {{ onContinue: () => void, onNewWorld: () => void, onImport: (show: (text: string) => void) => void }} handlers
 */
export function createStartPanel(el, handlers) {
  const show = (text) => { el.message.textContent = text; };
  el.cont.addEventListener('click', () => { closeModal(el.dialog); handlers.onContinue(); });
  el.dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(el.dialog); handlers.onContinue(); });
  el.newWorld.addEventListener('click', () => { closeModal(el.dialog); handlers.onNewWorld(); });
  el.importSave.addEventListener('click', () => handlers.onImport(show));
  return {
    /** @param {{ summary: string, detail: string, link: string }} text */
    show(text) {
      el.summary.textContent = text.summary;
      el.detail.textContent = text.detail;
      el.link.textContent = text.link;
      el.link.hidden = !text.link;
      el.message.textContent = '';
      openModal(el.dialog);
      el.cont.focus();
    },
    close() { closeModal(el.dialog); },
    get open() { return el.dialog.open; },
  };
}

/**
 * @param {{ dialog: HTMLDialogElement, reason: HTMLElement, message: HTMLElement,
 *   download: HTMLButtonElement, retry: HTMLButtonElement, importSave: HTMLButtonElement, newWorld: HTMLButtonElement }} el
 * @param {{ onDownload: () => string, onRetry: () => void, onImport: (show: (text: string) => void) => void, onNewWorld: () => void }} handlers
 */
export function createRecoveryPanel(el, handlers) {
  const show = (text) => { el.message.textContent = text; };
  let holding = false;
  el.dialog.addEventListener('cancel', (e) => e.preventDefault());
  // Chrome lets Escape close a dialog opened without a user gesture (as this
  // one is, on page load) even though `cancel` is prevented: reopen it.
  el.dialog.addEventListener('close', () => { if (holding) el.dialog.showModal(); });
  el.download.addEventListener('click', () => show(handlers.onDownload()));
  el.retry.addEventListener('click', () => handlers.onRetry());
  el.importSave.addEventListener('click', () => handlers.onImport(show));
  el.newWorld.addEventListener('click', () => handlers.onNewWorld());
  return {
    /** @param {string} reason */
    show(reason) {
      el.reason.textContent = reason;
      el.message.textContent = '';
      holding = true;
      openModal(el.dialog);
      el.download.focus();
    },
    showMessage: show,
    close() { holding = false; closeModal(el.dialog); },
    get open() { return el.dialog.open; },
  };
}
