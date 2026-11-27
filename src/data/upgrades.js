/**
 * Permanent upgrades (Task 12), bought at the sanctuary with insight between
 * expeditions. Data only, plus the pure functions that turn the levels owned
 * into their effects; the rules for buying are in systems/progression.js.
 *
 * Each upgrade has a `name`, an `about` line, the `costs` of its levels in
 * order (so its maximum level is `costs.length`) and `perLevel`: what one
 * level adds to the effect named by `effect`:
 *  - survivor     `maxHealth`: added to the starting maximum health;
 *  - cartographer `sight`: added to the sight radius (fog of war);
 *  - pathfinder   `stealth`: taken off every enemy's detection range
 *                 (never below 1, so a creature beside you always notices);
 *  - scavenger    `gather`: added to every gather's yield.
 *
 * Effects are derived from the levels whenever they are needed; nothing
 * copies them into the player, so there is one source of truth.
 */

export const UPGRADES = Object.freeze({
  survivor: Object.freeze({
    id: 'survivor', name: 'Survivor', effect: 'maxHealth', perLevel: 4,
    about: 'Hardened by the wilds: more health on every expedition.',
    costs: Object.freeze([25, 50, 90]),
  }),
  cartographer: Object.freeze({
    id: 'cartographer', name: 'Cartographer', effect: 'sight', perLevel: 1,
    about: 'A trained eye for the land: you see and map farther.',
    costs: Object.freeze([40, 80]),
  }),
  pathfinder: Object.freeze({
    id: 'pathfinder', name: 'Pathfinder', effect: 'stealth', perLevel: 1,
    about: 'A quiet tread: creatures notice you from closer.',
    costs: Object.freeze([30, 60]),
  }),
  scavenger: Object.freeze({
    id: 'scavenger', name: 'Scavenger', effect: 'gather', perLevel: 1,
    about: 'You know where to look: more from every gather.',
    costs: Object.freeze([30, 60]),
  }),
});

export const UPGRADE_IDS = Object.freeze(Object.keys(UPGRADES));

/** The effect names, each 0 with no upgrades. */
export const NO_EFFECTS = Object.freeze({ maxHealth: 0, sight: 0, stealth: 0, gather: 0 });

/** Problems with an upgrade definition (an empty list when valid). */
export function validateUpgrade(d) {
  const p = [];
  if (!d || typeof d !== 'object') return ['not an object'];
  if (typeof d.name !== 'string' || !d.name) p.push(`${d.id}: name`);
  if (typeof d.about !== 'string' || !d.about) p.push(`${d.id}: about`);
  if (!Object.hasOwn(NO_EFFECTS, d.effect)) p.push(`${d.id}: unknown effect ${d.effect}`);
  if (!Number.isInteger(d.perLevel) || d.perLevel < 1) p.push(`${d.id}: perLevel must be a positive integer`);
  if (!Array.isArray(d.costs) || d.costs.length < 1) p.push(`${d.id}: needs at least one level`);
  else if (!d.costs.every((c, i) => Number.isInteger(c) && c > 0 && (i === 0 || c > d.costs[i - 1]))) {
    p.push(`${d.id}: costs must be positive integers rising level by level`);
  }
  return p;
}

/** The level owned of `id` in `levels` (`{ id: level }`), 0 if none. */
export const levelOf = (levels, id) => (levels && Object.hasOwn(levels, id) ? levels[id] : 0);

/** The highest level of an upgrade. */
export const maxLevel = (id) => UPGRADES[id].costs.length;

/** What the next level costs, or null at the maximum. */
export function nextCost(levels, id) {
  const n = levelOf(levels, id);
  return n < maxLevel(id) ? UPGRADES[id].costs[n] : null;
}

/** The effect of `level` levels of `id` (e.g. survivor 2 → 8). */
export const effectAt = (id, level) => UPGRADES[id].perLevel * level;

/** Every effect from the levels owned: `{ maxHealth, sight, stealth, gather }`. */
export function upgradeEffects(levels) {
  const out = { ...NO_EFFECTS };
  for (const id of UPGRADE_IDS) out[UPGRADES[id].effect] += effectAt(id, levelOf(levels, id));
  return out;
}

/** The effects for a game (`game.progress.upgrades`); none for a game without progress (tests, mirrors). */
export const effectsOf = (game) => upgradeEffects(game?.progress?.upgrades);
