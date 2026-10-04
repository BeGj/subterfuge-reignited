/**
 * Game constants. Values follow the official Subterfuge rulebook; see goal.md
 * for sources and the places where we deliberately deviate.
 *
 * All durations are in **game minutes** (integers). The server maps game time
 * to real time with a per-game time scale.
 */

export const MINUTE = 1;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The simulation resolves orders and events on 10-minute ticks. */
export const TICK = 10 * MINUTE;

/** Orders (launches, gifts) can be edited or cancelled for this long. */
export const LAUNCH_DELAY = 10 * MINUTE;

// --- Setup ---------------------------------------------------------------

export const STARTING_OUTPOSTS = 5;
/** Drillers on each starting outpost that does not hold the Queen. */
export const STARTING_DRILLERS = 40;
export const OUTPOSTS_PER_PLAYER = 10;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

// --- Production ----------------------------------------------------------

export const FACTORY_CYCLE = 8 * HOUR;
export const FACTORY_DRILLERS_PER_CYCLE = 6;

export const BASE_ELECTRICAL_OUTPUT = 150;
export const GENERATOR_ELECTRICAL_OUTPUT = 50;

// --- Shields -------------------------------------------------------------

export const WEAK_SHIELD_MAX = 10;
export const STRONG_SHIELD_MAX = 20;
/** Share of outposts with strong shields. Tunable; sources disagree (goal.md). */
export const STRONG_SHIELD_SHARE = 1 / 3;
/** Time for any shield to go from empty to full, regardless of its max. */
export const SHIELD_FULL_CHARGE_TIME = 48 * HOUR;

// --- Mining --------------------------------------------------------------

export const NEPTUNIUM_TO_WIN = 200;
/** Fraction of Neptunium lost when one of your mines is captured. */
export const MINE_LOSS_PENALTY = 0.2;

// --- Visibility ----------------------------------------------------------

/** Sonar range expressed as travel time at 1.0 speed. */
export const SONAR_RANGE_TRAVEL_TIME = 27 * HOUR;

// --- Funding -------------------------------------------------------------

export const FUNDING_MIN_NEPTUNIUM_GAP = 20;
export const FUNDING_ELECTRICAL_BONUS = 50;
export const FUNDING_DRILLERS_PER_CYCLE = 2;

// --- Specialists ---------------------------------------------------------

export const FIRST_HIRE_AT = 4 * HOUR;
export const HIRE_INTERVAL = 18 * HOUR;
export const QUEEN_SHIELD_BONUS = 20;

// --- Elimination ---------------------------------------------------------

export const INACTIVITY_AUTO_RESIGN = 48 * HOUR;
