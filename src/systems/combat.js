/**
 * Combat (Task 10): the player's combat actions, how blows are resolved, and
 * what happens when health runs out.
 *
 * Encounters happen on the hex map, one turn at a time, through the normal
 * turn pipeline (core/game.js): the player acts, then every enemy reacts
 * (systems/enemies.js). There is no separate combat mode and nothing happens
 * while idle.
 *
 * Blows are deterministic, so a fight can be read and planned:
 *   damage = max(1, attack + charge bonus − (defense + cover + defend bonus))
 *  - cover: the defender's terrain (data/terrain.js `cover`: forest 1,
 *    dense forest 2) helps player and enemy alike;
 *  - Defend: +DEFEND_BONUS defense against every blow that turn;
 *  - a boar's charge adds CHARGE_BONUS.
 *
 * Player actions (validated here, run by core/actions.js; one turn each):
 *  - attack an enemy in sight next to you (not from sanctuary ground);
 *  - defend while an enemy in sight is hunting you;
 *  - flee while a hunting enemy is beside you: step to the neighbour farthest
 *    from the enemies in sight (ties: nearer the sanctuary, cheaper ground,
 *    then DIRECTIONS order). The enemies fled from lose their turn, and there
 *    is no parting strike (a plain step away gives one: systems/enemies.js);
 * Using items and changing equipment are in systems/items.js.
 * Invalid actions are refused with a reason and cost nothing.
 *
 * Health: at 0 the player is defeated. The condition reaction (registered
 * after the enemies) carries them back to the sanctuary with health
 * restored; enemies hunting them lose them and head home. Carried items are
 * kept for now: Task 12 decides what a defeat costs and adds the expedition
 * report. Ending a turn on sanctuary ground (the ward) restores
 * SANCTUARY_RECOVERY health.
 *
 * Simulation only (no DOM).
 */
import { ENEMY_TYPES } from '../data/enemies.js';
import { TERRAIN } from '../data/terrain.js';
import { PLAYER_BASE } from '../entities/player.js';
import { DIRECTIONS, hexAdd, hexDistance } from '../world/hex.js';
import { createEnemyReaction, inSanctuaryWard } from './enemies.js';
import { addItems, equipmentBonus } from './inventory.js';
import { rollLoot } from '../world/enemyPlacement.js';

/** How far the player can strike (adjacent). */
export const PLAYER_REACH = 1;
/** Extra defense for the turn the player defends. */
export const DEFEND_BONUS = 2;
/** Extra attack for a charge. */
export const CHARGE_BONUS = 2;
/** Health restored for each turn ended on sanctuary ground. */
export const SANCTUARY_RECOVERY = 2;

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {import('./enemies.js').Enemy} Enemy
 */

/** The player's attack and defense: base stats plus what is worn (Task 11). */
export function playerStats(player) {
  const bonus = equipmentBonus(player.inventory);
  return { attack: PLAYER_BASE.attack + bonus.attack, defense: PLAYER_BASE.defense + bonus.defense, maxHealth: player.maxHealth };
}

/** Defense the terrain at `h` gives whoever stands there. */
export function coverAt(world, h) {
  const t = world.tileAt(h);
  return t ? TERRAIN[t.terrain].cover ?? 0 : 0;
}

/** One blow. */
export const damageOf = (attack, defense) => Math.max(1, attack - defense);

/** What the player's blow on `enemy` would deal: `{ damage, cover }`. */
export function playerBlow(game, enemy) {
  const cover = coverAt(game.world, enemy.position);
  return { damage: damageOf(playerStats(game.player).attack, ENEMY_TYPES[enemy.type].defense + cover), cover };
}

/** What `enemy`'s blow on the player would deal: `{ damage, cover }`. */
export function enemyBlow(game, enemy, { charge = false, guarded = false } = {}) {
  const cover = coverAt(game.world, game.player.position);
  const attack = ENEMY_TYPES[enemy.type].attack + (charge ? CHARGE_BONUS : 0);
  const defense = playerStats(game.player).defense + cover + (guarded ? DEFEND_BONUS : 0);
  return { damage: damageOf(attack, defense), cover };
}

const copy = (h) => ({ q: h.q, r: h.r });
const living = (game) => (game.enemies ? game.enemies.list.filter((e) => e.health > 0) : []);
/** Living enemies on hexes the player can see. */
const inSight = (game) => living(game).filter((e) => game.memory.isVisible(e.position));

/** Enemies in sight that are hunting the player. */
export const threats = (game) => inSight(game).filter((e) => e.mode === 'hunting');

/** Hunting enemies within striking reach of `at` (default: the player's hex). */
export function engagedEnemies(game, at = game.player.position) {
  return living(game).filter((e) => e.mode === 'hunting' && hexDistance(e.position, at) <= ENEMY_TYPES[e.type].attackRange);
}

// ---------------------------------------------------------------- attack

/** Can the player strike the hex `at` now? (changes nothing) */
export function checkAttack(game, at) {
  if (!game.world.has(at)) return { ok: false, reason: 'outside' };
  const enemy = game.memory.isVisible(at) ? game.enemies?.at(at) : null;
  if (!enemy) return { ok: false, reason: 'noEnemy' };
  if (hexDistance(at, game.player.position) > PLAYER_REACH) return { ok: false, reason: 'tooFar' };
  if (inSanctuaryWard(game.world, game.player.position)) return { ok: false, reason: 'sanctuary' };
  return { ok: true, enemy };
}

/**
 * Strike the enemy at `at` (validated). An unaware or retreating enemy turns
 * to fight. One that falls leaves its loot (enemyPlacement.rollLoot), which
 * goes straight into the inventory.
 */
export function attackEnemy(game, at) {
  const enemy = game.enemies.at(at);
  const def = ENEMY_TYPES[enemy.type];
  const { damage, cover } = playerBlow(game, enemy);
  enemy.health = Math.max(0, enemy.health - damage);
  const where = copy(enemy.position);
  const events = [{
    type: 'playerAttack', id: enemy.id, enemy: enemy.type, at: where, damage, cover, health: enemy.health, maxHealth: def.health,
  }];
  if (enemy.health === 0) {
    game.enemies.kill(enemy);
    const loot = rollLoot(game.world.seedNumber ?? 0, enemy);
    addItems(game.player.inventory, loot);
    events.push({ type: 'enemyDefeated', id: enemy.id, enemy: enemy.type, at: where, loot });
  } else {
    enemy.mode = 'hunting';
  }
  return events;
}

/** Enemies the player can strike now: `[{ at, enemy, direction, damage, cover }]` in DIRECTIONS order. */
export function attackOptions(game) {
  if (inSanctuaryWard(game.world, game.player.position)) return [];
  const out = [];
  DIRECTIONS.forEach((d, direction) => {
    const at = hexAdd(game.player.position, d);
    const v = game.world.has(at) ? checkAttack(game, at) : null;
    if (v && v.ok) out.push({ at, enemy: v.enemy, direction, ...playerBlow(game, v.enemy) });
  });
  return out;
}

// ---------------------------------------------------------------- defend

export function checkDefend(game) {
  return threats(game).length ? { ok: true } : { ok: false, reason: 'noThreat' };
}

export const defend = () => [{ type: 'defended', bonus: DEFEND_BONUS }];

// ---------------------------------------------------------------- flee

/**
 * Where fleeing would take the player now: `{ to, direction, enemies }`, or
 * null if no neighbour is clear of every enemy in sight (cornered).
 * Only enemies in sight count, so nothing leaks through fog.
 */
export function fleeTarget(game) {
  const p = game.player.position;
  const foes = inSight(game);
  const home = game.world.sanctuary;
  const options = [];
  DIRECTIONS.forEach((d, direction) => {
    const to = hexAdd(p, d);
    if (!game.world.has(to) || !game.world.isWalkable(to) || game.enemies?.at(to)) return;
    const near = foes.length ? Math.min(...foes.map((e) => hexDistance(to, e.position))) : Infinity;
    if (near < 2) return;
    const cost = TERRAIN[game.world.tileAt(to).terrain].moveCost;
    options.push({ to, direction, near, home: home ? hexDistance(to, home) : 0, cost });
  });
  options.sort((a, b) => b.near - a.near || a.home - b.home || a.cost - b.cost || a.direction - b.direction);
  return options.length ? { to: options[0].to, direction: options[0].direction } : null;
}

export function checkFlee(game) {
  if (engagedEnemies(game).length === 0) return { ok: false, reason: 'notEngaged' };
  const target = fleeTarget(game);
  return target ? { ok: true, target } : { ok: false, reason: 'cornered' };
}

/** Break away (validated): step to the flee target. */
export function flee(game) {
  const enemies = engagedEnemies(game).map((e) => e.type);
  const { to, direction } = fleeTarget(game);
  game.player.position = copy(to);
  return [{ type: 'fled', at: copy(to), direction, enemies }];
}

// ---------------------------------------------------------------- enemy blows and defeat

/**
 * The combat handoff for the enemy AI (systems/enemies.js): `enemy` strikes
 * the player. Defending this turn (`action.type === 'defend'`) and cover on
 * the player's hex reduce the blow; a charge adds to it.
 */
export function enemyStrike(game, enemy, { charge = false, parting = false, action = null } = {}) {
  const guarded = action?.type === 'defend';
  const { damage, cover } = enemyBlow(game, enemy, { charge, guarded });
  const p = game.player;
  p.health = Math.max(0, p.health - damage);
  return [{
    type: 'enemyAttack', id: enemy.id, enemy: enemy.type, at: copy(enemy.position),
    charge, parting, guarded, cover, damage, health: p.health, maxHealth: p.maxHealth,
  }];
}

/**
 * Defeat: the player is carried back to the sanctuary with health restored,
 * and every enemy hunting them loses them and heads home. `by` is the blow
 * that felled them, if known.
 */
export function defeat(game, by = null) {
  const p = game.player;
  const at = copy(p.position);
  p.position = copy(game.world.sanctuary);
  p.health = p.maxHealth;
  for (const e of living(game)) if (e.mode === 'hunting') e.mode = 'returning';
  return { type: 'defeated', at, id: by ? by.id : null, enemy: by ? by.enemy : null };
}

/**
 * The player's condition after the enemies have acted (register after the
 * enemy reaction): defeat at 0 health (interrupts travel), otherwise
 * recovery on sanctuary ground.
 */
export function createConditionReaction() {
  return function condition(game, { events = [] } = {}) {
    const p = game.player;
    if (p.health <= 0) {
      const by = [...events].reverse().find((e) => e.type === 'enemyAttack') ?? null;
      return { events: [defeat(game, by)], interrupt: { reason: 'defeat' } };
    }
    if (p.health < p.maxHealth && inSanctuaryWard(game.world, p.position)) {
      const amount = Math.min(SANCTUARY_RECOVERY, p.maxHealth - p.health);
      p.health += amount;
      return { events: [{ type: 'recovered', amount, health: p.health, maxHealth: p.maxHealth }] };
    }
    return undefined;
  };
}

/** The reactions the game registers, in order: enemies (with real blows), then the player's condition. */
export const createCombatReactions = () => [createEnemyReaction({ attack: enemyStrike }), createConditionReaction()];
