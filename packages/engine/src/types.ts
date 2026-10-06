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
  /** When the current leg started: the launch, or the last redirect. */
  launchedAt: GameTime;
  /** Always a multiple of `TICK`. */
  arrivesAt: GameTime;
  isGift: boolean;
  /** Speed multiplier frozen at launch, so the ETA never moves under us. */
  speed: number;
  /** When a Navigator last redirected this sub; `null` until it does. */
  lastRedirectAt: GameTime | null;
  /**
   * Where the current leg started, for a redirected sub: it turned here at
   * `launchedAt`. Absent: the leg starts at the `from` outpost.
   */
  origin?: Point;
  /**
   * The leg runs between no two outposts (a redirect that wasn't a straight
   * reversal), so it shares no lane and meets no other sub.
   */
  offLane?: boolean;
}

export type SpecialistCategory = 'offensive' | 'defensive' | 'other';

/**
 * The specialists built so far (see `specialists.ts` for the catalogue and
 * `docs/specialists.md` for the plan). Promoted kinds can only be reached by
 * promoting the base kind, never by hiring.
 */
export type SpecialistKind =
  // always present
  | 'queen'
  | 'princess'
  // hireable
  | 'helmsman'
  | 'lieutenant'
  | 'thief'
  | 'navigator'
  | 'foreman'
  | 'inspector'
  | 'intelOfficer'
  | 'hypnotist'
  // reached by promotion
  | 'general'
  | 'admiral'
  | 'engineer'
  | 'securityChief'
  | 'king';

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

/** The three cards an offer holds: at most one per category. */
export interface HireOffer {
  /** Game time the offer appeared. */
  at: GameTime;
  /** Categories with a specialist left in their deck; the others are omitted. */
  kinds: Partial<Record<SpecialistCategory, SpecialistKind>>;
}

/**
 * Hiring is part of the game state, not something the server tracks: the
 * decks are built from the seed in `generateMap`, so a replay offers the
 * same specialists at the same times.
 */
export interface Hiring {
  /** When the next offer appears (4 h, then every 18 h). */
  nextOfferAt: GameTime;
  /** Cards left per category. Drawn cards leave the deck, taken or not. */
  deck: Record<SpecialistCategory, SpecialistKind[]>;
  /** The offer waiting to be picked; a new one replaces an ignored one. */
  offer: HireOffer | null;
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
  hiring: Hiring;
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
  /** Players currently agreeing to end the game with no winner (see VoteEndOrder). */
  endVotes: PlayerId[];
}

// --- Orders --------------------------------------------------------------

/**
 * A player's instruction, executed by the engine at tick `at`. The server
 * sets `at` (e.g. `now + LAUNCH_DELAY` for launches) and may cancel an order
 * before it executes. Orders are validated *when they execute*; an order that
 * is no longer valid (e.g. not enough drillers) is skipped and reported.
 */
export type Order =
  | LaunchOrder
  | DrillMineOrder
  | SetShieldOrder
  | ResignOrder
  | VoteEndOrder
  | HireOrder
  | PromoteOrder
  | RedirectOrder;

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

/**
 * Propose (`agree: true`) or withdraw (`false`) ending the game with no
 * winner. It ends once every player still in the game agrees.
 */
export interface VoteEndOrder extends OrderBase {
  kind: 'voteEnd';
  agree: boolean;
}

/**
 * Take one specialist from the current offer (goal.md → Hiring). Needs a free
 * Queen at one of the player's own outposts; the new specialist appears
 * there. `hireSize` copies arrive for the two-at-a-time specialists.
 */
export interface HireOrder extends OrderBase {
  kind: 'hire';
  choice: SpecialistKind;
}

/** Promote a specialist standing on one of the player's own outposts. */
export interface PromoteOrder extends OrderBase {
  kind: 'promote';
  specialist: SpecialistId;
}

/** A Navigator changes its sub's destination once every 8 hours. */
export interface RedirectOrder extends OrderBase {
  kind: 'redirect';
  sub: SubId;
  to: OutpostId;
}

// --- Events (what happened; for logs, notifications and the UI) ---------

export type GameEvent =
  | { kind: 'orderRejected'; at: GameTime; order: Order; reason: string }
  | { kind: 'subLaunched'; at: GameTime; sub: SubId; owner: PlayerId; from: OutpostId; to: OutpostId }
  | { kind: 'subArrived'; at: GameTime; sub: SubId; owner: PlayerId; outpost: OutpostId }
  | { kind: 'subRedirected'; at: GameTime; sub: SubId; owner: PlayerId; from: OutpostId; to: OutpostId }
  | { kind: 'outpostCaptured'; at: GameTime; outpost: OutpostId; from: PlayerId | null; to: PlayerId }
  | {
      kind: 'combat';
      at: GameTime;
      /** Outpost id for sub-vs-outpost combat; absent for sub-vs-sub. */
      outpost?: OutpostId;
      subs: SubId[];
      players: PlayerId[];
      winner: PlayerId | null;
      /** The numbers behind the result, for battle summaries. */
      details: CombatDetails;
    }
  | { kind: 'mineDrilled'; at: GameTime; outpost: OutpostId; player: PlayerId }
  /** Private: only the player it was offered to sees this. */
  | { kind: 'specialistOffered'; at: GameTime; player: PlayerId; offer: HireOffer }
  | { kind: 'specialistHired'; at: GameTime; player: PlayerId; kinds: SpecialistKind[]; outpost: OutpostId }
  | { kind: 'specialistPromoted'; at: GameTime; player: PlayerId; specialist: SpecialistId; from: SpecialistKind; to: SpecialistKind; outpost: OutpostId }
  /** A Princess took over as Queen, so the player was not eliminated. */
  | { kind: 'queenSucceeded'; at: GameTime; player: PlayerId; specialist: SpecialistId; lostQueen: SpecialistId }
  /** `owners` are the specialists' owners before the capture, so a player
   *  whose Queen was taken still sees it. */
  | { kind: 'specialistCaptured'; at: GameTime; specialists: SpecialistId[]; owners: PlayerId[]; by: PlayerId; outpost: OutpostId }
  | { kind: 'specialistDestroyed'; at: GameTime; specialists: SpecialistId[]; owners: PlayerId[] }
  | { kind: 'playerEliminated'; at: GameTime; player: PlayerId; reason: 'queenCaptured' | 'resigned' }
  | { kind: 'gameWon'; at: GameTime; player: PlayerId; reason: 'neptunium' | 'lastStanding' }
  /**
   * The game ended with no winner: everyone left was eliminated in the same
   * tick (`eliminated`), or everyone left agreed to end it (`agreed`).
   */
  | { kind: 'gameDrawn'; at: GameTime; reason: 'eliminated' | 'agreed' }
  | { kind: 'endVote'; at: GameTime; player: PlayerId; agree: boolean };

/** One side of a combat, before and after. Same order as `players`. */
export interface CombatSide {
  player: PlayerId;
  drillersBefore: number;
  drillersAfter: number;
  /** Active (non-captive) specialists taking part. */
  specialists: number;
}

export interface CombatDetails {
  sides: CombatSide[];
  /** Defending outpost's shield charge before/after (outpost combat only). */
  shieldBefore?: number;
  shieldAfter?: number;
  /** What the specialists did, one line each (goal.md → Combat). */
  effects?: string[];
}

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
  /** The outpost's own maximum, before any specialist bonus. */
  shieldMax?: number;
  /** What it actually reaches, with Queen, Security Chief and King applied. */
  shieldMaxEffective?: number;
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

/** This player's hiring. The decks stay private to the server. */
export interface HiringView {
  /** When their next offer appears. */
  nextOfferAt: GameTime;
  /** The offer waiting to be taken, if any. */
  offer: HireOffer | null;
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
  /** This player's hiring, without their decks. */
  hiring: HiringView;
  winner: PlayerId | null;
  /** See `GameState.endedAt`. */
  endedAt: GameTime | null;
  /** Who agrees to end the game (public to everyone in it). */
  endVotes: PlayerId[];
}
