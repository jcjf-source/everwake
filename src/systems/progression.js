/**
 * Permanent progression (Task 12): insight, the currency earned by
 * exploring, and the upgrades it buys at the sanctuary.
 *
 *   game.progress = { insight, upgrades: { id: level }, history: [report…] }
 *
 * *Player persistent state* (see "State model" in docs/TECHNICAL.md): it
 * survives death and every expedition, and is saved with the game
 * (systems/persistence.js). `history` holds
 * every finished expedition's report (systems/expedition.js), oldest first.
 *
 * Insight rewards discovery more than fighting: hexes newly mapped, places
 * discovered and explored, and only then enemies defeated (INSIGHT). An
 * expedition earns the same insight whether it ends in a return or a
 * defeat; what a defeat costs is the pack (systems/expedition.js).
 *
 * Upgrades are bought only between expeditions (at the sanctuary screen),
 * so they take effect from the next expedition's start. Their effects are
 * derived from the levels owned (data/upgrades.js `effectsOf`).
 * Simulation only (no DOM).
 */
import { UPGRADES, UPGRADE_IDS, levelOf, maxLevel, nextCost, effectAt } from '../data/upgrades.js';

/** Insight per thing achieved on an expedition. */
export const INSIGHT = Object.freeze({
  /** One insight per this many hexes first mapped (rounded down). */
  hexesPerPoint: 5,
  /** Per place (POI) discovered. */
  place: 5,
  /** Per use of a place (a search, an opened chest, a read shrine). */
  explored: 2,
  /** Per enemy defeated. */
  enemy: 3,
});

export function createProgress() {
  return { insight: 0, upgrades: {}, history: [] };
}

/**
 * The insight an expedition's tally earns:
 * `{ mapping, places, explored, enemies, total }`.
 * @param {{ mapped: number, places: number, explored: number, defeated: Record<string, number> }} t
 */
export function insightFor(t) {
  const kills = Object.values(t.defeated ?? {}).reduce((a, b) => a + b, 0);
  const out = {
    mapping: Math.floor(t.mapped / INSIGHT.hexesPerPoint),
    places: t.places * INSIGHT.place,
    explored: t.explored * INSIGHT.explored,
    enemies: kills * INSIGHT.enemy,
  };
  out.total = out.mapping + out.places + out.explored + out.enemies;
  return out;
}

/** Can the upgrade `id` be bought now? (changes nothing) */
export function checkBuy(game, id) {
  if (typeof id !== 'string' || !Object.hasOwn(UPGRADES, id)) return { ok: false, reason: 'unknownUpgrade' };
  if (game.expedition?.status === 'active') return { ok: false, reason: 'onExpedition' };
  const cost = nextCost(game.progress.upgrades, id);
  if (cost === null) return { ok: false, reason: 'maxed' };
  if (game.progress.insight < cost) return { ok: false, reason: 'tooCostly', cost };
  return { ok: true, cost };
}

/**
 * Buy the next level of `id`. Returns `{ ok: true, event }` with an
 * `upgraded { id, level, cost, insight }` event, or `{ ok: false, reason }`
 * having changed nothing.
 */
export function buyUpgrade(game, id) {
  const v = checkBuy(game, id);
  if (!v.ok) return v;
  const p = game.progress;
  p.insight -= v.cost;
  p.upgrades[id] = levelOf(p.upgrades, id) + 1;
  return { ok: true, event: { type: 'upgraded', id, level: p.upgrades[id], cost: v.cost, insight: p.insight } };
}

/**
 * The sanctuary's upgrade list: `[{ id, def, level, max, cost, now, next, check }]`
 * in UPGRADE_IDS order. `now`/`next` are the effect at the current and the
 * next level (`next` null at the maximum); `check` is checkBuy's answer.
 */
export function upgradeView(game) {
  const levels = game.progress.upgrades;
  return UPGRADE_IDS.map((id) => {
    const level = levelOf(levels, id);
    const max = maxLevel(id);
    return {
      id, def: UPGRADES[id], level, max, cost: nextCost(levels, id),
      now: effectAt(id, level), next: level < max ? effectAt(id, level + 1) : null,
      check: checkBuy(game, id),
    };
  });
}
