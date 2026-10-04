import type { Ack, PlayerId } from '@subterfuge/engine';
import type { FastifyBaseLogger } from 'fastify';
import type { RealtimeServer } from '../realtime.ts';
import { GameError, type GameRuntime } from './runtime.ts';

/** Room for one player's sockets in one game. Only they get its updates. */
export function gameRoom(gameId: string, playerId: PlayerId): string {
  return `game:${gameId}:${playerId}`;
}

/**
 * Most games one connection may watch at once. Clients unwatch when they
 * leave a game page, and rooms die with the socket; this cap bounds the
 * damage if a client never unwatches.
 */
export const MAX_WATCHED_GAMES = 5;

/** Socket.IO handlers for live games: watch, issue orders, cancel orders. */
export function attachGameHandlers(io: RealtimeServer, runtime: GameRuntime, log: FastifyBaseLogger): void {
  io.on('connection', (socket) => {
    const userId = socket.data.user.id;

    // Runs a handler and always answers the ack; payloads are untrusted, so
    // anything unexpected becomes a generic error rather than a crash.
    const handle = <T extends object>(ack: unknown, run: () => Promise<T>) => {
      if (typeof ack !== 'function') return;
      const reply = ack as Ack<T>;
      run().then(
        (result) => reply({ ok: true, ...result }),
        (err: unknown) => {
          if (err instanceof GameError) return reply({ ok: false, error: err.message });
          log.error(err, 'game socket handler failed');
          reply({ ok: false, error: 'Something went wrong.' });
        },
      );
    };

    socket.on('watchGame', (gameId, ack) =>
      handle(ack, async () => {
        if (typeof gameId !== 'string') throw new GameError('Invalid game id.');
        const playerId = await runtime.playerIdFor(gameId, userId);
        const room = gameRoom(gameId, playerId);
        const watching = [...socket.rooms].filter((r) => r.startsWith('game:') && r !== room).length;
        if (watching >= MAX_WATCHED_GAMES) {
          throw new GameError(`You can watch at most ${MAX_WATCHED_GAMES} games at once on one connection.`);
        }
        await socket.join(room);
        return { snapshot: await runtime.snapshot(gameId, userId) };
      }),
    );

    socket.on('unwatchGame', (gameId) => {
      if (typeof gameId !== 'string') return;
      for (const room of socket.rooms) if (room.startsWith(`game:${gameId}:`)) void socket.leave(room);
    });

    socket.on('issueOrder', (request, ack) =>
      handle(ack, async () => {
        if (typeof request?.gameId !== 'string') throw new GameError('Invalid request.');
        return { pending: await runtime.issueOrder(userId, request) };
      }),
    );

    socket.on('cancelOrder', (request, ack) =>
      handle(ack, async () => {
        if (typeof request?.gameId !== 'string' || typeof request.orderId !== 'string') {
          throw new GameError('Invalid request.');
        }
        await runtime.cancelOrder(userId, request.gameId, request.orderId);
        return {};
      }),
    );
  });
}
