/**
 * The contextual action row: what can be done right here, the button for
 * each option, and the action each one performs. Pure (no DOM); main.js
 * renders it through hud.showActions, and the browser check mirrors it.
 *
 * Order: combat first (attack each enemy beside you, defend, flee), then
 * consumables while hurt, then points of interest in reach, then resource
 * nodes in reach, and last Return (end the expedition) on sanctuary
 * ground once it has begun. Only valid options are offered, and each still goes
 * through the turn pipeline when pressed. Nothing is offered while
 * travelling (a tap stops travel first).
 */
import { attackOptions, checkDefend, checkFlee } from '../systems/combat.js';
import { useOptions } from '../systems/items.js';
import { interactOptions } from '../systems/pois.js';
import { gatherOptions } from '../systems/gathering.js';
import { combatButton } from './combatText.js';
import { gatherButton } from './gatherText.js';
import { interactButton } from './poiText.js';
import { checkReturn } from '../systems/expedition.js';
import { returnButton } from './expeditionText.js';

/**
 * @typedef {{ kind: 'attack' | 'defend' | 'flee' | 'use' | 'interact' | 'gather' | 'return', o: object }} ContextOption
 * @returns {ContextOption[]}
 */
export function contextOptions(game, { travelling = false } = {}) {
  if (travelling) return [];
  const options = attackOptions(game).map((o) => ({ kind: 'attack', o }));
  if (checkDefend(game).ok) options.push({ kind: 'defend', o: {} });
  const flee = checkFlee(game);
  if (flee.ok) options.push({ kind: 'flee', o: flee.target });
  return [
    ...options,
    ...useOptions(game).map((o) => ({ kind: 'use', o })),
    ...interactOptions(game).map((o) => ({ kind: 'interact', o })),
    ...gatherOptions(game).map((o) => ({ kind: 'gather', o })),
    ...(checkReturn(game).ok ? [{ kind: 'return', o: {} }] : []),
  ];
}

/** The HUD button (hud.showActions) for one option. */
export function buttonFor({ kind, o }) {
  switch (kind) {
    case 'gather': return { key: `g${o.at.q},${o.at.r}`, kind, resource: o.node.resource, ...gatherButton(o) };
    case 'interact': return { key: `p${o.at.q},${o.at.r}`, kind, poi: o.poi.type, ...interactButton(o) };
    case 'attack': return { key: `a${o.at.q},${o.at.r}`, kind, enemy: o.enemy.type, ...combatButton(kind, o) };
    case 'use': return { key: `u${o.item}`, kind, resource: o.item, ...combatButton(kind, o) };
    case 'return': return { key: kind, kind, ...returnButton() };
    default: return { key: kind, kind, ...combatButton(kind, o) };
  }
}

/** The action (core/actions.js) an option performs. */
export function actionFor({ kind, o }) {
  switch (kind) {
    case 'defend': return { type: 'defend' };
    case 'flee': return { type: 'flee' };
    case 'return': return { type: 'return' };
    case 'use': return { type: 'use', item: o.item };
    default: return { type: kind, at: o.at }; // attack, interact, gather
  }
}
