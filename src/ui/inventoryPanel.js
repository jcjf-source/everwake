/**
 * The Pack dialog (Task 11): stats, what is worn, and everything carried,
 * with a button per item (Use / Eat / Drink a consumable, Equip a weapon or
 * armor, Take off what is worn). Every button performs one action through
 * the turn pipeline (main.js `onAction`), so it costs a turn and enemies
 * react; a button whose check fails is shown disabled with the reason
 * beside it, and a refusal from the pipeline is reported in the dialog's
 * message line without a turn passing. The view itself comes from
 * systems/items.js `inventoryView`, so the dialog has no state of its own
 * beyond the last message.
 */
import {
  describeSlot, describeStats, effectText, itemButton, refusalNote, unequipButton,
} from './itemText.js';
import { describeHealth } from './combatText.js';

/**
 * @param {{ button: HTMLButtonElement, dialog: HTMLDialogElement, stats: HTMLElement,
 *   slots: HTMLElement, list: HTMLElement, message: HTMLElement }} el
 * @param {{
 *   view: () => ReturnType<typeof import('../systems/items.js').inventoryView>,
 *   onAction: (action: object) => string,
 *   onOpen?: () => void,
 * }} handlers `onAction` performs the action and returns the text to show.
 */
export function createInventoryPanel(el, handlers) {
  /** Actions behind the buttons as last rendered, by index. */
  let actions = [];

  function actionButton(text, label, action, check) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-button hud-button--small pack-button';
    btn.textContent = text;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    if (check && !check.ok) btn.disabled = true;
    btn.dataset.index = String(actions.length);
    btn.dataset.key = `${action.type}:${action.item ?? action.slot}`;
    actions.push(action);
    return btn;
  }

  function note(text) {
    const span = document.createElement('span');
    span.className = 'pack-row__note';
    span.textContent = text;
    return span;
  }

  function render() {
    const v = handlers.view();
    actions = [];
    el.stats.textContent = `${describeHealth(v.stats.health, v.stats.maxHealth)} · ${describeStats(v.stats)}`;

    el.slots.replaceChildren(...v.slots.map((s) => {
      const li = document.createElement('li');
      li.className = 'pack-row';
      li.dataset.slot = s.slot;
      const what = document.createElement('span');
      what.className = 'pack-row__name';
      what.textContent = describeSlot(s.slot, s.item);
      li.append(what);
      if (s.item) {
        const b = unequipButton(s.slot, s.item);
        li.append(actionButton(b.text, b.label, { type: 'unequip', slot: s.slot }, s.unequip));
      }
      return li;
    }));

    el.list.replaceChildren(...v.items.map((e) => {
      const li = document.createElement('li');
      li.className = 'pack-row';
      li.dataset.item = e.item;
      li.dataset.resource = e.item; // colour dot, as on the HUD line
      const what = document.createElement('span');
      what.className = 'pack-row__name';
      what.textContent = `${e.def.name} × ${e.count}`;
      const detail = document.createElement('span');
      detail.className = 'pack-row__detail';
      detail.textContent = `${effectText(e.item)} · ${e.def.about}`;
      const text = document.createElement('span');
      text.className = 'pack-row__text';
      text.append(what, detail);
      li.append(text);
      if (e.action) {
        const b = itemButton(e);
        const action = e.action.type === 'use' ? { type: 'use', item: e.item } : { type: 'equip', item: e.item };
        if (!e.action.check.ok) li.append(note(refusalNote(e.action.check.reason)));
        li.append(actionButton(b.text, b.label, action, e.action.check));
      }
      return li;
    }));
    if (v.items.length === 0) {
      const li = document.createElement('li');
      li.className = 'pack-row pack-row--empty';
      li.textContent = 'Nothing carried.';
      el.list.append(li);
    }
  }

  function open() {
    handlers.onOpen?.();
    el.message.textContent = '';
    render();
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
  }

  function close() {
    if (typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  el.button.addEventListener('click', open);
  el.dialog.addEventListener('click', (e) => {
    if (e.target === el.dialog) { close(); return; }
    const btn = e.target.closest('button[data-index]');
    const action = btn && !btn.disabled ? actions[Number(btn.dataset.index)] : null;
    if (!action) return;
    el.message.textContent = handlers.onAction(action);
    if (el.dialog.open) {
      render();
      // Rebuilding the list drops focus: put it back on the same button if it is still there.
      const again = el.dialog.querySelector(`button[data-key="${btn.dataset.key}"]:not([disabled])`);
      (again ?? el.dialog.querySelector('#pack-close'))?.focus();
    }
  });

  return {
    get isOpen() { return el.dialog.open; },
    close,
    /** Re-render if open. */
    refresh() {
      if (el.dialog.open) render();
    },
  };
}
