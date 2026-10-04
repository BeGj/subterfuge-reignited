/**
 * Core game state model. Kept as plain, JSON-serialisable data so the same
 * shapes can be persisted, sent over the wire (after visibility filtering),
 * and simulated in the browser by the time machine.
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
  /** Set when the outpost was drilled into a mine. */
  minedBy?: PlayerId;
}

export interface Sub {
  id: SubId;
  owner: PlayerId;
  from: OutpostId;
  /** Target outpost (or sub, once Pirates are implemented). */
  to: OutpostId;
  drillers: number;
  specialists: SpecialistId[];
  launchedAt: GameTime;
  arrivesAt: GameTime;
  isGift: boolean;
}

export interface Player {
  id: PlayerId;
  name: string;
  neptunium: number;
  minesDrilled: number;
  eliminated: boolean;
}

export interface GameState {
  time: GameTime;
  players: Player[];
  outposts: Outpost[];
  subs: Sub[];
}
