/**
 * The browser's save slot (Task 13): one saved world in Web Storage
 * (localStorage), written after every change that matters.
 *
 * Save safety rules:
 *  - a save that cannot be read is reported as `damaged`, with the reason
 *    and its raw text. It is never deleted or overwritten here; the UI keeps
 *    autosave off until the player decides, and `setAsideDamaged` copies it
 *    to a backup key before anything replaces it;
 *  - storage that is missing or refuses access (private browsing, blocked
 *    site data) is reported as `unavailable`: the game still runs, unsaved;
 *  - every write is read back and compared, so a failed or partial write
 *    (a full quota) is reported rather than assumed to have worked.
 *
 * The storage object is passed in (anything with getItem/setItem), so tests
 * use a plain in-memory stand-in. No DOM.
 */
import { serializeGame, parseSave } from './persistence.js';

export const SAVE_KEY = 'everwake.save';
/** Where a damaged save is kept when the player replaces it. */
export const DAMAGED_KEY = 'everwake.save.damaged';

const message = (err) => (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err));
const isQuota = (err) => !!err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);

/**
 * The page's localStorage if it can be used, else why not.
 * Reading `window.localStorage` itself throws when site data is blocked.
 * @returns {{ ok: true, storage: Storage } | { ok: false, error: string }}
 */
export function openStorage(get = () => globalThis.localStorage) {
  try {
    const storage = get();
    if (!storage) return { ok: false, error: 'this browser has no local storage' };
    storage.getItem(SAVE_KEY);
    return { ok: true, storage };
  } catch (err) {
    return { ok: false, error: `the browser blocks local storage (${message(err)})` };
  }
}

/**
 * Read the saved world.
 * @param {{ getItem: (k: string) => string | null }} storage
 * @param {{ radius: number }} opts as for persistence.restoreGame
 * @returns {{ status: 'empty' }
 *   | { status: 'ok', game: object, savedAt: string | null, bytes: number }
 *   | { status: 'damaged', error: string, raw: string }
 *   | { status: 'unavailable', error: string }}
 */
export function readSave(storage, opts) {
  let raw;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch (err) {
    return { status: 'unavailable', error: `the save could not be read from storage (${message(err)})` };
  }
  if (raw === null || raw === undefined) return { status: 'empty' };
  const r = parseSave(raw, opts);
  return r.ok ? { status: 'ok', game: r.game, savedAt: r.savedAt, bytes: raw.length } : { status: 'damaged', error: r.error, raw };
}

/**
 * Save `game` into the slot, replacing what is there.
 * @returns {{ ok: true, savedAt: string, bytes: number } | { ok: false, error: string }}
 */
export function writeSave(storage, game, { now = () => new Date().toISOString() } = {}) {
  let text;
  const savedAt = now();
  try {
    text = JSON.stringify(serializeGame(game, { savedAt }));
  } catch (err) {
    return { ok: false, error: `the game could not be saved (${message(err)})` };
  }
  try {
    storage.setItem(SAVE_KEY, text);
    if (storage.getItem(SAVE_KEY) !== text) return { ok: false, error: 'the save did not stick (storage returned something else)' };
  } catch (err) {
    return { ok: false, error: isQuota(err) ? 'browser storage is full' : `browser storage refused the save (${message(err)})` };
  }
  return { ok: true, savedAt, bytes: text.length };
}

/**
 * Keep a damaged save's raw text under DAMAGED_KEY (replacing any older
 * one) so that starting afresh never loses it.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function setAsideDamaged(storage, raw) {
  try {
    storage.setItem(DAMAGED_KEY, raw);
    return storage.getItem(DAMAGED_KEY) === raw ? { ok: true } : { ok: false, error: 'the backup did not stick' };
  } catch (err) {
    return { ok: false, error: isQuota(err) ? 'browser storage is full' : message(err) };
  }
}

/** The save as a file's text (pretty-printed JSON) for export. */
export const exportText = (game, { now = () => new Date().toISOString() } = {}) => `${JSON.stringify(serializeGame(game, { savedAt: now() }), null, 1)}\n`;

/** A file name for an exported save: "everwake-misty-tarn-417-day-3.json". */
export function exportFileName(game, day) {
  const slug = game.world.seed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'world';
  return `everwake-${slug}-day-${day}.json`;
}
