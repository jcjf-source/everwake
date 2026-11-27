/**
 * Text for expeditions and the sanctuary (Task 12): the return button and
 * its refusals, expedition events, the expedition report, and the upgrade
 * list. Pure; unit tested, and mirrored by the browser check
 * (tools/browser/check-world.mjs).
 */
import { timeOf } from '../core/clock.js';
import { ENEMY_TYPES, ENEMY_TYPE_IDS } from '../data/enemies.js';
import { SLOTS } from '../data/items.js';
import { UPGRADES } from '../data/upgrades.js';
import { describeBundle, itemNoun } from './itemText.js';

const lower = (s) => s[0].toLowerCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ENEMY_PLURALS = Object.freeze({ wolf: 'wolves' });
const enemyNoun = (type, n) => {
  const name = lower(ENEMY_TYPES[type]?.name ?? type);
  return n === 1 ? name : ENEMY_PLURALS[type] ?? `${name}s`;
};

/** The context row's Return button (contextActions.js). */
export const returnButton = () => ({
  text: 'Return',
  where: 'end expedition',
  label: 'Return: end the expedition and rest at the sanctuary. Your pack is kept.',
});

/** Why returning was refused (no turn passes). */
export function describeReturnRefused(reason) {
  switch (reason) {
    case 'notAtSanctuary': return 'You can only end an expedition on sanctuary ground';
    case 'notStarted': return 'The expedition has not begun yet: set off first';
    case 'noExpedition': return 'No expedition under way: set out from the sanctuary';
    default: return `Cannot return (${reason})`;
  }
}

/** "2 wolves, 1 boar" (or "" for none). */
export function describeDefeated(defeated) {
  return ENEMY_TYPE_IDS.filter((t) => defeated[t] > 0).map((t) => `${defeated[t]} ${enemyNoun(t, defeated[t])}`).join(', ');
}

/** What a pack held: "short sword (worn), padded jerkin (worn), 3 stone" (or "" if nothing). */
export function describePack(pack) {
  const worn = SLOTS.filter((s) => pack.equipped[s]).map((s) => `${itemNoun(pack.equipped[s])} (worn)`);
  const carried = describeBundle(pack.items);
  return [...worn, ...(carried ? [carried] : [])].join(', ');
}

/** One expedition event as a short sentence, or null if it is not one. */
export function describeExpeditionEvent(e) {
  switch (e.type) {
    case 'returned': return `You return to the sanctuary · expedition ${e.number} ends`;
    case 'setOut': return `Expedition ${e.number} sets out from the sanctuary · health ${e.maxHealth} · sight ${e.sight}`;
    default: return null;
  }
}

/** "morning, day 1" */
const when = (turn) => { const t = timeOf(turn); return `${t.part}, day ${t.day}`; };

/** The report dialog's title. */
export const reportTitle = (r) => (r.outcome === 'defeated' ? `Expedition ${r.number} · fallen` : `Expedition ${r.number} · returned`);

/** The report's opening line: how it ended, and what that cost. */
export function reportSummary(r) {
  const turns = plural(r.turns, 'turn', 'turns');
  if (r.outcome === 'defeated') {
    const by = r.cause ? `The ${lower(ENEMY_TYPES[r.cause].name)} brought you down` : 'You were brought down';
    return `${by} after ${turns}. You wake at the sanctuary, wounds tended, but everything you carried and wore is lost. Your map, journal and insight remain.`;
  }
  return `You came back to the sanctuary after ${turns}. You keep your pack for the next expedition, along with your map, journal and insight.`;
}

/** The report's rows: `[{ key, label, value }]`. */
export function reportRows(r) {
  const pack = describePack(r.pack) || 'nothing';
  return [
    { key: 'distance', label: 'Distance', value: `${plural(r.steps, 'step', 'steps')} · farthest ${plural(r.farthest, 'hex', 'hexes')} from the sanctuary` },
    { key: 'time', label: 'Time', value: `${plural(r.turns, 'turn', 'turns')} · ${when(r.startTurn)} to ${when(r.endTurn)}` },
    { key: 'mapped', label: 'Hexes mapped', value: String(r.mapped) },
    { key: 'places', label: 'Places', value: `${r.places} discovered · ${r.explored} explored` },
    { key: 'gathered', label: 'Gathered', value: describeBundle(r.gathered) || 'nothing' },
    { key: 'found', label: 'Found', value: describeBundle(r.found) || 'nothing' },
    { key: 'enemies', label: 'Enemies defeated', value: describeDefeated(r.defeated) || 'none' },
    { key: 'ended', label: 'Ended', value: r.outcome === 'defeated' ? `fell to the ${r.cause ? lower(ENEMY_TYPES[r.cause].name) : 'wilds'}` : 'returned safely' },
    { key: 'pack', label: r.outcome === 'defeated' ? 'Lost' : 'Kept', value: pack },
  ];
}

/** "+37 insight · mapping 12, places 10, explored 6, enemies 9" */
export function describeInsight(i) {
  return `+${i.total} insight · mapping ${i.mapping}, places ${i.places}, explored ${i.explored}, enemies ${i.enemies}`;
}

/** "Insight 52" (the sanctuary's balance line). */
export const describeBalance = (insight) => `Insight ${insight}`;

/** An upgrade's effect at `amount`: "+4 maximum health", "+1 sight", … */
export function effectText(id, amount) {
  switch (UPGRADES[id].effect) {
    case 'maxHealth': return `+${amount} maximum health`;
    case 'sight': return `+${amount} sight radius`;
    case 'stealth': return `enemies notice you ${plural(amount, 'hex', 'hexes')} closer`;
    case 'gather': return `+${amount} per gather`;
    default: return `+${amount}`;
  }
}

/** One row of the upgrade list (progression.upgradeView): text for the row and its button. */
export function upgradeRow(u) {
  const level = `Level ${u.level}/${u.max}`;
  const now = u.level > 0 ? `Now ${effectText(u.id, u.now)}` : 'Not learned';
  const next = u.next === null ? 'fully learned' : `next: ${effectText(u.id, u.next)}`;
  let note = '';
  if (!u.check.ok) {
    if (u.check.reason === 'maxed') note = 'maximum';
    else if (u.check.reason === 'tooCostly') note = `need ${u.cost}`;
    else if (u.check.reason === 'onExpedition') note = 'at the sanctuary';
  }
  return {
    name: u.def.name,
    level,
    about: u.def.about,
    detail: `${now} · ${next}`,
    button: u.cost === null ? 'Learned' : `Learn · ${u.cost}`,
    label: u.cost === null
      ? `${u.def.name}: fully learned (${effectText(u.id, u.now)})`
      : `Learn ${u.def.name} level ${u.level + 1} for ${u.cost} insight: ${effectText(u.id, u.next)}`,
    note,
  };
}

/** Outcome of buying an upgrade (progression.buyUpgrade's event). */
export const describeUpgraded = (e) =>
  `${UPGRADES[e.id].name} level ${e.level}: ${effectText(e.id, e.level * UPGRADES[e.id].perLevel)}, from your next expedition · ${e.insight} insight left`;

/** Why an upgrade could not be bought. */
export function describeBuyRefused(reason, cost = null) {
  switch (reason) {
    case 'tooCostly': return `Not enough insight${cost !== null ? `: it costs ${cost}` : ''}`;
    case 'maxed': return 'Already fully learned';
    case 'onExpedition': return 'Upgrades are learned at the sanctuary between expeditions';
    default: return `Cannot learn that (${reason})`;
  }
}

/** The Set out button's text. */
export const setOutText = (number) => `Set out · expedition ${number}`;
