/**
 * Text for the world clock, the turn log, and action outcomes that are not
 * movement. Pure; unit tested, and mirrored by the browser check
 * (tools/browser/check-world.mjs).
 */
import { timeOf } from '../core/clock.js';
import { NODE_KINDS } from '../data/resources.js';
import { describeGathered } from './gatherText.js';
import { describeDiscovered, describeInteracted } from './poiText.js';
import { describeEnemyEvent } from './enemyText.js';
import { describeCombatEvent } from './combatText.js';
import { describeItemEvent } from './itemText.js';
import { describeExpeditionEvent } from './expeditionText.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Clock display: "Morning · day 1 · turn 0". */
export function describeClock(turn) {
  const t = timeOf(turn);
  return `${cap(t.part)} · day ${t.day} · turn ${turn}`;
}

/** One game event (see game.js) as a short sentence. */
export function describeEvent(e) {
  if (e.type === 'dayPart') {
    switch (e.part) {
      case 'morning': return `Day ${e.day} dawns`;
      case 'afternoon': return 'The sun passes noon';
      case 'evening': return 'Evening draws in';
      case 'night': return 'Night falls';
    }
  }
  if (e.type === 'gathered') return describeGathered(e, NODE_KINDS[e.kind]);
  if (e.type === 'discovered') return describeDiscovered(e);
  if (e.type === 'interacted') return describeInteracted(e);
  const trip = describeExpeditionEvent(e);
  if (trip !== null) return trip;
  const item = describeItemEvent(e);
  if (item !== null) return item;
  const combat = describeCombatEvent(e);
  if (combat !== null) return combat;
  if (e.type.startsWith('enemy')) return describeEnemyEvent(e);
  return String(e.type);
}

/** Append this turn's events to a readout line. */
export function withEvents(text, events) {
  if (!events || events.length === 0) return text;
  return [text, ...events.map(describeEvent)].join(' · ');
}

/** A turn's events as one readout line (the first is usually the action's own). */
export const describeEvents = (events) => events.map(describeEvent).join(' · ');

export const WAITED = 'You wait a turn';
