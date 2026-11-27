/**
 * Text for enemies: readout notes about a visible enemy (health and intent),
 * the turn's enemy events, and refusals caused by an enemy. Pure; unit
 * tested, and mirrored by the browser check (tools/browser/check-world.mjs).
 */
import { ENEMY_TYPES } from '../data/enemies.js';
import { coordText } from './hud.js';
import { bearing } from './poiText.js';

const lower = (s) => s[0].toLowerCase() + s.slice(1);

/** What an intent (systems/enemies.js enemyIntent) looks like to the player. */
export const INTENT_TEXT = Object.freeze({
  idle: 'has not noticed you',
  approach: 'hunting you',
  charge: 'about to charge',
  attack: 'in striking range',
  return: 'heading back',
});

/** "Wolf · health 8/8 · hunting you". */
export function describeEnemy(enemy, intent) {
  const def = ENEMY_TYPES[enemy.type];
  return `${def.name} · health ${enemy.health}/${def.health} · ${INTENT_TEXT[intent]}`;
}

/** Suffix for a readout about a hex with a visible enemy: "" or " · <enemy>". */
export const enemyNote = (enemy, intent) => (enemy ? ` · ${describeEnemy(enemy, intent)}` : '');

/** Readout for tapping a hex with a visible enemy (no turn passes). */
export const describeEnemyHex = (label, enemy, intent) =>
  `${label} · ${describeEnemy(enemy, intent)} · ${ENEMY_TYPES[enemy.type].behaviour}`;

/** "the wolf" */
const the = (type) => `the ${lower(ENEMY_TYPES[type].name)}`;
const The = (type) => `The ${lower(ENEMY_TYPES[type].name)}`;

/** One enemy event (systems/enemies.js) as a short sentence. */
export function describeEnemyEvent(e) {
  switch (e.type) {
    case 'enemyDetected':
      return `A ${lower(ENEMY_TYPES[e.enemy].name)} has noticed you · ${bearing(e.from, e.at)}`;
    case 'enemyAttack': {
      let what = `${The(e.enemy)} attacks`;
      if (e.charge) what = `${The(e.enemy)} charges into you`;
      else if (e.parting) what = `${The(e.enemy)} strikes as you pull away`;
      // The AI's default stub (systems/enemies.js) deals no damage; the game uses real blows.
      if (e.stub) return `${what} (combat not implemented yet: no damage)`;
      if (e.health === undefined) return what;
      const notes = [e.guarded ? 'defended' : '', e.cover ? 'cover' : ''].filter(Boolean);
      return `${what}: ${e.damage} damage${notes.length ? ` (${notes.join(', ')})` : ''} · health ${e.health}/${e.maxHealth}`;
    }
    case 'enemyDisengaged':
      switch (e.reason) {
        case 'sanctuary': return `${The(e.enemy)} will not follow you into the sanctuary`;
        case 'territory': return `${The(e.enemy)} turns back to its ground`;
        default: return `${The(e.enemy)} gives up the chase`;
      }
    default:
      return String(e.type);
  }
}

/** A step refused because an enemy stands there. */
export const describeOccupied = (label, enemy) => `${label} · ${the(enemy.type)} is in the way`;

/** Travel stopped because an enemy stepped onto the route. */
export const describeRouteBlockedBy = (at, enemy, done) =>
  `Route blocked by ${the(enemy.type)} at ${coordText(at)} · stopped after ${done} ${done === 1 ? 'step' : 'steps'}`;
