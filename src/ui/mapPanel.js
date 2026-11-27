/**
 * The Map dialog: an overview of every hex the player has mapped, fitted
 * to the explored area, with what is in sight, what is remembered, the
 * player and the sanctuary. Tapping a mapped hex closes the dialog and
 * hands the hex to `onPick` (main.js centres the view on it).
 *
 * The overview is drawn by the same renderer as the main view (main.js
 * supplies `draw`), so fog and terrain always look the same in both.
 */
import { attachCanvasSurface } from '../render/canvasSurface.js';
import { screenToHex } from '../render/gridView.js';
import { eventToCanvasPoint } from './pointerInput.js';

/**
 * @param {{
 *   button: HTMLButtonElement, dialog: HTMLDialogElement, canvas: HTMLCanvasElement,
 *   summary: HTMLElement,
 * }} el The dialog's Close button is a `method="dialog"` submit, so it needs no handler.
 * @param {{
 *   draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => import('../render/gridView.js').GridView,
 *   summary: () => string,
 *   isPickable: (h: {q:number,r:number}) => boolean,
 *   onPick: (h: {q:number,r:number}) => void,
 *   onOpen?: () => void,
 * }} handlers `onOpen` runs before the dialog shows (main.js stops travel there).
 * @param {(err: unknown, context?: string) => void} report
 */
export function createMapPanel(el, handlers, report) {
  let lastView = null;
  const surface = attachCanvasSurface(
    el.canvas,
    (ctx, width, height) => {
      if (!el.dialog.open) return; // nothing to draw while hidden (zero-size box)
      lastView = handlers.draw(ctx, width, height);
    },
    report,
  );

  function open() {
    handlers.onOpen?.();
    el.summary.textContent = handlers.summary();
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
    surface.requestRepaint();
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
  el.canvas.addEventListener('click', (e) => {
    if (!lastView) return;
    const p = eventToCanvasPoint(e, el.canvas.getBoundingClientRect());
    const h = screenToHex(lastView, p.x, p.y);
    if (!handlers.isPickable(h)) return;
    close();
    handlers.onPick(h);
  });

  return {
    get isOpen() { return el.dialog.open; },
    /** Redraw if open (e.g. the player moved while it was showing). */
    refresh() {
      if (!el.dialog.open) return;
      el.summary.textContent = handlers.summary();
      surface.requestRepaint();
    },
  };
}
