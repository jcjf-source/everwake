/**
 * Text for saving and loading (Task 13): the start screen, save status,
 * the confirmations before a world is replaced, import errors and the
 * damaged-save screen. Pure; unit tested, and mirrored by the browser
 * check (tools/browser/check-world.mjs).
 */

const plural = (n, one, many) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "misty-tarn-417 · expedition 3 under way · day 2, evening" */
export function describeSummary(s) {
  const exp = s.status === 'active' ? `expedition ${s.expedition} under way` : `expedition ${s.expedition} over · at the sanctuary`;
  return `${s.seed} · ${exp} · day ${s.day}, ${s.part}`;
}

/** "412 of 4,921 hexes mapped · 5 places found · 37 insight · 2 upgrade levels" */
export function describeProgress(s) {
  return [
    `${s.mapped.toLocaleString('en-GB')} of ${s.total.toLocaleString('en-GB')} hexes mapped`,
    plural(s.places, 'place found', 'places found'),
    `${s.insight.toLocaleString('en-GB')} insight`,
    plural(s.upgrades, 'upgrade level', 'upgrade levels'),
  ].join(' · ');
}

/** The start screen's note when the page's link names a different world than the save. */
export const linkNote = (seed) => `This link is for another world, “${seed}”. Choose New world to start it: your saved world is erased only after you confirm.`;

/**
 * Save status, for the world dialog. `status`:
 *  - `{ state: 'saved', turn, day, part }` the last successful save;
 *  - `{ state: 'failed', error }` the last save failed;
 *  - `{ state: 'unavailable', error }` storage cannot be used at all;
 *  - `{ state: 'held' }` a damaged save is waiting for the player's decision.
 */
export function describeSaveStatus(status) {
  switch (status.state) {
    case 'saved': return `Saved in this browser after every turn · last saved on turn ${status.turn} (day ${status.day}, ${status.part}).`;
    case 'failed': return `Not saved: ${status.error}. Your last good save is kept. Export your save to keep a copy of this game.`;
    case 'unavailable': return `Not saving: ${status.error}. Progress will be lost when this page closes; Export save keeps a copy.`;
    case 'held': return 'Not saving until you decide what to do with the damaged save.';
    default: return '';
  }
}

/** The short HUD warning while saving is not working, or '' when it is. */
export function hudSaveWarning(status) {
  switch (status.state) {
    case 'failed': return `Not saved · ${status.error}`;
    case 'unavailable': return 'Not saving · browser storage is unavailable';
    default: return '';
  }
}

/** What is about to be lost, for the confirmations. */
function losing(current) {
  if (!current) return [];
  return [`This erases ${current.seed}: ${describeProgress(current)}, and expedition ${current.expedition}.`];
}

/**
 * The confirmation before a new world replaces the current one:
 * `{ title, lines, confirm, cancel }`. With `damaged`, the current save is
 * the damaged one (kept as a backup) rather than a playable world.
 */
export function confirmReplace({ current, damaged = false, seed }) {
  return {
    title: 'Replace this world?',
    lines: damaged
      ? [`A new world, “${seed}”, will begin.`, 'The damaged save is kept as a backup in this browser, not deleted.']
      : [`A new world, “${seed}”, will begin.`, ...losing(current), 'This cannot be undone. Export your save first to keep a copy.'],
    confirm: 'Replace world',
    cancel: damaged ? 'Cancel' : 'Keep my world',
  };
}

/** The confirmation before an imported save replaces the current world. */
export function confirmImport({ current, damaged = false, incoming }) {
  return {
    title: 'Load this save?',
    lines: [
      `The file holds ${describeSummary(incoming)}: ${describeProgress(incoming)}.`,
      ...(damaged ? ['The damaged save is kept as a backup in this browser, not deleted.'] : [...losing(current), 'This cannot be undone. Export your save first to keep a copy.']),
    ],
    confirm: 'Load save',
    cancel: damaged ? 'Cancel' : 'Keep my world',
  };
}

/** When keeping a backup of the damaged save failed: replace it anyway? */
export function confirmNoBackup(error) {
  return {
    title: 'No room for a backup',
    lines: [
      `The damaged save could not be kept as a backup (${error}).`,
      'Download it first if you want a copy. Replacing it now loses it for good.',
    ],
    confirm: 'Replace without a backup',
    cancel: 'Cancel',
  };
}

/** Largest save file Import accepts (a real save is a few kilobytes). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Why an imported file was refused. The current world is untouched. */
export const describeImportError = (error) => `That file could not be loaded: ${error}. Your current world is unchanged.`;

/** The damaged-save screen's reason line. */
export const recoveryReason = (error) => `The save in this browser could not be loaded: ${error}.`;

/** After a new world or an import replaced the damaged save. */
export const BACKUP_KEPT = 'The damaged save was kept as a backup in this browser.';

/** The readout on continuing a saved world. */
export const describeContinued = (s) => `Welcome back · ${describeSummary(s)}`;

/** The readout after a save was imported. */
export const describeImported = (s) => `Save loaded · ${describeSummary(s)}`;
