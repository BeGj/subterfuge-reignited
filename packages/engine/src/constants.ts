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

/**
 * Version of the game rules: map generation plus simulation. A running game
 * is rebuilt by replaying its orders, so it must replay under the exact rules
 * it started with. **Bump this whenever a change alters what `generateMap` or
 * `advance` produce for the same input** (CLAUDE.md). The server stores it on
 * each game at start and ends games whose version doesn't match instead of
 * replaying them wrongly.
 *
 * History:
 * - 1: constant-area maps, simultaneous production, draws, resign.
 * - 2: disabling a shield drops it to 0 and stops charging; capture re-enables it.
 * - 3: hiring, promotion and specialist effects (docs/specialists.md).
 */
export const RULES_VERSION = 3;

/** The simulation resolves orders and events on 10-minute ticks. */
export const TICK = 10 * MINUTE;

/** Orders (launches, gifts) can be edited or cancelled for this long. */
export const LAUNCH_DELAY = 10 * MINUTE;

/**
 * Other players see your launch order this long before it executes (if they
 * could see the sub once launched). An immediate launch is always inside this
 * window, so a launch can be spotted, and reacted to, while it's still
 * cancellable. Scheduled launches stay secret until they get this close.
 */
export const IMMINENT_LAUNCH_WINDOW = LAUNCH_DELAY + TICK;

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
/**
 * Neptunium is stored as integer units: 1 kg = one day's worth of minutes.
 * Each mine adds (outposts owned) units per minute, i.e. 1 kg/day per outpost.
 */
export const NEPTUNIUM_UNIT = DAY;
/** Fraction of Neptunium lost when one of your mines is captured. */
export const MINE_LOSS_PENALTY = 0.2;

// --- Movement & visibility -----------------------------------------------

/** Map units a sub travels per game minute at 1.0 speed. */
export const SUB_SPEED = 1;

/** Sonar range expressed as travel time at 1.0 speed. */
export const SONAR_RANGE_TRAVEL_TIME = 27 * HOUR;
/** Sonar range in map units. */
export const SONAR_RANGE = SONAR_RANGE_TRAVEL_TIME * SUB_SPEED;

// --- Funding -------------------------------------------------------------

export const FUNDING_MIN_NEPTUNIUM_GAP = 20;
export const FUNDING_ELECTRICAL_BONUS = 50;
export const FUNDING_DRILLERS_PER_CYCLE = 2;

// --- Specialists ---------------------------------------------------------

export const FIRST_HIRE_AT = 4 * HOUR;
export const HIRE_INTERVAL = 18 * HOUR;
/** Copies of every hireable specialist in a category's deck. */
export const HIRE_DECK_COPIES = 3;
export const QUEEN_SHIELD_BONUS = 20;
/** Security Chief: everywhere, plus this much again at her own outpost. */
export const SECURITY_CHIEF_SHIELD_BONUS = 10;
/** King: this much less everywhere, except at his own outpost, where he adds it. */
export const KING_SHIELD_DELTA = -20;
/** Princess sonar at her outpost; Intelligence Officer sonar everywhere. */
export const PRINCESS_SONAR_MULTIPLIER = 1.5;
export const INTEL_OFFICER_SONAR_MULTIPLIER = 1.25;
/** How long a sub may not be redirected again (Navigator). */
export const NAVIGATOR_COOLDOWN = 8 * HOUR;

// --- Specialist effects ---------------------------------------------------

/** Travel speed multipliers. Several specialists on one sub: the fastest wins. */
export const HELMSMAN_SPEED = 2;
export const OFFICER_SPEED = 1.5;
export const SMUGGLER_SPEED = 3;
export const ADMIRAL_GLOBAL_SPEED = 1.5;

/** Enemy drillers destroyed in combat. */
export const LIEUTENANT_DRILLERS_DESTROYED = 5;
export const GENERAL_DRILLERS_DESTROYED = 10;
export const WAR_HERO_DRILLERS_DESTROYED = 20;
/** King's: this many of your drillers left destroy one enemy driller. */
export const KING_DRILLERS_PER_ENEMY_DESTROYED = 4;
/** Share of enemy drillers a Thief converts (rounded up). */
export const THIEF_DRILLER_SHARE = 0.15;

/** Foreman's extra drillers per cycle, and her radius as a share of sonar. */
export const FOREMAN_DRILLERS_PER_CYCLE = 4;
export const FOREMAN_RADIUS_SHARE = 0.5;
/** Engineer repairs this share (rounded up) of the drillers you lost. */
export const ENGINEER_REPAIR_SHARE = 0.25;

/** Tinkerer: electrical output per point of max shield, and shield drain. */
export const TINKERER_ELECTRICAL_PER_SHIELD = 3;
export const TINKERER_SHIELD_DRAIN_PER_HOUR = 3;
/** Minister of Energy trades factories for electrical output. */
export const MINISTER_OF_ENERGY_ELECTRICAL = 300;
export const MINISTER_OF_ENERGY_DRILLER_PENALTY = 1;
/** Tycoon: a share faster cycles, which we implement as more drillers per cycle. */
export const TYCOON_RATE_MULTIPLIER = 1.5;
export const TYCOON_LOCAL_DRILLERS = 3;

// --- Elimination ---------------------------------------------------------

export const INACTIVITY_AUTO_RESIGN = 48 * HOUR;
