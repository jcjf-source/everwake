/**
 * Readout and status text for movement. Pure; unit tested, and mirrored by
 * the browser check (tools/browser/check-world.mjs).
 */
import { hexDistance } from '../world/hex.js';
import { coordText } from './hud.js';

export const MOVE_HINT = 'Tap a neighbouring hex to step, or a farther hex to plan a route.';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "Forest · q 3, r −2" (or "Sanctuary · …" on the sanctuary hex).
 * @param {{q:number,r:number}} h
 * @param {{ name: string } | null} terrain
 * @param {{q:number,r:number} | null} sanctuary
 */
export function placeLabel(h, terrain, sanctuary) {
  const name = sanctuary && hexDistance(h, sanctuary) === 0 ? 'Sanctuary' : terrain ? terrain.name : 'Hex';
  return `${name} · ${coordText(h)}`;
}

export const describePreview = (label, steps, cost) =>
  `Route to ${label} · ${plural(steps, 'step', 'steps')}, terrain cost ${cost} · tap it again to travel`;

export const describeImpassable = (label) => `${label} · impassable, no way through`;

// Routes cross mapped hexes only, so "cut off" may also mean "not mapped yet".
export const describeUnreachable = (label) => `${label} · no route: cut off by water, mountains or unmapped land`;

/** A hex the player has never seen: no terrain is named. */
export const describeUnexplored = (h) => `Unexplored · ${coordText(h)} · not on your map yet`;

/** Map dialog summary line. */
export const describeExplored = (known, total) =>
  `${plural(known, 'hex', 'hexes')} mapped of ${total} · ${Math.floor((known / total) * 100)}% explored`;

export const describeStepped = (label) => `Stepped to ${label}`;

export const describeTravelling = (label, done, total) =>
  `Travelling to ${label} · step ${done} of ${total} · tap to stop`;

export const describeArrived = (label, total) => `Arrived at ${label} · ${plural(total, 'step', 'steps')}`;

export const describeStopped = (label, done, total) =>
  `Stopped after ${done} of ${plural(total, 'step', 'steps')} · tap ${label} again to continue`;

export const describeBlocked = (at, done) =>
  `Route blocked at ${coordText(at)} · stopped after ${plural(done, 'step', 'steps')}`;

/** A reaction (an encounter, Task 09) interrupted travel after a step. */
export const describeInterrupted = (label, done, total) =>
  `Interrupted after ${done} of ${plural(total, 'step', 'steps')} · tap ${label} again to continue`;

/** Status line: where the player is (time is shown by the clock, clockText.js). */
export const describePlayer = (player) => `You · ${coordText(player.position)}`;
