/**
 * The discovery journal: a lasting record of places found and what came of
 * them. *Player persistent state* (knowledge survives death; see "State
 * model" in docs/TECHNICAL.md); saved with the game (systems/persistence.js).
 *
 * The turn pipeline (src/core/game.js) records every journal-worthy event
 * (`discovered`, `interacted`) with the turn it happened on. Unlike the game
 * log, the journal is not capped: it grows only with discoveries and POI
 * uses, which the map bounds. Entries are plain data; src/ui/poiText.js
 * formats them.
 *
 * Simulation only (no DOM).
 */

export const JOURNAL_VERSION = 1;

/** Event types the journal keeps. */
export const JOURNAL_EVENTS = Object.freeze(['discovered', 'interacted']);

const isHex = (h) => !!h && Number.isSafeInteger(h.q) && Number.isSafeInteger(h.r);

export function createJournal() {
  /** @type {Array<{ turn: number, type: string, at: {q:number,r:number} } & Record<string, unknown>>} */
  const entries = [];
  return {
    /** Entries, oldest first. Treat as read-only. */
    get entries() { return entries; },
    /** Keep the journal-worthy events among `events`, stamped with `turn`. */
    record(events, turn) {
      for (const e of events) {
        if (!JOURNAL_EVENTS.includes(e.type)) continue;
        entries.push({ turn, ...JSON.parse(JSON.stringify(e)) });
      }
    },
    /** Save form: `{ version, entries }`. */
    serialize() {
      return { version: JOURNAL_VERSION, entries: JSON.parse(JSON.stringify(entries)) };
    },
  };
}

/**
 * Validate and rebuild a saved journal. Never throws, never half-applies.
 * @returns {{ ok: true, journal: ReturnType<typeof createJournal> } | { ok: false, error: string }}
 */
export function restoreJournal(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'journal save is not an object' };
  if (data.version !== JOURNAL_VERSION) return { ok: false, error: `unsupported journal version ${data.version}` };
  if (!Array.isArray(data.entries)) return { ok: false, error: 'journal entries must be a list' };
  let last = 0;
  for (const e of data.entries) {
    if (!e || typeof e !== 'object') return { ok: false, error: 'journal entry is not an object' };
    if (!Number.isSafeInteger(e.turn) || e.turn < last) return { ok: false, error: 'journal turns must be integers in order' };
    if (!JOURNAL_EVENTS.includes(e.type)) return { ok: false, error: `unknown journal entry type ${e.type}` };
    if (!isHex(e.at) || typeof e.poi !== 'string' || typeof e.name !== 'string') return { ok: false, error: 'journal entry needs at, poi and name' };
    last = e.turn;
  }
  const journal = createJournal();
  for (const { turn, ...e } of data.entries) journal.record([e], turn);
  return { ok: true, journal };
}
