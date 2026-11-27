/**
 * Pointer input for the world canvas: hover, tap/click select, drag-pan,
 * mouse-wheel zoom and two-finger pinch zoom.
 *
 * All positions are canvas-local CSS pixels (clientX - rect.left), the same
 * space the renderer draws in, so device pixel ratio never affects
 * hit-testing.
 *
 * Gesture rules:
 * - One pointer pressed and released without moving more than TAP_SLOP px
 *   is a tap. Moving further turns the press into a pan; it never selects.
 * - A second touch starts a pinch (zoom about the midpoint + pan with it).
 *   Once a pinch has happened, nothing selects until all fingers lift.
 * - The wheel zooms about the cursor. Trackpad pinch (wheel + ctrlKey) too.
 * Page scrolling/zooming is prevented inside the canvas (CSS touch-action:
 * none, plus preventDefault on wheel and Safari gesture events).
 */

export const TAP_SLOP = 10;

/** Convert a pointer event to canvas-local CSS pixel coordinates. */
export function eventToCanvasPoint(event, rect) {
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Wheel event -> zoom multiplier. Normalises line/page delta modes and
 * clamps each event's effect so fast wheels and trackpads behave.
 * @param {{ deltaY: number, deltaMode: number, ctrlKey: boolean }} e
 * @param {number} pageHeight px used for DOM_DELTA_PAGE
 */
export function wheelZoomFactor(e, pageHeight = 800) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;              // lines
  else if (e.deltaMode === 2) dy *= pageHeight; // pages
  const sensitivity = e.ctrlKey ? 0.01 : 0.0015; // ctrl+wheel = trackpad pinch
  const factor = Math.exp(-dy * sensitivity);
  return Math.min(2, Math.max(0.5, factor));
}

/**
 * One step of a two-finger pinch.
 * @returns {{ factor: number, midX: number, midY: number, dx: number, dy: number }}
 *   zoom by `factor` about the new midpoint, after panning by (dx, dy).
 */
export function pinchStep(prevA, prevB, nextA, nextB) {
  const prevDist = Math.hypot(prevA.x - prevB.x, prevA.y - prevB.y);
  const nextDist = Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y);
  const prevMid = { x: (prevA.x + prevB.x) / 2, y: (prevA.y + prevB.y) / 2 };
  const nextMid = { x: (nextA.x + nextB.x) / 2, y: (nextA.y + nextB.y) / 2 };
  const factor = prevDist > 0 && nextDist > 0 ? nextDist / prevDist : 1;
  return { factor, midX: nextMid.x, midY: nextMid.y, dx: nextMid.x - prevMid.x, dy: nextMid.y - prevMid.y };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   onHover: (point: {x:number,y:number} | null) => void,
 *   onTap: (point: {x:number,y:number}) => void,
 *   onPan: (dx: number, dy: number) => void,
 *   onZoom: (factor: number, x: number, y: number) => void,
 *   onDragChange?: (dragging: boolean) => void,
 * }} handlers
 */
export function attachPointerInput(canvas, handlers) {
  /** @type {Map<number, {x:number, y:number, startX:number, startY:number}>} */
  const pointers = new Map();
  /** @type {'idle'|'press'|'pan'|'pinch'} */
  let mode = 'idle';
  let multiTouchUsed = false;

  const local = (e) => eventToCanvasPoint(e, canvas.getBoundingClientRect());

  function setMode(next) {
    const wasDragging = mode === 'pan' || mode === 'pinch';
    mode = next;
    const dragging = mode === 'pan' || mode === 'pinch';
    if (dragging !== wasDragging) handlers.onDragChange?.(dragging);
  }

  function firstTwo() {
    const it = pointers.values();
    return [it.next().value, it.next().value];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (pointers.size === 1) {
      setMode('press');
    } else if (pointers.size === 2) {
      multiTouchUsed = true;
      handlers.onHover(null);
      setMode('pinch');
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    const tracked = pointers.get(e.pointerId);

    if (!tracked) {
      // Plain hover: mouse/pen only (touch has no hover).
      if (e.pointerType !== 'touch') handlers.onHover(p);
      return;
    }

    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = firstTwo();
      const prevA = { x: a.x, y: a.y };
      const prevB = { x: b.x, y: b.y };
      tracked.x = p.x;
      tracked.y = p.y;
      const step = pinchStep(prevA, prevB, a, b);
      if (step.dx || step.dy) handlers.onPan(step.dx, step.dy);
      if (step.factor !== 1) handlers.onZoom(step.factor, step.midX, step.midY);
      return;
    }

    const dx = p.x - tracked.x;
    const dy = p.y - tracked.y;
    tracked.x = p.x;
    tracked.y = p.y;

    if (mode === 'press') {
      if (Math.hypot(p.x - tracked.startX, p.y - tracked.startY) > TAP_SLOP) {
        setMode('pan');
        handlers.onHover(null);
        // Catch up the whole movement so the map stays under the finger.
        handlers.onPan(p.x - tracked.startX, p.y - tracked.startY);
      }
    } else if (mode === 'pan') {
      handlers.onPan(dx, dy);
    }
  });

  function release(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const wasPress = mode === 'press';
    pointers.delete(e.pointerId);

    if (pointers.size === 0) {
      if (wasPress && !cancelled && !multiTouchUsed) handlers.onTap(local(e));
      multiTouchUsed = false;
      setMode('idle');
      if (e.pointerType !== 'touch' && !cancelled) handlers.onHover(local(e));
    } else if (pointers.size === 1) {
      // Pinch ended with one finger still down: keep panning with it.
      setMode('pan');
    }
  }

  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !pointers.has(e.pointerId)) handlers.onHover(null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); // never scroll/zoom the page from the game area
    const p = local(e);
    handlers.onZoom(wheelZoomFactor(e, canvas.clientHeight), p.x, p.y);
  }, { passive: false });

  // iOS Safari pinch-to-zoom the page despite touch-action in some versions.
  for (const type of ['gesturestart', 'gesturechange']) {
    canvas.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}
