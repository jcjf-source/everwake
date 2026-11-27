/**
 * HTML overlay: the feedback readout, the player status line, the health
 * line, the world
 * clock with its Wait button, the inventory line, the contextual action
 * buttons (Attack / Defend / Flee / Use in a fight, Search / Open / Read for
 * points of interest, Gather for resource nodes), the coordinate debug toggle, and zoom / recentre buttons (an
 * alternative to wheel and pinch). Recentre centres on the player.
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
 *   clock: HTMLElement, wait: HTMLButtonElement, health: HTMLElement,
 *   inventory: HTMLElement, actions: HTMLElement,
 * }} el
 * @param {{
 *   onToggleCoords: (on: boolean) => void,
 *   onZoomStep: (factor: number) => void,
 *   onRecenter: () => void,
 *   onWait: () => void,
 *   onAction: (index: number) => void,
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
  el.actions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (btn) handlers.onAction(Number(btn.dataset.index));
  });
  let actionsSig = null;

  return {
    /** Main feedback line (selection, route, travel progress). */
    showReadout(text) {
      el.readout.textContent = text;
    },
    /** Player position. */
    showStatus(text) {
      el.status.textContent = text;
    },
    /** Health line ("Health 18/24") with a bar; `data-low` marks a third or less. */
    showHealth(text, health, max) {
      el.health.textContent = text;
      el.health.style.setProperty('--hp', String(max > 0 ? health / max : 0));
      el.health.toggleAttribute('data-low', health * 3 <= max);
      el.health.setAttribute('aria-valuenow', String(health));
      el.health.setAttribute('aria-valuemax', String(max));
      el.health.setAttribute('aria-valuetext', text);
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
     * One button per thing that can be done here (`[{ key, kind: 'attack' |
     * 'defend' | 'flee' | 'use' | 'interact' | 'gather', poi?, resource?,
     * enemy?, text, where, label }]`): combat first, then POIs, then
     * resource nodes; hidden when there is none. Buttons are rebuilt only
     * when the set changes, so focus survives a refresh.
     */
    showActions(buttons) {
      const sig = JSON.stringify(buttons);
      if (sig === actionsSig) return;
      actionsSig = sig;
      el.actions.replaceChildren(...buttons.map((b, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `hud-button hud-button--action hud-button--${b.kind}`;
        if (b.resource) btn.dataset.resource = b.resource;
        if (b.poi) btn.dataset.poi = b.poi;
        if (b.enemy) btn.dataset.enemy = b.enemy;
        btn.dataset.index = String(i);
        btn.setAttribute('aria-label', b.label);
        btn.title = b.label;
        const where = document.createElement('span');
        where.className = 'hud-button__where';
        where.textContent = b.where;
        btn.append(`${b.text} `, where);
        return btn;
      }));
      el.actions.hidden = buttons.length === 0;
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
