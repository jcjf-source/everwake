/**
 * The Journal dialog: every place discovered and what came of it, newest
 * first. Tapping an entry closes the dialog and hands its hex to `onPick`
 * (main.js centres the view on it). Text comes from poiText.js.
 */
import { journalText, journalWhen, describeJournalSummary } from './poiText.js';

/**
 * @param {{ button: HTMLButtonElement, dialog: HTMLDialogElement, list: HTMLOListElement, summary: HTMLElement }} el
 *   The dialog's Close button is a `method="dialog"` submit, so it needs no handler.
 * @param {{
 *   entries: () => ReadonlyArray<{ turn: number, type: string, at: {q:number,r:number} }>,
 *   onPick: (h: {q:number,r:number}) => void,
 *   onOpen?: () => void,
 * }} handlers `onOpen` runs before the dialog shows (main.js stops travel there).
 */
export function createJournalPanel(el, handlers) {
  /** Entries as last rendered (newest first), so a click maps to its hex. */
  let shown = [];

  function render() {
    const entries = handlers.entries();
    el.summary.textContent = describeJournalSummary(entries);
    shown = [...entries].reverse();
    el.list.replaceChildren(...shown.map((e, i) => {
      const li = document.createElement('li');
      li.className = 'journal-list__item';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'journal-entry';
      btn.dataset.index = String(i);
      btn.dataset.kind = e.type;
      const when = document.createElement('span');
      when.className = 'journal-entry__when';
      when.textContent = journalWhen(e.turn);
      const what = document.createElement('span');
      what.className = 'journal-entry__text';
      what.textContent = journalText(e);
      btn.append(when, what);
      li.append(btn);
      return li;
    }));
    el.list.hidden = shown.length === 0;
  }

  function open() {
    handlers.onOpen?.();
    render();
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
  }

  function close() {
    if (typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  el.button.addEventListener('click', open);
  // Tapping the backdrop (outside the form) closes the dialog.
  el.dialog.addEventListener('click', (e) => {
    if (e.target === el.dialog) close();
  });
  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    const entry = btn && shown[Number(btn.dataset.index)];
    if (!entry) return;
    close();
    handlers.onPick({ q: entry.at.q, r: entry.at.r });
  });

  return {
    get isOpen() { return el.dialog.open; },
    /** Re-render if open. */
    refresh() {
      if (el.dialog.open) render();
    },
  };
}
