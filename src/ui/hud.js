/**
 * HTML overlay: selected-hex readout (terrain, cost, distance to the
 * sanctuary), coordinate debug toggle, and
 * zoom / recentre buttons (an alternative to wheel and pinch).
 */
import { hexDistance } from '../world/hex.js';

const fmt = (n) => (n < 0 ? `−${-n}` : String(n)); // proper minus sign

/**
 * Text for the selection readout. Pure; unit tested.
 * @param {{q:number,r:number} | null} selected
 * @param {{ name: string, walkable: boolean, moveCost: number } | null} terrain
 * @param {{q:number,r:number} | null} sanctuary
 */
export function describeSelection(selected, terrain = null, sanctuary = null) {
  if (!selected) return 'Click or tap a hex to inspect it.';
  const parts = [terrain ? terrain.name : 'Hex', `q ${fmt(selected.q)}, r ${fmt(selected.r)}`];
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
 *   readout: HTMLElement, coordsToggle: HTMLButtonElement,
 *   zoomIn: HTMLButtonElement, zoomOut: HTMLButtonElement, recenter: HTMLButtonElement,
 * }} el
 * @param {{
 *   onToggleCoords: (on: boolean) => void,
 *   onZoomStep: (factor: number) => void,
 *   onRecenter: () => void,
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

  return {
    showSelection(selected, terrain, sanctuary) {
      el.readout.textContent = describeSelection(selected, terrain, sanctuary);
      el.recenter.title = selected ? 'Centre the view on the selected hex' : 'Centre the view on the sanctuary';
    },
    /** Disable zoom buttons at the zoom limits so they never do nothing silently. */
    showZoom(cam) {
      const eps = 1e-6;
      el.zoomIn.disabled = cam.zoom >= cam.maxZoom - eps;
      el.zoomOut.disabled = cam.zoom <= cam.minZoom + eps;
    },
  };
}
