/**
 * Text for points of interest: readout notes, discovery and interaction
 * outcomes, the contextual buttons, and journal entries. Pure; unit tested,
 * and mirrored by the browser check (tools/browser/check-world.mjs).
 */
import { POI_TYPES } from '../data/pois.js';
import { describeBundle } from './itemText.js';
import { timeOf } from '../core/clock.js';
import { hexDistance, hexToPixel } from '../world/hex.js';
import { coordText } from './hud.js';
import { DIRECTION_ARROWS, DIRECTION_NAMES } from './gatherText.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => s[0].toLowerCase() + s.slice(1);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Short word for a type, used on buttons: "ruins", "camp", "chest", "shrine", "cave". */
export const TYPE_WORDS = Object.freeze({ ruins: 'ruins', camp: 'camp', chest: 'chest', shrine: 'shrine', cave: 'cave' });

/** Nouns for counting uses left, by verb. */
const USE_NOUNS = { Search: ['search', 'searches'], Open: ['opening', 'openings'], Read: ['reading', 'readings'] };

/** "Fallen watchtower (ruins)"; just the name when it already says the type ("Abandoned camp"). */
export function poiName(type, name) {
  const t = lower(POI_TYPES[type].name);
  return lower(name) === t ? name : `${name} (${t})`;
}

/** What is left: "not yet searched", "2 searches left", "opened". */
function stateText(s) {
  if (s.left <= 0) return s.def.done;
  if (s.poi.uses === 1) return `not yet ${s.def.done}`;
  const [one, many] = USE_NOUNS[s.def.verb] ?? ['use', 'uses'];
  return `${plural(s.left, one, many)} left`;
}

/**
 * "Fallen watchtower (ruins) · 2 searches left".
 * @param {{ poi: { type: string, name: string, uses: number }, def: object, left: number }} s POI state (systems/pois.js)
 */
export const describePoi = (s) => `${poiName(s.poi.type, s.poi.name)} · ${stateText(s)}`;

/** Suffix for a readout about a hex: "" or " · <poi>". */
export const poiNote = (s) => (s ? ` · ${describePoi(s)}` : '');

/** Compass direction from `from` to `to` as a DIRECTIONS index (screen sectors, pointy-top). */
export function compassIndex(from, to) {
  const a = hexToPixel(from, 1);
  const b = hexToPixel(to, 1);
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI; // screen y points down
  return ((Math.round(deg / 60) % 6) + 6) % 6;
}

/** "3 hexes north-east", "1 hex west", or "here". */
export function bearing(from, to) {
  const d = hexDistance(from, to);
  if (d === 0) return 'here';
  return `${plural(d, 'hex', 'hexes')} ${DIRECTION_NAMES[compassIndex(from, to)]}`;
}

/** "3 stone, 1 herbs, 1 healing potion" in item order. */
export const describeFound = (found) => describeBundle(found);

/** Readout for a `discovered` event: "Discovered Fallen watchtower (ruins) · 3 hexes north-east". */
export const describeDiscovered = (e) => `Discovered ${poiName(e.poi, e.name)} · ${bearing(e.from, e.at)}`;

/** Readout for an `interacted` event. */
export function describeInteracted(e) {
  const def = POI_TYPES[e.poi];
  const verbed = cap(def.done);
  const name = poiName(e.poi, e.name);
  if (def.effect === 'reveal') {
    const what = e.revealed > 0
      ? `the land around is revealed (${plural(e.revealed, 'hex', 'hexes')} mapped)`
      : 'the land around is already on your map';
    return `${verbed} ${name}: ${what}`;
  }
  const rest = e.left > 0 ? ` · ${plural(e.left, ...(USE_NOUNS[def.verb] ?? ['use', 'uses']))} left` : '';
  return `${verbed} ${name}: found ${describeFound(e.found)}${rest}`;
}

/** Why an interaction was refused (no turn passes). */
export function describeInteractRefused(reason, label) {
  switch (reason) {
    case 'tooFar': return `${label} · too far: stand on it or next to it`;
    case 'spent': return `${label} · nothing more to find here`;
    case 'noPoi': return `${label} · nothing to search here`;
    case 'unexplored': return `${label} · not on your map yet`;
    default: return `${label} · cannot do that (${reason})`;
  }
}

/** Button text and accessible name for one option (systems/pois.js interactOptions). */
export function interactButton(o) {
  const where = o.direction === null ? 'here' : DIRECTION_ARROWS[o.direction];
  const whereLong = o.direction === null ? 'here' : `to the ${DIRECTION_NAMES[o.direction]}`;
  return {
    text: `${o.def.verb} ${TYPE_WORDS[o.poi.type]}`,
    where,
    label: `${o.def.verb} ${o.poi.name} ${whereLong} (${stateText(o)})`,
  };
}

/** "Day 1 · morning" for a journal entry's turn. */
export const journalWhen = (turn) => { const t = timeOf(turn); return `Day ${t.day} · ${t.part}`; };

/** A journal entry's line (no bearing: the journal is read from anywhere). */
export function journalText(e) {
  if (e.type === 'discovered') return `Discovered ${poiName(e.poi, e.name)} at ${coordText(e.at)}`;
  return describeInteracted(e);
}

/** Journal dialog summary: "3 places discovered · 1 explored". */
export function describeJournalSummary(entries) {
  const found = new Set();
  const used = new Set();
  for (const e of entries) (e.type === 'discovered' ? found : used).add(`${e.at.q},${e.at.r}`);
  if (found.size === 0) return 'Nothing recorded yet. Explore to discover places.';
  return `${plural(found.size, 'place', 'places')} discovered · ${used.size} explored`;
}
