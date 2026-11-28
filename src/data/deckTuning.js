/**
 * Expedition deck tuning (G02; design: docs/EXPEDITION_DECK.md, decisions in
 * docs/gameplay/README.md). Every tuning number for the deck, the nightly
 * tick and threat lives here, so the playtest pass (G11) changes them in one
 * place. Rules live in the systems that read these values.
 *
 * Nothing reads the values marked with a later task yet. They are the
 * drafted values from the proposal, recorded now so that task doesn't add
 * its own constants.
 */

/** Cards each expedition starts with, by card id (data/movementCards.js). */
export const STARTING_DECK = Object.freeze({ walk: 8, trek: 2, climb: 1, forage: 1 });

/** Cards drawn at each dawn. */
export const HAND_SIZE = 5;

/** Stride costs of actions other than steps (G03). */
export const ACTION_COSTS = Object.freeze({ gather: 3, interact: 3 });

/** A step onto ground never walked costs terrain cost × this (G03). */
export const NEW_GROUND_MULTIPLIER = 2;

/** Chance of finding a card on the first step onto a hex (G06). */
export const FIND_CHANCE = 0.12;

/** The nightly tick (G05). */
export const NIGHT = Object.freeze({
  /** Food units eaten at supper (`food`, then `rations`; README decision 9). */
  supperFood: 1,
  /** Health lost when there is nothing to eat. */
  hungerDamage: 2,
  /** Cards fewer at the next dawn when Hungry. */
  hungryHandPenalty: 1,
  /** Weary cards added to the deck each night. */
  wearyPerNight: 1,
  /** Threat added each night. */
  threatPerNight: 1,
  /** Rest at camp: food it costs, cards fewer next dawn, Weary cards removed. */
  restFood: 2,
  restHandPenalty: 1,
  restWearyRemoved: 1,
});

/** Threat levels and night ambushes (G09). Drafts until G11. */
export const THREAT = Object.freeze({
  /** Threat 1+: enemies notice you from this many hexes further (capped at sight). */
  detectBonus: 1,
  /** Threat at which extra spawns appear each dawn beyond sight, and how many. */
  extraSpawnsFrom: 2,
  extraSpawnsPerDawn: 1,
  /** Threat at which wolves spawn in pairs and boars charge from further. */
  packsFrom: 3,
  boarChargeBonus: 1,
  /** Threat at which skeletons may leave their ruins. */
  skeletonsRoamFrom: 4,
  /** Above this threat, enemies get +1 damage per level. */
  damageAbove: 4,
  /** Night ambush chance by camp site (sanctuary, woods, open ground, beside ruins or caves). */
  ambushChance: Object.freeze({ none: 0, low: 0.1, normal: 0.2, high: 0.35 }),
  /** Added to the ambush chance per threat level (not on sanctuary ground). */
  ambushPerThreat: 0.05,
  /** The ambush chance never goes above this. */
  ambushMax: 0.9,
});
