/**
 * World seeds: the text the player sees and types, and its numeric form.
 * Seeds are case-sensitive text; surrounding whitespace is trimmed and runs
 * of inner whitespace collapse to one space, so "a  b " and "a b" match.
 */
import { hashString } from '../core/rng.js';

export const MAX_SEED_LENGTH = 32;
const ALLOWED = /^[\p{L}\p{N} _.\-]+$/u;

/** @returns {{ ok: true, seed: string } | { ok: false, error: string }} */
export function normalizeSeed(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Seed must be text.' };
  const seed = input.trim().replace(/\s+/g, ' ');
  if (!seed) return { ok: false, error: 'Enter a seed.' };
  if ([...seed].length > MAX_SEED_LENGTH) return { ok: false, error: `Use at most ${MAX_SEED_LENGTH} characters.` };
  if (!ALLOWED.test(seed)) return { ok: false, error: 'Use letters, numbers, spaces, - _ or . only.' };
  return { ok: true, seed };
}

/** The 32-bit number world generation is driven by. */
export function seedToNumber(seed) {
  return hashString(seed);
}

const ADJECTIVES = [
  'ashen', 'mossy', 'silent', 'hollow', 'grey', 'misty', 'sunken', 'amber',
  'pale', 'quiet', 'faded', 'wild', 'distant', 'cold', 'old', 'drowned',
];
const NOUNS = [
  'vale', 'fen', 'cairn', 'hollow', 'ridge', 'marsh', 'barrow', 'thicket',
  'tarn', 'moor', 'brook', 'crag', 'glade', 'heath', 'weald', 'scar',
];

/**
 * A memorable random seed such as "misty-tarn-417".
 * Choosing a seed is UI, not world generation, so any entropy source is fine;
 * `randomInt(n)` must return an integer in [0, n).
 */
export function randomSeed(randomInt = defaultRandomInt) {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  return `${adj}-${noun}-${100 + randomInt(900)}`;
}

function defaultRandomInt(n) {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}
