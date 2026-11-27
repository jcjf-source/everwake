/**
 * Keeps a canvas sized to its CSS box at the device pixel ratio and calls
 * `draw(ctx, width, height)` (CSS-pixel units) whenever it needs repainting.
 * Repaints happen on size changes and on explicit `requestRepaint()` calls
 * (coalesced to one per animation frame); there is no continuous loop.
 * Returns `{ requestRepaint, getSize }`; `getSize()` gives the canvas box in
 * CSS pixels, the same units `draw` receives.
 * @param {HTMLCanvasElement} canvas
 * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} draw
 * @param {(err: unknown, context?: string) => void} report
 */
export function attachCanvasSurface(canvas, draw, report) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available in this browser.');

  let pending = false;

  function getSize() {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  function repaint() {
    pending = false;
    try {
      const { width, height } = getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pxW = Math.round(width * dpr);
      const pxH = Math.round(height * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, width, height);
    } catch (err) {
      report(err, 'Render failed');
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(repaint);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(schedule).observe(canvas);
  }
  // Also listen to window resize: DPR changes (browser zoom, moving between
  // monitors) do not always change the canvas CSS box.
  window.addEventListener('resize', schedule);

  schedule();
  return { requestRepaint: schedule, getSize };
}
