/**
 * World clock: a turn counter and the day-part clock derived from it.
 *
 * The turn count is the single source of truth; the day, day part and turn
 * within the day part are all computed from it. Time only moves when a
 * successful action advances it (see game.js): nothing here runs on a timer.
 *
 * A day has four parts of TURNS_PER_DAY_PART turns each. Turn 0 is the start
 * of the first morning (day 1). As a rough scale, a turn is about half an
 * hour: 12 turns per part, 48 per day.
 *
 * Simulation only (no DOM). Clock state is expedition-independent world
 * time; it is saved with the game in Task 13 via serializeClock/restoreClock.
 */

export const DAY_PARTS = Object.freeze(['morning', 'afternoon', 'evening', 'night']);
export const TURNS_PER_DAY_PART = 12;
export const TURNS_PER_DAY = TURNS_PER_DAY_PART * DAY_PARTS.length;

/** @param {number} [turn] turns elapsed so far (default 0: day 1, morning) */
export function createClock(turn = 0) {
  if (!Number.isInteger(turn) || turn < 0) throw new RangeError(`turn must be a non-negative integer, got ${turn}`);
  return { turn };
}

/**
 * Where a turn count falls on the clock.
 * @returns {{ turn: number, day: number, part: 'morning'|'afternoon'|'evening'|'night',
 *   partIndex: number, turnInPart: number }} `day` starts at 1, `turnInPart` at 0
 */
export function timeOf(turn) {
  const day = Math.floor(turn / TURNS_PER_DAY) + 1;
  const inDay = turn % TURNS_PER_DAY;
  const partIndex = Math.floor(inDay / TURNS_PER_DAY_PART);
  return { turn, day, part: DAY_PARTS[partIndex], partIndex, turnInPart: inDay % TURNS_PER_DAY_PART };
}

/**
 * Advance the clock by `turns` (an integer ≥ 1).
 * @returns {{ from: number, to: number, partChanged: boolean, dayChanged: boolean }}
 *   `partChanged`: a day-part boundary was crossed (also true for a new day).
 */
export function advanceClock(clock, turns) {
  if (!Number.isInteger(turns) || turns < 1) throw new RangeError(`turns must be a positive integer, got ${turns}`);
  const from = clock.turn;
  clock.turn = from + turns;
  const a = timeOf(from);
  const b = timeOf(clock.turn);
  return {
    from,
    to: clock.turn,
    partChanged: a.day !== b.day || a.partIndex !== b.partIndex,
    dayChanged: a.day !== b.day,
  };
}

const CLOCK_SAVE_VERSION = 1;

/** Save form: `{ version, turn }`. */
export function serializeClock(clock) {
  return { version: CLOCK_SAVE_VERSION, turn: clock.turn };
}

/**
 * Validate and rebuild a saved clock. Never throws.
 * @returns {{ ok: true, clock: { turn: number } } | { ok: false, error: string }}
 */
export function restoreClock(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'clock save is not an object' };
  if (data.version !== CLOCK_SAVE_VERSION) return { ok: false, error: `unsupported clock save version ${data.version}` };
  if (!Number.isSafeInteger(data.turn) || data.turn < 0) return { ok: false, error: 'clock turn must be a non-negative integer' };
  return { ok: true, clock: createClock(data.turn) };
}
