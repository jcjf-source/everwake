/**
 * HTML overlay: the feedback readout, the player status line, the world
 * clock with its Wait button, the inventory line, the contextual Gather
 * buttons, the
 * coordinate debug toggle, and zoom / recentre buttons (an alternative to
 * wheel and pinch). Recentre centres on the player.
 */
import { hexDistance } from '../world/hex.js';

const fmt = (n) => (n < 0 ? `−${-n}` : String(n)); // proper minus sign

/** "q 3, r −2" */
export const coordText = (h) => `q ${fmt(h.q)}, r ${fmt(h.r)}`;

/**
 * Text for the selection readout. Pure; unit tested.
 * @param {{q:number,r:number} | null} selected
 * @param {{ name: string, walkable: boolean, moveCost: number } | null} terrain
 * @param {{q:number,r:number} | null} sanctuary
 */
export function describeSelection(selected, terrain = null, sanctuary = null) {
  if (!selected) return 'Click or tap a hex to inspect it.';
  const parts = [terrain ? terrain.name : 'Hex', coordText(selected)];
  if (sanctuary && hexDistance(selected, sanctuary) === 0) {
    parts[0] = `Sanctuary (${terrain ? terrain.name.toLowerCase() : 'hex'})`;
    parts.push('safe start');
    return parts.join(' · ');
  }
  if (terrain) parts.push(terrain.walkable ? `move cost ${terrain.moveCost}` : 'impassable');
  if (sanctuary) {
    const d = hexDistance(selected, sanctuary);
    parts.push(`${d} ${d === 1 ? 'hex' : 'hexes'} from sanctuary`);
  }
  return parts.join(' · ');
}

/**
 * @param {{
 *   readout: HTMLElement, status: HTMLElement, coordsToggle: HTMLButtonElement,
 *   zoomIn: HTMLButtonElement, zoomOut: HTMLButtonElement, recenter: HTMLButtonElement,
 *   clock: HTMLElement, wait: HTMLButtonElement,
 *   inventory: HTMLElement, gather: HTMLElement,
 * }} el
 * @param {{
 *   onToggleCoords: (on: boolean) => void,
 *   onZoomStep: (factor: number) => void,
 *   onRecenter: () => void,
 *   onWait: () => void,
 *   onGather: (index: number) => void,
 * }} handlers
 */
export function createHud(el, handlers) {
  el.coordsToggle.addEventListener('click', () => {
    const on = el.coordsToggle.getAttribute('aria-pressed') !== 'true';
    el.coordsToggle.setAttribute('aria-pressed', String(on));
    handlers.onToggleCoords(on);
  });
  el.zoomIn.addEventListener('click', () => handlers.onZoomStep(1.25));
  el.zoomOut.addEventListener('click', () => handlers.onZoomStep(1 / 1.25));
  el.recenter.addEventListener('click', () => handlers.onRecenter());
  el.wait.addEventListener('click', () => handlers.onWait());
  el.gather.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (btn) handlers.onGather(Number(btn.dataset.index));
  });
  let gatherSig = null;

  return {
    /** Main feedback line (selection, route, travel progress). */
    showReadout(text) {
      el.readout.textContent = text;
    },
    /** Player position. */
    showStatus(text) {
      el.status.textContent = text;
    },
    /** World clock text; `part` (morning…night) styles the day-part mark. */
    showClock(text, part) {
      el.clock.textContent = text;
      el.clock.dataset.part = part;
    },
    /**
     * Carried resources: `[{ id, name, count }]`. The text reads
     * "Wood 2 · Stone 0 · …" (gatherText.describeInventory).
     */
    showInventory(entries) {
      el.inventory.replaceChildren();
      entries.forEach((e, i) => {
        if (i > 0) el.inventory.append(' · ');
        const span = document.createElement('span');
        span.className = e.count > 0 ? 'inv-item' : 'inv-item inv-item--empty';
        span.dataset.resource = e.id;
        span.textContent = `${e.name} ${e.count}`;
        el.inventory.append(span);
      });
    },
    /**
     * One Gather button per node in reach (`[{ key, resource, text, where,
     * label }]`); hidden when there is none. Buttons are rebuilt only when
     * the set changes, so focus survives a refresh.
     */
    showGather(buttons) {
      const sig = JSON.stringify(buttons);
      if (sig === gatherSig) return;
      gatherSig = sig;
      el.gather.replaceChildren(...buttons.map((b, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hud-button hud-button--gather';
        btn.dataset.resource = b.resource;
        btn.dataset.index = String(i);
        btn.setAttribute('aria-label', b.label);
        btn.title = b.label;
        const where = document.createElement('span');
        where.className = 'hud-button__where';
        where.textContent = b.where;
        btn.append(`${b.text} `, where);
        return btn;
      }));
      el.gather.hidden = buttons.length === 0;
    },
    /** Wait is unavailable while a route is being walked. */
    setWaitEnabled(on) {
      el.wait.disabled = !on;
    },
    /** Disable zoom buttons at the zoom limits so they never do nothing silently. */
    showZoom(cam) {
      const eps = 1e-6;
      el.zoomIn.disabled = cam.zoom >= cam.maxZoom - eps;
      el.zoomOut.disabled = cam.zoom <= cam.minZoom + eps;
    },
  };
}
