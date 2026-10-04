/**
 * Core game state model. Plain, JSON-serialisable data, so the same shapes
 * can be persisted, sent over the wire (after visibility filtering) and
 * simulated in the browser by the time machine.
 *
 * Units:
 * - Time: integer **game minutes** since the game started. Everything happens
 *   on 10-minute ticks (`TICK`).
 * - Distance: **map units**, where a sub at 1.0 speed travels `SUB_SPEED`
 *   units per minute. See `constants.ts`.
 *
 * Ids are strings so they survive JSON and can be used as object keys. Ids
 * created during the game come from counters in the state, never from
 * randomness or the clock, so a replay produces identical ids.
 */

export type PlayerId = string;
export type OutpostId = string;
export type SubId = string;
export type SpecialistId = string;

/** Game time in integer minutes since the game started. */
export type GameTime = number;

export type OutpostType = 'factory' | 'generator' | 'mine';

export interface Point {
  x: number;
  y: number;
}

export interface Outpost {
  id: OutpostId;
  name: string;
  type: OutpostType;
  position: Point;
  /** `null` while the outpost is dormant (unowned). */
  owner: PlayerId | null;
  drillers: number;
  /** Max shield charge before specialist modifiers (10 or 20). */
  shieldMax: number;
  /** Shield progress in "charge-minutes"; see `shield.ts`. */
  shieldProgress: number;
  shieldEnabled: boolean;
}

export interface Sub {
  id: SubId;
  owner: PlayerId;
  from: OutpostId;
  /** Target outpost. (Pirates targeting subs come later.) */
  to: OutpostId;
  drillers: number;
  specialists: SpecialistId[];
  launchedAt: GameTime;
  /** Always a multiple of `TICK`. */
  arrivesAt: GameTime;
  isGift: boolean;
}

export type SpecialistKind = 'queen';

/** Where a specialist is. Exactly one location at a time. */
export type SpecialistLocation = { outpost: OutpostId } | { sub: SubId };

export interface Specialist {
  id: SpecialistId;
  kind: SpecialistKind;
  owner: PlayerId;
  location: SpecialistLocation;
  /** Set while held prisoner; the captor is the owner of the location. */
  captiveOf: PlayerId | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  /**
   * Neptunium in integer "kg-minutes": 1 kg = `NEPTUNIUM_UNIT` units.
   * Use `neptuniumKg()` for display.
   */
  neptunium: number;
  /** Mines this player drilled themselves (drives the next drill cost). */
  minesDrilled: number;
  eliminated: boolean;
}

export interface GameState {
  time: GameTime;
  seed: number;
  /** Map bounds; outposts lie within [0, width) × [0, height). */
  width: number;
  height: number;
  players: Player[];
  outposts: Outpost[];
  subs: Sub[];
  specialists: Specialist[];
  /** Next numeric suffix for generated ids (`sub-<n>`, `spec-<n>`). */
  nextId: number;
  /** The winner, once there is one. Stays `null` in a draw. */
  winner: PlayerId | null;
  /**
   * Game time the game ended (a win or a draw), else `null`. Once set, the
   * state never changes again. Use this, not `winner`, to test "game over".
   */
  endedAt: GameTime | null;
}

// --- Orders --------------------------------------------------------------

/**
 * A player's instruction, executed by the engine at tick `at`. The server
 * sets `at` (e.g. `now + LAUNCH_DELAY` for launches) and may cancel an order
 * before it executes. Orders are validated *when they execute*; an order that
 * is no longer valid (e.g. not enough drillers) is skipped and reported.
 */
export type Order = LaunchOrder | DrillMineOrder | SetShieldOrder | ResignOrder;

interface OrderBase {
  /** Execution time; must be a multiple of `TICK`. */
  at: GameTime;
  player: PlayerId;
}

export interface LaunchOrder extends OrderBase {
  kind: 'launch';
  from: OutpostId;
  to: OutpostId;
  drillers: number;
  specialists: SpecialistId[];
  isGift?: boolean;
}

export interface DrillMineOrder extends OrderBase {
  kind: 'drillMine';
  outpost: OutpostId;
}

export interface SetShieldOrder extends OrderBase {
  kind: 'setShield';
  outpost: OutpostId;
  enabled: boolean;
}

/** The player leaves the game: eliminated as if their Queen were lost. */
export interface ResignOrder extends OrderBase {
  kind: 'resign';
}

// --- Events (what happened; for logs, notifications and the UI) ---------

export type GameEvent =
  | { kind: 'orderRejected'; at: GameTime; order: Order; reason: string }
  | { kind: 'subLaunched'; at: GameTime; sub: SubId; owner: PlayerId; from: OutpostId; to: OutpostId }
  | { kind: 'subArrived'; at: GameTime; sub: SubId; owner: PlayerId; outpost: OutpostId }
  | { kind: 'outpostCaptured'; at: GameTime; outpost: OutpostId; from: PlayerId | null; to: PlayerId }
  | {
      kind: 'combat';
      at: GameTime;
      /** Outpost id for sub-vs-outpost combat; absent for sub-vs-sub. */
      outpost?: OutpostId;
      subs: SubId[];
      players: PlayerId[];
      winner: PlayerId | null;
    }
  | { kind: 'mineDrilled'; at: GameTime; outpost: OutpostId; player: PlayerId }
  | { kind: 'playerEliminated'; at: GameTime; player: PlayerId; reason: 'queenCaptured' | 'resigned' }
  | { kind: 'gameWon'; at: GameTime; player: PlayerId; reason: 'neptunium' | 'lastStanding' }
  /** Everyone still in the game was eliminated in the same tick. */
  | { kind: 'gameDrawn'; at: GameTime };

// --- Player view (fog of war) --------------------------------------------

/** An outpost as one player sees it. Hidden fields are omitted. */
export interface OutpostView {
  id: OutpostId;
  name: string;
  position: Point;
  /** Known if visible, owned, or a mine (mines are always public). */
  type?: OutpostType;
  /** Known only if within sonar or owned. */
  owner?: PlayerId | null;
  drillers?: number;
  shieldCharge?: number;
  shieldMax?: number;
  shieldEnabled?: boolean;
  /** Whether this player currently sees inside this outpost. */
  visible: boolean;
}

/**
 * What everyone knows about every player, regardless of sonar: the
 * leaderboard. Deliberately public (see `viewFor`).
 */
export interface PlayerPublic {
  id: PlayerId;
  name: string;
  neptunium: number;
  outpostCount: number;
  /** Mines this player drilled (public: drill cost is visible to all). */
  minesDrilled: number;
  eliminated: boolean;
}

/** Everything one player is allowed to know. Sent to the client. */
export interface PlayerView {
  you: PlayerId;
  time: GameTime;
  width: number;
  height: number;
  players: PlayerPublic[];
  outposts: OutpostView[];
  /** Only subs this player can see. */
  subs: Sub[];
  /** Only specialists at visible locations. */
  specialists: Specialist[];
  winner: PlayerId | null;
  /** See `GameState.endedAt`. */
  endedAt: GameTime | null;
}
