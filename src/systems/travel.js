/**
 * Stepwise route following.
 *
 * Walks a planned path one hex at a time by calling `step(hex)` (normally a
 * move action through the turn pipeline, so one turn per hex) for each hex, with a short delay between steps so the
 * journey is visible. Every step is re-validated, so a route that has
 * become blocked stops safely at the last good hex. Travel can be stopped
 * at any time, and a step may ask to interrupt it (`interrupt` in the step
 * result: an encounter, say), which stops travel after that step; nothing happens between steps unless a route is active, and
 * no timer is left running once travel ends.
 *
 * Stride (G03): a step the pool cannot pay for is refused (`noStride`) and
 * changes nothing. Travel then stops with a `needStride` event instead of
 * `blocked`: the route is still good, so the caller keeps the rest of it as
 * a preview. Travel never plays cards by itself.
 *
 * The timer is injectable so tests can drive travel deterministically.
 */

/** Pause between route steps, in milliseconds. Presentation pacing only. */
export const STEP_DELAY_MS = 150;

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ type: 'step' | 'arrived', at: Hex, done: number, total: number, destination: Hex }
 *   | { type: 'stopped', done: number, total: number, destination: Hex }
 *   | { type: 'blocked', at: Hex, reason: string, done: number, total: number, destination: Hex }
 *   | { type: 'interrupted', at: Hex, reason: string, done: number, total: number, destination: Hex }
 *   | { type: 'needStride', at: Hex, cost: number, pool: number, done: number, total: number, destination: Hex }} TravelEvent
 *   `needStride`: the next step (`at`) costs `cost` and the pool holds `pool`.
 *
 * @param {{
 *   step: (to: Hex) => { ok: boolean, reason?: string, cost?: number, pool?: number, interrupt?: { reason: string } | null },
 *   onEvent: (e: TravelEvent) => void,
 *   delay?: number,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 *   cancel?: (id: unknown) => void,
 * }} opts
 */
export function createTravel({ step, onEvent, delay = STEP_DELAY_MS, schedule = setTimeout, cancel = clearTimeout }) {
  /** @type {{ path: Hex[], index: number } | null} */
  let route = null;
  let timer = null;

  function finish() {
    route = null;
    timer = null;
  }

  function runStep() {
    timer = null;
    if (!route) return;
    const { path } = route;
    const destination = path[path.length - 1];
    const to = path[route.index];
    const result = step(to);
    if (!result.ok) {
      const done = route.index;
      finish();
      if (result.reason === 'noStride') onEvent({ type: 'needStride', at: to, cost: result.cost, pool: result.pool, done, total: path.length, destination });
      else onEvent({ type: 'blocked', at: to, reason: result.reason ?? 'blocked', done, total: path.length, destination });
      return;
    }
    route.index += 1;
    const done = route.index;
    if (done >= path.length) {
      finish();
      onEvent({ type: 'arrived', at: to, done, total: path.length, destination });
      return;
    }
    if (result.interrupt) {
      finish();
      onEvent({ type: 'interrupted', at: to, reason: result.interrupt.reason ?? 'interrupted', done, total: path.length, destination });
      return;
    }
    onEvent({ type: 'step', at: to, done, total: path.length, destination });
    if (route) timer = schedule(runStep, delay); // onEvent may have stopped travel
  }

  return {
    /** Begin following `path` (excluding the start hex). The first step is taken at once. */
    start(path) {
      if (route) this.stop({ silent: true });
      if (!path || path.length === 0) return;
      route = { path: path.slice(), index: 0 };
      runStep();
    },
    /** Stop after the current step. Returns true if travel was active. */
    stop({ silent = false } = {}) {
      if (!route) return false;
      if (timer !== null) cancel(timer);
      const { path, index } = route;
      finish();
      if (!silent) onEvent({ type: 'stopped', done: index, total: path.length, destination: path[path.length - 1] });
      return true;
    },
    get active() { return route !== null; },
    get destination() { return route ? route.path[route.path.length - 1] : null; },
    /** Hexes still to walk, in order. */
    get remaining() { return route ? route.path.slice(route.index) : []; },
  };
}
