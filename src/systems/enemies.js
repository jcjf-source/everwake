/**
 * Enemies: the live roster (where each one is, its health and what it is
 * doing) and the AI that runs as a turn-pipeline reaction.
 *
 * The roster starts from the world's generated spawns (enemyPlacement.js)
 * and is *live world state*: positions and modes change as the player acts.
 * It is not saved yet (Task 13 decides how much of it persists). Between
 * expeditions the survivors go home healed (`reset`); the fallen stay fallen.
 *
 * AI (deterministic; every enemy acts once per player action, in id order,
 * after the player and the clock, and never while the game is idle):
 *  - idle: stands at home. Notices the player within `detectRange` (hex
 *    distance; never more than the player's sight radius, so the enemy is in
 *    sight when it does): it starts hunting, which interrupts travel.
 *  - hunting: gives up (→ returning) when the player is farther than
 *    `leashRange`, beyond its `territory` from home, or inside the
 *    sanctuary ward. Otherwise it attacks when within `attackRange`, else
 *    closes in: one hex per move along an A* path over walkable terrain that
 *    avoids other enemies, the player and the ward. A charger (boar) at
 *    exactly `charge` hexes along a straight hex line with clear ground
 *    dashes beside the player and attacks in the same turn.
 *  - returning: walks home one hex per move, becoming idle there; noticing
 *    the player again on the way turns it back to hunting.
 * Slow enemies (`moveEvery` 2) move only on even turns; attacks are never
 * slowed.
 *
 * Breaking off (Task 10): a hunting enemy that was within reach of the player
 * before the action keeps them honest:
 *  - a plain `move` out of its reach gives it a parting strike (it attacks
 *    as the player pulls away, and does not move that turn);
 *  - `flee` (systems/combat.js) breaks away cleanly: no parting strike, and
 *    the enemies fled from lose that turn (no move, no attack).
 * Once the player is defeated, no further enemy acts that turn.
 *
 * Attacks are a handoff to combat: the reaction calls `attack(game, enemy,
 * { charge, parting, action })` and appends the events it returns. The game
 * passes the real one (systems/combat.js `enemyStrike`); the default
 * `stubAttack` reports the attack and changes nothing, which keeps AI tests
 * independent of damage.
 *
 * Enemies never enter the sanctuary or its neighbours (SANCTUARY_WARD), and
 * occupy hexes: no two enemies share one, and none shares the player's.
 *
 * Simulation only (no DOM).
 */
import { ENEMY_TYPES } from '../data/enemies.js';
import { TERRAIN } from '../data/terrain.js';
import { DIRECTIONS, hexAdd, hexDistance, hexEquals, hexKey } from '../world/hex.js';
import { findPath } from '../world/pathfinding.js';
import { effectsOf } from '../data/upgrades.js';

/** Hexes closer than this to the sanctuary are warded: no enemy enters, and none hunts you there. */
export const SANCTUARY_WARD = 2;
/** A* node budget for one enemy's step (chases are short; this bounds the cost per turn). */
export const PATH_LIMIT = 400;

/**
 * @typedef {{ q: number, r: number }} Hex
 * @typedef {'idle' | 'hunting' | 'returning'} EnemyMode
 * @typedef {{ id: number, type: string, home: Hex, position: Hex, health: number, mode: EnemyMode }} Enemy
 * @typedef {'idle' | 'approach' | 'charge' | 'attack' | 'return'} EnemyIntent
 */

/**
 * The live roster, from generated spawns `[{ id, type, q, r }]`.
 * Positions change only through `moveTo`, which keeps the hex index in step.
 */
export function createEnemies(spawns = []) {
  /** @type {Enemy[]} */
  const list = [];
  const byHex = new Map();
  let nextId = 0;

  function add(type, at, id = nextId) {
    const def = ENEMY_TYPES[type];
    if (!def) throw new Error(`unknown enemy type ${type}`);
    if (byHex.has(hexKey(at))) throw new Error(`hex ${hexKey(at)} is already occupied`);
    const e = { id, type, home: { q: at.q, r: at.r }, position: { q: at.q, r: at.r }, health: def.health, mode: 'idle' };
    list.push(e);
    byHex.set(hexKey(at), e);
    nextId = Math.max(nextId, id + 1);
    return e;
  }
  for (const s of spawns) add(s.type, s, s.id);

  return {
    /** Every enemy, in id order. */
    list,
    /** The living enemy standing on `h`, or null. */
    at(h) {
      const e = h ? byHex.get(hexKey(h)) : null;
      return e && e.health > 0 ? e : null;
    },
    /** Place a new enemy (tests and later spawns). */
    add,
    /** Mark `enemy` dead (health 0) and free its hex. */
    kill(enemy) {
      enemy.health = 0;
      if (byHex.get(hexKey(enemy.position)) === enemy) byHex.delete(hexKey(enemy.position));
    },
    /**
     * Between expeditions (systems/expedition.js): every living enemy goes
     * back home, healed and unaware. Fallen enemies stay fallen.
     */
    reset() {
      byHex.clear();
      for (const e of list) {
        if (e.health <= 0) continue;
        e.position = { q: e.home.q, r: e.home.r };
        e.health = ENEMY_TYPES[e.type].health;
        e.mode = 'idle';
        byHex.set(hexKey(e.position), e);
      }
    },
    /** Move `enemy` to `h` (no rules checked here; the AI checks them). */
    moveTo(enemy, h) {
      byHex.delete(hexKey(enemy.position));
      enemy.position = { q: h.q, r: h.r };
      byHex.set(hexKey(h), enemy);
    },
  };
}

/** Is `h` on the sanctuary's warded ground (the sanctuary and its six neighbours)? */
export const inSanctuaryWard = (world, h) => hexDistance(h, world.sanctuary) < SANCTUARY_WARD;
const inWard = (game, h) => inSanctuaryWard(game.world, h);

/** Can `enemy` stand on `h` right now? (on the map, walkable, empty, outside the ward) */
function canEnter(game, enemy, h) {
  if (!game.world.has(h) || !game.world.isWalkable(h) || inWard(game, h)) return false;
  if (hexEquals(h, game.player.position)) return false;
  const other = game.enemies.at(h);
  return !other || other === enemy;
}

/** The direction index if `to` lies on a straight hex line from `from`, else -1. */
function lineDirection(from, to) {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const n = hexDistance(from, to);
  if (n === 0) return -1;
  return DIRECTIONS.findIndex((d) => d.q * n === dq && d.r * n === dr);
}

/** The hexes a charger would dash through (ending beside the player), or null if it cannot charge now. */
export function chargePath(game, enemy) {
  const def = ENEMY_TYPES[enemy.type];
  if (!def.charge || enemy.mode !== 'hunting') return null;
  const p = game.player.position;
  if (hexDistance(enemy.position, p) !== def.charge) return null;
  const dir = lineDirection(enemy.position, p);
  if (dir < 0) return null;
  const path = [];
  let h = enemy.position;
  for (let i = 1; i < def.charge; i++) {
    h = hexAdd(h, DIRECTIONS[dir]);
    if (!canEnter(game, enemy, h)) return null;
    path.push(h);
  }
  return path;
}

/** The next hex on a walkable route from the enemy toward `goal`, or null (no route, or the next hex is the goal and occupied). */
function stepToward(game, enemy, goal) {
  const costOf = (h) => {
    if (hexEquals(h, goal)) {
      const t = game.world.tileAt(h);
      return t ? TERRAIN[t.terrain].moveCost : Infinity;
    }
    if (!canEnter(game, enemy, h)) return Infinity;
    return TERRAIN[game.world.tileAt(h).terrain].moveCost;
  };
  const route = findPath(enemy.position, goal, { costOf, maxExpanded: PATH_LIMIT });
  if (!route.found || route.path.length < 2) return null;
  const next = route.path[1];
  return canEnter(game, enemy, next) ? next : null;
}

/**
 * What `enemy` means to do next, as the player sees it (for the readout and
 * the intent marker). Derived from mode and positions; not stored.
 * @returns {EnemyIntent}
 */
export function enemyIntent(game, enemy) {
  if (enemy.mode === 'idle') return 'idle';
  if (enemy.mode === 'returning') return 'return';
  const def = ENEMY_TYPES[enemy.type];
  if (hexDistance(enemy.position, game.player.position) <= def.attackRange) return 'attack';
  if (chargePath(game, enemy)) return 'charge';
  return 'approach';
}

/**
 * Combat handoff used until Task 10: the attack is reported and nothing
 * changes (no damage is dealt).
 */
export function stubAttack(game, enemy, { charge = false } = {}) {
  return [{
    type: 'enemyAttack', id: enemy.id, enemy: enemy.type,
    at: { q: enemy.position.q, r: enemy.position.r }, charge, damage: 0, stub: true,
  }];
}

/** Why a hunting enemy should give up now, or null. */
function giveUpReason(game, enemy) {
  const def = ENEMY_TYPES[enemy.type];
  const p = game.player.position;
  if (inWard(game, p)) return 'sanctuary';
  if (hexDistance(enemy.position, p) > def.leashRange) return 'distance';
  if (def.territory && hexDistance(enemy.home, p) > def.territory) return 'territory';
  return null;
}

/**
 * How close the player must be for `enemy` to notice them: its archetype's
 * range, less the Pathfinder upgrade (Task 12), never below 1.
 */
export const detectRangeOf = (game, enemy) => Math.max(1, ENEMY_TYPES[enemy.type].detectRange - effectsOf(game).stealth);

const notices = (game, enemy) => !inWard(game, game.player.position)
  && hexDistance(enemy.position, game.player.position) <= detectRangeOf(game, enemy)
  && !giveUpReason(game, enemy);

/** One enemy's turn. @returns {{ events: object[], interrupt: boolean }} */
function actEnemy(game, enemy, { turn, action = null, from = null }, attack) {
  const def = ENEMY_TYPES[enemy.type];
  const events = [];
  // Was it already hunting, within reach of where the player stood before acting?
  const wasEngaged = enemy.mode === 'hunting' && !!from && hexDistance(enemy.position, from) <= def.attackRange;
  let detected = false;
  let interrupt = false;
  const moves = turn % def.moveEvery === 0;
  const where = () => ({ q: enemy.position.q, r: enemy.position.r });

  if (enemy.mode !== 'hunting' && notices(game, enemy)) {
    enemy.mode = 'hunting';
    detected = true;
    interrupt = true;
  }

  if (enemy.mode === 'hunting') {
    const reason = giveUpReason(game, enemy);
    if (reason) {
      enemy.mode = 'returning';
      events.push({ type: 'enemyDisengaged', id: enemy.id, enemy: enemy.type, at: where(), reason });
    } else if (wasEngaged && action?.type === 'flee') {
      // Thrown off by a clean break: it loses this turn.
    } else if (hexDistance(enemy.position, game.player.position) <= def.attackRange) {
      events.push(...attack(game, enemy, { charge: false, parting: false, action }));
      interrupt = true;
    } else if (wasEngaged && action?.type === 'move') {
      // The player walked out of reach: it strikes as they pull away.
      events.push(...attack(game, enemy, { charge: false, parting: true, action }));
      interrupt = true;
    } else if (moves) {
      const dash = chargePath(game, enemy);
      if (dash) {
        game.enemies.moveTo(enemy, dash[dash.length - 1]);
        events.push(...attack(game, enemy, { charge: true, parting: false, action }));
        interrupt = true;
      } else {
        const next = stepToward(game, enemy, game.player.position);
        if (next) game.enemies.moveTo(enemy, next);
      }
    }
  } else if (enemy.mode === 'returning' && moves) {
    if (hexEquals(enemy.position, enemy.home)) enemy.mode = 'idle';
    else {
      const next = stepToward(game, enemy, enemy.home);
      if (next) game.enemies.moveTo(enemy, next);
      if (hexEquals(enemy.position, enemy.home)) enemy.mode = 'idle';
    }
  }

  if (detected) {
    const p = game.player.position;
    events.unshift({ type: 'enemyDetected', id: enemy.id, enemy: enemy.type, at: where(), from: { q: p.q, r: p.r } });
  }
  return { events, interrupt };
}

/**
 * The enemy reaction for the turn pipeline (core/game.js): every enemy acts
 * once, in id order. Being noticed or attacked interrupts travel.
 * @param {{ attack?: (game: object, enemy: Enemy, opts: { charge: boolean, parting: boolean, action: object | null }) => object[] }} [opts]
 *   `attack`: the combat handoff (default `stubAttack`; the game uses systems/combat.js `enemyStrike`).
 */
export function createEnemyReaction({ attack = stubAttack } = {}) {
  return function enemiesReact(game, ctx) {
    if (!game.enemies) return undefined;
    const events = [];
    let interrupt = false;
    for (const enemy of game.enemies.list) {
      if (game.player.health <= 0) break; // defeated: the fight is over (systems/combat.js)
      if (enemy.health <= 0) continue;
      const out = actEnemy(game, enemy, ctx, attack);
      events.push(...out.events);
      interrupt = interrupt || out.interrupt;
    }
    return { events, interrupt: interrupt ? { reason: 'enemy' } : null };
  };
}
