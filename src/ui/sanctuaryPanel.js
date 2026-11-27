/**
 * The sanctuary screen (Task 12): opens when an expedition ends, by return
 * or defeat. It shows the expedition report, the insight balance and the
 * upgrades to learn with it, and the Set out button that starts the next
 * expedition. It replaces the Task 10 defeat notice.
 *
 * Between expeditions nothing can happen in the world, so the dialog cannot
 * be dismissed (Escape is ignored): Set out is the way back to the map.
 * Learning an upgrade re-renders the dialog in place and keeps focus on the
 * same button. The view comes from main.js (the last report and
 * progression.upgradeView), so the panel holds no game state.
 */
import {
  reportTitle, reportSummary, reportRows, describeInsight, describeBalance, upgradeRow, setOutText,
} from './expeditionText.js';

/**
 * @param {{ dialog: HTMLDialogElement, title: HTMLElement, summary: HTMLElement, rows: HTMLElement,
 *   insight: HTMLElement, balance: HTMLElement, upgrades: HTMLElement, message: HTMLElement,
 *   setOut: HTMLButtonElement }} el
 * @param {{
 *   view: () => { report: object, insight: number, upgrades: object[], next: number },
 *   onBuy: (id: string) => string,
 *   onSetOut: () => void,
 * }} handlers `onBuy` learns the upgrade and returns the text to show.
 */
export function createSanctuaryPanel(el, handlers) {
  el.dialog.addEventListener('cancel', (e) => e.preventDefault());
  el.setOut.addEventListener('click', () => handlers.onSetOut());
  el.upgrades.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-upgrade]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.upgrade;
    el.message.textContent = handlers.onBuy(id);
    render();
    // Keep focus on the same button; if it is now disabled (maxed or not
    // affordable), move it to Set out rather than losing it to the page.
    const same = el.upgrades.querySelector(`button[data-upgrade="${id}"]`);
    (same && !same.disabled ? same : el.setOut).focus();
  });

  function render() {
    const v = handlers.view();
    const r = v.report;
    el.dialog.dataset.outcome = r.outcome;
    el.title.textContent = reportTitle(r);
    el.summary.textContent = reportSummary(r);
    el.rows.replaceChildren(...reportRows(r).flatMap((row) => {
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      dd.textContent = row.value;
      dd.dataset.key = row.key;
      return [dt, dd];
    }));
    el.insight.textContent = describeInsight(r.insight);
    el.balance.textContent = describeBalance(v.insight);
    el.upgrades.replaceChildren(...v.upgrades.map((u) => {
      const t = upgradeRow(u);
      const li = document.createElement('li');
      li.className = 'pack-row upgrade-row';
      li.dataset.upgrade = u.id;
      const text = document.createElement('span');
      text.className = 'pack-row__text';
      const name = document.createElement('span');
      name.className = 'pack-row__name';
      name.textContent = `${t.name} · ${t.level}`;
      const about = document.createElement('span');
      about.className = 'pack-row__detail';
      about.textContent = t.about;
      const detail = document.createElement('span');
      detail.className = 'pack-row__detail upgrade-row__effect';
      detail.textContent = t.detail;
      text.append(name, about, detail);
      li.append(text);
      if (t.note) {
        const note = document.createElement('span');
        note.className = 'pack-row__note';
        note.textContent = t.note;
        li.append(note);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-button hud-button--small pack-button';
      btn.dataset.upgrade = u.id;
      btn.textContent = t.button;
      btn.setAttribute('aria-label', t.label);
      btn.title = t.label;
      btn.disabled = !u.check.ok;
      li.append(btn);
      return li;
    }));
    el.setOut.textContent = setOutText(v.next);
  }

  return {
    /** Open on the latest report (main.js, after a return or a defeat). */
    show() {
      el.message.textContent = '';
      render();
      if (!el.dialog.open) el.dialog.showModal();
      // Focus Set out without scrolling to it: the report opens at its top.
      el.setOut.focus({ preventScroll: true });
      el.dialog.scrollTop = 0;
    },
    close() {
      if (el.dialog.open) el.dialog.close();
    },
    get open() {
      return el.dialog.open;
    },
  };
}
