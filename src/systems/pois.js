/**
 * Points of interest: what is where (baseline plus world changes), discovery,
 * what is in reach, whether an interaction is allowed, and what it does.
 *
 * Discovery: a POI is discovered when its hex first becomes known, by sight
 * (the turn pipeline passes each step's newly seen hexes to `discoverIn`)
 * or by knowledge (a shrine maps the land around it). A `discovered` event
 * goes to the log and the journal, and sighting one interrupts travel.
 * Being discovered is therefore "its hex is mapped"; there is no separate
 * flag to keep in step.
 *
 * Interaction: one `interact` action (src/core/actions.js), one turn, from
 * the POI's hex or a neighbour (INTERACT_REACH, as for gathering). Each use
 * is recorded in the persistent world changes; a POI with no uses left is
 * searched / opened / read for good. What a use yields is fixed by the world
 * seed (poiPlacement.rollFind), not chosen at the time.
 *
 * Simulation only (no DOM).
 */
import { POI_TYPES } from '../data/pois.js';
import { rollFind } from '../world/poiPlacement.js';
import { hexDistance, hexNeighbor, DIRECTIONS } from '../world/hex.js';
import { addItem } from './inventory.js';

/** Hexes away from a POI that the player may use it from. */
export const INTERACT_REACH = 1;

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {{ at: Hex, poi: { q: number, r: number, type: string, name: string, uses: number },
 *   def: object, used: number, left: number }} PoiState
 */

/**
 * The POI at `h` as it is now, or null if there is none. Ignores fog: the
 * UI asks only about mapped hexes.
 * @returns {PoiState | null}
 */
export function poiState(game, h) {
  const poi = game.world.poiAt ? game.world.poiAt(h) : null;
  if (!poi) return null;
  const used = game.changes.poiUsesTaken(h);
  return { at: { q: poi.q, r: poi.r }, poi, def: POI_TYPES[poi.type], used, left: Math.max(0, poi.uses - used) };
}

/**
 * `discovered` events for the POIs on `hexes` (hexes that just became
 * known), nearest to the player first. Pure apart from reading state.
 * @returns {Array<{ type: 'discovered', at: Hex, poi: string, name: string, from: Hex }>}
 */
export function discoverIn(game, hexes) {
  if (!game.world.poiAt || hexes.length === 0) return [];
  const from = game.player.position;
  const found = [];
  for (const h of hexes) {
    const poi = game.world.poiAt(h);
    if (poi) found.push(poi);
  }
  found.sort((a, b) => hexDistance(a, from) - hexDistance(b, from) || a.r - b.r || a.q - b.q);
  return found.map((p) => ({ type: 'discovered', at: { q: p.q, r: p.r }, poi: p.type, name: p.name, from: { q: from.q, r: from.r } }));
}

/**
 * May the player use the POI at `at` now? Changes nothing. Reasons are
 * checked in this order, so nothing about an unmapped hex leaks.
 * @returns {{ ok: true, state: PoiState }
 *   | { ok: false, reason: 'outside' | 'unexplored' | 'noPoi' | 'tooFar' | 'spent' }}
 */
export function checkInteract(game, at) {
  if (!game.world.has(at)) return { ok: false, reason: 'outside' };
  if (!game.memory.isKnown(at)) return { ok: false, reason: 'unexplored' };
  const state = poiState(game, at);
  if (!state) return { ok: false, reason: 'noPoi' };
  if (hexDistance(game.player.position, at) > INTERACT_REACH) return { ok: false, reason: 'tooFar' };
  if (state.left <= 0) return { ok: false, reason: 'spent' };
  return { ok: true, state };
}

/**
 * Use the POI at `at` once (already validated): record the use, then apply
 * its effect. Finds go into the inventory; a shrine maps the land within its
 * reveal radius, which may discover more POIs (their events follow).
 * @returns {Array<object>} an `interacted` event, then any `discovered` ones:
 *   `{ type: 'interacted', at, poi, name, use, left, found?: { item: n }, revealed?: n }`
 */
export function interactWith(game, at) {
  const { poi, def, used } = poiState(game, at);
  game.changes.recordPoiUse(at, 1);
  const left = poiState(game, at).left;
  const event = { type: 'interacted', at: { q: at.q, r: at.r }, poi: poi.type, name: poi.name, use: used + 1, left };
  if (def.effect === 'finds') {
    const found = rollFind(game.world.seedNumber ?? 0, poi, used);
    for (const [id, n] of Object.entries(found)) addItem(game.player.inventory, id, n);
    event.found = found;
    return [event];
  }
  // 'reveal': knowledge of the land around the shrine.
  const { newly } = game.memory.reveal(at, def.revealRadius);
  event.revealed = newly.length;
  return [event, ...discoverIn(game, newly)];
}

/**
 * POIs the player can use right now, the own hex first, then the
 * neighbours in DIRECTIONS order (E, NE, NW, W, SW, SE).
 * @returns {Array<PoiState & { direction: number | null }>}
 */
export function interactOptions(game) {
  const out = [];
  const here = game.player.position;
  const candidates = [{ h: here, direction: null }, ...DIRECTIONS.map((_, i) => ({ h: hexNeighbor(here, i), direction: i }))];
  for (const { h, direction } of candidates) {
    if (!checkInteract(game, h).ok) continue;
    out.push({ ...poiState(game, h), direction });
  }
  return out;
}
