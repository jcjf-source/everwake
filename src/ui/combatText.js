/**
 * Text for combat: the player's combat events, refusals, the combat buttons
 * and the health line. Pure; unit tested, and mirrored by the browser check
 * (tools/browser/check-world.mjs). Enemy blows are worded in enemyText.js.
 */
import { ENEMY_TYPES } from '../data/enemies.js';
import { DEFEND_BONUS } from '../systems/combat.js';
import { DIRECTION_ARROWS, DIRECTION_NAMES } from './gatherText.js';
import { describeBundle, describeItemRefused, itemNoun } from './itemText.js';

const lower = (s) => s[0].toLowerCase() + s.slice(1);
const nameOf = (type) => lower(ENEMY_TYPES[type].name);

/** "Health 18/24" (the health line). */
export const describeHealth = (health, max) => `Health ${health}/${max}`;

/** A list of enemy types as words: "the wolf", "the wolf and the boar". */
function theFoes(types) {
  const names = types.map((t) => `the ${nameOf(t)}`);
  if (names.length <= 1) return names[0] ?? 'the enemy';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One combat event (systems/combat.js) as a short sentence, or null if it is not one. */
export function describeCombatEvent(e) {
  switch (e.type) {
    case 'playerAttack':
      return `You strike the ${nameOf(e.enemy)} for ${e.damage}${e.cover ? ' (it has cover)' : ''} · ${nameOf(e.enemy)} ${e.health}/${e.maxHealth}`;
    case 'enemyDefeated': {
      const loot = e.loot ? describeBundle(e.loot) : '';
      return `The ${nameOf(e.enemy)} falls${loot ? ` · you take ${loot}` : ''}`;
    }
    case 'defended':
      return `You brace yourself (+${e.bonus} defense this turn)`;
    case 'fled':
      return `You break away from ${theFoes(e.enemies)} to the ${DIRECTION_NAMES[e.direction]}`;
    case 'recovered':
      return `The sanctuary's calm restores ${e.amount} health · ${e.health}/${e.maxHealth}`;
    case 'defeated':
      return e.enemy
        ? `You fall to the ${nameOf(e.enemy)} · you wake at the sanctuary, wounds tended, your pack lost`
        : 'You fall · you wake at the sanctuary, wounds tended, your pack lost';
    default:
      return null;
  }
}

/** Why a combat action was refused (no turn passes). */
export function describeCombatRefused(kind, reason, label = '') {
  const at = label ? `${label} · ` : '';
  switch (`${kind}:${reason}`) {
    case 'attack:noEnemy': return `${at}no enemy there to strike`;
    case 'attack:tooFar': return `${at}too far to strike: stand next to it`;
    case 'attack:sanctuary': return `${at}no fighting from sanctuary ground: step out to strike`;
    case 'defend:noThreat': return 'Nothing in sight is hunting you: no need to defend';
    case 'flee:notEngaged': return 'No enemy beside you to flee from';
    case 'flee:cornered': return 'Nowhere to flee: every way out is blocked or watched';
    default:
      if (kind === 'use') return describeItemRefused(kind, reason); return `${at}cannot ${kind} (${reason})`;
  }
}

/**
 * Button text and accessible name for one combat option (main.js
 * contextOptions): `{ kind: 'attack' | 'defend' | 'flee' | 'use', o }`.
 */
export function combatButton(kind, o) {
  switch (kind) {
    case 'attack': {
      const n = nameOf(o.enemy.type);
      const def = ENEMY_TYPES[o.enemy.type];
      return {
        text: `Attack ${n}`,
        where: `${DIRECTION_ARROWS[o.direction]} ${o.damage}`,
        label: `Attack the ${n} to the ${DIRECTION_NAMES[o.direction]}: ${o.damage} damage${o.cover ? ' (it has cover)' : ''}, ${n} health ${o.enemy.health}/${def.health}`,
      };
    }
    case 'defend':
      return { text: 'Defend', where: `+${DEFEND_BONUS}`, label: `Defend: +${DEFEND_BONUS} defense against blows this turn` };
    case 'flee':
      return {
        text: 'Flee',
        where: DIRECTION_ARROWS[o.direction],
        label: `Flee to the ${DIRECTION_NAMES[o.direction]}: break away without a parting strike`,
      };
    case 'use':
      return {
        text: `${o.def.verb} ${itemNoun(o.item)}`,
        where: `+${o.heal}`,
        label: `${o.def.verb} ${itemNoun(o.item)}: +${o.heal} health (${o.count} carried)`,
      };
    default:
      return { text: kind, where: '', label: kind };
  }
}
