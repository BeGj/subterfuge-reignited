import type { GameEvent, GameTime, LaunchOrder, Order, PlayerView } from './types.js';

/**
 * Shapes shared by the HTTP API and the Socket.IO connection. Living next to
 * the engine means the server and the Angular client can't drift apart.
 */

export interface PublicUser {
  id: string;
  username: string;
}

export interface AuthCredentials {
  username: string;
  password: string;
}

export interface ApiError {
  error: string;
}

export type GameStatus = 'lobby' | 'running' | 'finished';

export interface GameSeat {
  userId: string;
  username: string;
  seat: number;
  /** Engine player id ('p1', ...); assigned when the game starts. */
  playerId: string | null;
}

/** A game as listed in the lobby. */
export interface GameSummary {
  id: string;
  name: string;
  status: GameStatus;
  maxPlayers: number;
  /** Game minutes per real minute (1 = real time). */
  speed: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  players: GameSeat[];
  /** Outpost owners are visible to everyone even outside sonar. */
  revealOwners: boolean;
  winner: string | null;
  /** Why a finished game ended; `null` while it hasn't. */
  endReason: GameEndReason | null;
}

/**
 * `rulesChanged`: the game was started under older rules (see
 * `RULES_VERSION`) and was ended instead of being replayed incorrectly.
 */
export type GameEndReason = 'won' | 'draw' | 'agreed' | 'rulesChanged';

export interface CreateGameRequest {
  name: string;
  maxPlayers: number;
  speed: number;
  /** Show who owns outposts outside sonar (default true). */
  revealOwners?: boolean;
}

/** Allowed speeds, offered as presets in the UI. */
export const GAME_SPEEDS = [
  { speed: 1, label: 'Real time (days)' },
  { speed: 60, label: 'Fast: 1 game hour per minute' },
  { speed: 240, label: 'Blitz: 4 game hours per minute' },
] as const;

export const GAME_NAME_MAX_LENGTH = 40;

// --- Live games ------------------------------------------------------------

/** An order as the client submits it; the server fills in `at` and `player`. */
export type OrderInput = Order extends infer O ? (O extends Order ? Omit<O, 'at' | 'player'> : never) : never;

/** An order accepted by the server that has not executed yet. Cancellable. */
export interface PendingOrder {
  id: string;
  order: Order;
}

/**
 * Maps real time to game time: game minute = (now - startedAt) in minutes
 * × speed. `serverNow` lets the client correct for clock skew.
 */
export interface GameClock {
  startedAt: string;
  speed: number;
  serverNow: string;
}

/** Everything a player's client needs to render a game. */
export interface GameSnapshot {
  gameId: string;
  view: PlayerView;
  pendingOrders: PendingOrder[];
  clock: GameClock;
  /** Recent events this player is allowed to know about (newest last). */
  events: GameEvent[];
  /**
   * Other players' launch orders about to execute (see
   * `IMMINENT_LAUNCH_WINDOW`) that this player would see once launched.
   * They may still be cancelled.
   */
  imminentLaunches: LaunchOrder[];
}

export type Ack<T> = (result: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface IssueOrderRequest {
  gameId: string;
  order: OrderInput;
  /**
   * Schedule for a later game minute (time machine). Omit to execute as soon
   * as allowed: launches after `LAUNCH_DELAY`, other orders on the next tick.
   */
  at?: GameTime;
}

/**
 * Why the server refused a Socket.IO connection (the `connect_error`
 * message). Socket.IO doesn't retry refused connections by itself, so the
 * client must: `unauthorized` → log in again; `unavailable` → retry soon.
 */
export const CONNECT_ERRORS = { unauthorized: 'unauthorized', unavailable: 'unavailable' } as const;

/** Events the server sends to the client over Socket.IO. */
export interface ServerToClientEvents {
  /**
   * On every (re)connect. `clientBuild` identifies the client the server
   * currently serves (the hashed bundle name), or `null` in development; a
   * client running a different build should ask the user to refresh.
   */
  hello: (payload: { user: PublicUser; serverTime: string; clientBuild: string | null }) => void;
  /** Something in the lobby changed; refetch the game list. */
  lobbyChanged: () => void;
  /** New state for a game this socket is watching. */
  gameUpdate: (snapshot: GameSnapshot) => void;
}

/** Events the client sends to the server over Socket.IO. */
export interface ClientToServerEvents {
  ping: (ack: (serverTime: string) => void) => void;
  /** Subscribe to a game you play in; acks with the current snapshot. */
  watchGame: (gameId: string, ack: Ack<{ snapshot: GameSnapshot }>) => void;
  unwatchGame: (gameId: string) => void;
  issueOrder: (request: IssueOrderRequest, ack: Ack<{ pending: PendingOrder }>) => void;
  cancelOrder: (request: { gameId: string; orderId: string }, ack: Ack<object>) => void;
}

/** Validation rules, shared so the client can validate before submitting. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
