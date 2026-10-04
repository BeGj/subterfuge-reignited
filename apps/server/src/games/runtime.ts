import {
  HOUR,
  LAUNCH_DELAY,
  RULES_VERSION,
  TICK,
  advance,
  generateMap,
  validateOrder,
  viewFor,
  type GameEvent,
  type GameSnapshot,
  type GameState,
  type GameTime,
  type IssueOrderRequest,
  type Order,
  type PendingOrder,
  type PlayerId,
} from '@subterfuge/engine';
import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from '../db.ts';
import type { EventBus } from '../events.ts';
import { RateLimiter } from '../auth/rate-limit.ts';
import { parseOrderInput } from './order-input.ts';

/** How often the runtime checks whether games have reached a new tick. */
const LOOP_INTERVAL_MS = 1000;
/** Recent events kept per player (already filtered for what they may see). */
export const EVENTS_PER_PLAYER = 100;
/** Furthest ahead an order may be scheduled, in game minutes. */
export const MAX_SCHEDULE_AHEAD = 7 * 24 * HOUR;
/** Most orders one player may have waiting at once. */
export const MAX_PENDING_PER_PLAYER = 100;
/** Order submissions + cancellations per player per game, per real minute. */
export const ORDER_RATE_LIMIT = 60;

interface LiveGame {
  id: string;
  speed: number;
  startedAtMs: number;
  finished: boolean;
  /** userId → engine player id. */
  players: Map<string, PlayerId>;
  state: GameState;
  /** Orders not yet executed, sorted by (at, id). */
  pending: PendingOrder[];
  /** Per player: recent events they may see, oldest first. */
  events: Map<PlayerId, GameEvent[]>;
  /**
   * >0 while an order is being written or cancelled. The game must not
   * advance meanwhile, or the order could miss its tick live while still
   * running on replay (breaking "state = seed + orders").
   */
  busy: number;
  /** Game time of the last snapshot sent to all players. */
  publishedTime: GameTime;
}

/** Delivers a snapshot to one player's sockets. Wired to Socket.IO in main.ts. */
export type SnapshotSink = (gameId: string, playerId: PlayerId, snapshot: GameSnapshot) => void;

export class GameError extends Error {}

/**
 * Runs all started games in memory. Each game is rebuilt on load by
 * generating the map from its seed and replaying stored orders, then
 * advanced on a timer as game time (derived from the wall clock) passes.
 * Postgres holds only games, players and orders — never game state.
 */
export class GameRuntime {
  private readonly games = new Map<string, LiveGame>();
  private loading = new Map<string, Promise<LiveGame>>();
  private timer: NodeJS.Timeout | undefined;
  private readonly sql: Sql;
  private readonly events: EventBus;
  private readonly sink: SnapshotSink;
  private readonly log: FastifyBaseLogger;
  private readonly now: () => number;
  /**
   * Caps how fast a player can write orders. Every order is replayed on
   * each load, so an unthrottled player could bloat the log and slow every
   * restart. Keyed by `${gameId}:${playerId}`.
   */
  private readonly orderLimiter: RateLimiter;

  constructor(opts: { sql: Sql; events: EventBus; sink: SnapshotSink; log: FastifyBaseLogger; now?: () => number }) {
    this.sql = opts.sql;
    this.events = opts.events;
    this.sink = opts.sink;
    this.log = opts.log;
    this.now = opts.now ?? Date.now;
    this.orderLimiter = new RateLimiter(ORDER_RATE_LIMIT, 60_000, this.now);
    this.events.on('gameStarted', (id) => {
      this.get(id).catch((err: unknown) => this.log.error(err, `failed to start game ${id}`));
    });
  }

  /** Loads every running game and starts the clock loop. */
  async start(): Promise<void> {
    const running = await this.sql<{ id: string }[]>`SELECT id FROM games WHERE status = 'running'`;
    for (const { id } of running) {
      await this.get(id).catch((err: unknown) => this.log.error(err, `failed to load game ${id}`));
    }
    this.timer = setInterval(() => this.loop(), LOOP_INTERVAL_MS);
    this.log.info(`Game runtime started (${this.games.size} running games)`);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** The player id of `userId` in `gameId`, loading the game if needed. */
  async playerIdFor(gameId: string, userId: string): Promise<PlayerId> {
    const game = await this.get(gameId);
    const playerId = game.players.get(userId);
    if (!playerId) throw new GameError('You are not a player in this game.');
    return playerId;
  }

  async snapshot(gameId: string, userId: string): Promise<GameSnapshot> {
    const playerId = await this.playerIdFor(gameId, userId);
    const game = await this.get(gameId);
    this.catchUp(game);
    return this.snapshotFor(game, playerId);
  }

  async issueOrder(userId: string, request: IssueOrderRequest): Promise<PendingOrder> {
    const playerId = await this.playerIdFor(request.gameId, userId);
    const game = await this.get(request.gameId);
    if (game.finished || game.state.endedAt !== null) throw new GameError('This game is over.');
    const input = parseOrderInput(request.order);
    if (typeof input === 'string') throw new GameError(input);
    this.throttle(game, playerId);
    if (game.pending.filter((p) => p.order.player === playerId).length >= MAX_PENDING_PER_PLAYER) {
      throw new GameError(`You can have at most ${MAX_PENDING_PER_PLAYER} orders waiting. Cancel some first.`);
    }

    this.catchUp(game);
    const earliest = this.earliestTime(game, input.kind === 'launch' ? LAUNCH_DELAY : 0);
    const at = request.at ?? earliest;
    if (!Number.isInteger(at) || at % TICK !== 0) throw new GameError(`Order time must be a multiple of ${TICK} minutes.`);
    if (at < earliest) throw new GameError('That time is too soon; orders need time to take effect.');
    if (at > earliest + MAX_SCHEDULE_AHEAD) {
      throw new GameError('Orders can be scheduled at most 7 game days ahead.');
    }

    const order = { ...input, at, player: playerId } as Order;
    // Orders for "as soon as possible" are checked now for quick feedback.
    // Scheduled orders depend on the future, so the engine checks them when
    // they execute (and reports an orderRejected event if they fail).
    if (request.at === undefined) {
      const problem = validateOrder(game.state, order);
      if (problem) throw new GameError(problem);
    }

    game.busy++;
    try {
      const [row] = await this.sql<{ id: string }[]>`
        INSERT INTO orders (game_id, player_id, at_minute, payload)
        VALUES (${game.id}, ${playerId}, ${at}, ${this.sql.json(input as never)})
        RETURNING id::text`;
      const pending: PendingOrder = { id: row!.id, order };
      game.pending.push(pending);
      sortPending(game.pending);
      this.publish(game, playerId);
      return pending;
    } finally {
      game.busy--;
    }
  }

  async cancelOrder(userId: string, gameId: string, orderId: string): Promise<void> {
    const playerId = await this.playerIdFor(gameId, userId);
    const game = await this.get(gameId);
    this.throttle(game, playerId);
    this.catchUp(game);
    const index = game.pending.findIndex((p) => p.id === orderId && p.order.player === playerId);
    if (index === -1) throw new GameError('That order has already executed or does not exist.');

    game.busy++;
    try {
      await this.sql`UPDATE orders SET cancelled_at = now() WHERE id = ${orderId} AND game_id = ${gameId}`;
      game.pending.splice(game.pending.findIndex((p) => p.id === orderId), 1);
      this.publish(game, playerId);
    } finally {
      game.busy--;
    }
  }

  // --- internals ---------------------------------------------------------

  private get(gameId: string): Promise<LiveGame> {
    const live = this.games.get(gameId);
    if (live) return Promise.resolve(live);
    let loading = this.loading.get(gameId);
    if (!loading) {
      loading = this.load(gameId).finally(() => this.loading.delete(gameId));
      this.loading.set(gameId, loading);
    }
    return loading;
  }

  private async load(gameId: string): Promise<LiveGame> {
    const [row] = await this.sql<
      { seed: number | null; speed: number; startedAt: Date | null; status: string; rulesVersion: number | null }[]
    >`SELECT seed, speed, started_at, status, rules_version FROM games WHERE id = ${gameId}`;
    if (!row) throw new GameError('Game not found.');
    if (row.status === 'lobby' || row.seed === null || !row.startedAt) throw new GameError('This game has not started yet.');
    if (row.rulesVersion !== RULES_VERSION) {
      // Replaying under different rules would silently rewrite the game, so
      // end it instead (see RULES_VERSION in the engine).
      await this.sql`
        UPDATE games SET status = 'finished', finished_at = now(), end_reason = 'rulesChanged'
        WHERE id = ${gameId} AND status = 'running'`;
      this.events.emit('lobbyChanged');
      this.log.warn(`Game ${gameId} uses rules v${row.rulesVersion ?? 0}, engine is v${RULES_VERSION}: ended`);
      throw new GameError('This game was started under an older version of the rules and has been ended.');
    }

    const players = await this.sql<{ userId: string; username: string; playerId: string }[]>`
      SELECT gp.user_id, u.username, gp.player_id
      FROM game_players gp JOIN users u ON u.id = gp.user_id
      WHERE gp.game_id = ${gameId} AND gp.player_id IS NOT NULL
      ORDER BY substring(gp.player_id from 2)::int`;
    const orders = await this.sql<{ id: string; playerId: string; atMinute: number; payload: object }[]>`
      SELECT id::text, player_id, at_minute, payload FROM orders
      WHERE game_id = ${gameId} AND cancelled_at IS NULL
      ORDER BY at_minute, id`;

    const initial = generateMap({
      seed: row.seed,
      players: players.map((p) => ({ id: p.playerId, name: p.username })),
    });
    const pending: PendingOrder[] = orders.map((o) => ({
      id: o.id,
      order: { ...(o.payload as object), at: o.atMinute, player: o.playerId } as Order,
    }));

    const game: LiveGame = {
      id: gameId,
      speed: row.speed,
      startedAtMs: row.startedAt.getTime(),
      finished: row.status === 'finished',
      players: new Map(players.map((p) => [p.userId, p.playerId])),
      state: initial,
      pending,
      events: new Map(players.map((p) => [p.playerId, []])),
      busy: 0,
      publishedTime: -1,
    };
    // Replay everything up to now. Events from the replay are kept so
    // reconnecting players still see recent history.
    this.step(game, this.currentTick(game));
    this.games.set(gameId, game);
    this.log.info(`Loaded game ${gameId} at minute ${game.state.time} (${orders.length} orders)`);
    return game;
  }

  /** Game minutes elapsed (fractional) for a game at the current wall time. */
  private gameMinute(game: LiveGame): number {
    return ((this.now() - game.startedAtMs) / 60_000) * game.speed;
  }

  private currentTick(game: LiveGame): GameTime {
    return Math.max(0, Math.floor(this.gameMinute(game) / TICK) * TICK);
  }

  /** First tick at least `delay` game minutes from now, after the current tick. */
  private earliestTime(game: LiveGame, delay: number): GameTime {
    const t = Math.ceil((this.gameMinute(game) + delay) / TICK) * TICK;
    return Math.max(t, game.state.time + TICK);
  }

  /** Advances to `until`, records events and drops executed orders. */
  private step(game: LiveGame, until: GameTime): boolean {
    if (until <= game.state.time) return false;
    const result = advance(game.state, game.pending.map((p) => p.order), until);
    game.state = result.state;
    game.pending = game.pending.filter((p) => p.order.at > game.state.time);
    // Filter per player first, then trim, so a busy game can't push one
    // player's events out of their feed.
    for (const [playerId, feed] of game.events) {
      feed.push(...result.events.filter((e) => eventVisibleTo(e, playerId)));
      if (feed.length > EVENTS_PER_PLAYER) feed.splice(0, feed.length - EVENTS_PER_PLAYER);
    }
    for (const event of result.events) {
      if (event.kind === 'playerEliminated') this.dropOrdersOf(game, event.player);
    }
    return true;
  }

  /**
   * Eliminated players can't act any more (goal.md → How to lose), so
   * their waiting orders are cancelled, in memory now and in the database
   * soon after. Nothing is lost if that write fails: the engine skips
   * orders from eliminated players anyway.
   */
  private dropOrdersOf(game: LiveGame, playerId: PlayerId): void {
    const ids = game.pending.filter((p) => p.order.player === playerId).map((p) => p.id);
    if (ids.length === 0) return;
    game.pending = game.pending.filter((p) => p.order.player !== playerId);
    this.sql`UPDATE orders SET cancelled_at = now() WHERE game_id = ${game.id} AND id IN ${this.sql(ids)} AND cancelled_at IS NULL`
      .catch((err: unknown) => this.log.error(err, `failed to cancel orders of eliminated ${playerId} in ${game.id}`));
  }

  private throttle(game: LiveGame, playerId: PlayerId): void {
    if (!this.orderLimiter.attempt(`${game.id}:${playerId}`)) {
      throw new GameError('You are sending orders too quickly. Wait a moment and try again.');
    }
  }

  /**
   * Brings a game up to the current tick, without publishing (the loop
   * publishes any progress, whoever made it). Skipped while an order write
   * is in flight; callers then see state at most one tick old, which is fine
   * because the engine re-validates orders when they execute.
   */
  private catchUp(game: LiveGame): void {
    if (!game.finished && game.busy === 0) this.step(game, this.currentTick(game));
  }

  private loop(): void {
    for (const game of this.games.values()) {
      if (game.finished) continue;
      try {
        this.catchUp(game);
        if (game.state.time > game.publishedTime) {
          game.publishedTime = game.state.time;
          for (const playerId of game.players.values()) this.publish(game, playerId);
        }
        if (game.state.endedAt !== null) void this.finish(game);
      } catch (err) {
        this.log.error(err, `game ${game.id} failed to advance`);
      }
    }
  }

  private async finish(game: LiveGame): Promise<void> {
    game.finished = true;
    await this.sql`
      UPDATE games SET status = 'finished', finished_at = now(), winner = ${game.state.winner},
        end_reason = ${game.state.winner ? 'won' : 'draw'}
      WHERE id = ${game.id} AND status = 'running'`;
    this.events.emit('lobbyChanged');
    this.log.info(`Game ${game.id} ended: ${game.state.winner ? `won by ${game.state.winner}` : 'draw'}`);
  }

  private publish(game: LiveGame, playerId: PlayerId): void {
    this.sink(game.id, playerId, this.snapshotFor(game, playerId));
  }

  private snapshotFor(game: LiveGame, playerId: PlayerId): GameSnapshot {
    return {
      gameId: game.id,
      view: viewFor(game.state, playerId),
      pendingOrders: game.pending.filter((p) => p.order.player === playerId),
      clock: {
        startedAt: new Date(game.startedAtMs).toISOString(),
        speed: game.speed,
        serverNow: new Date(this.now()).toISOString(),
      },
      events: game.events.get(playerId) ?? [],
    };
  }
}

function sortPending(pending: PendingOrder[]): void {
  pending.sort((a, b) => a.order.at - b.order.at || Number(a.id) - Number(b.id));
}

/** Which events a player may see. Errs on the side of hiding. */
export function eventVisibleTo(event: GameEvent, player: PlayerId): boolean {
  switch (event.kind) {
    case 'orderRejected':
      return event.order.player === player;
    case 'subLaunched':
    case 'subArrived':
      return event.owner === player;
    case 'outpostCaptured':
      return event.from === player || event.to === player;
    case 'combat':
      return event.players.includes(player);
    case 'mineDrilled': // mines are public
    case 'playerEliminated':
    case 'gameWon':
    case 'gameDrawn':
      return true;
  }
}
