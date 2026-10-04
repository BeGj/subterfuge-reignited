import type { FastifyInstance } from 'fastify';
import { GAME_NAME_MAX_LENGTH, GAME_SPEEDS, MAX_PLAYERS, MIN_PLAYERS, type CreateGameRequest } from '@subterfuge/engine';
import type { Sql } from '../db.ts';
import type { EventBus } from '../events.ts';
import { requireUser } from '../auth/routes.ts';
import { RateLimiter } from '../auth/rate-limit.ts';
import {
  LIST_MAX_LIMIT,
  LobbyError,
  createGame,
  deleteGame,
  getGame,
  joinGame,
  leaveGame,
  listGames,
  startGame,
} from './lobby-store.ts';

export interface LobbyOptions {
  sql: Sql;
  events: EventBus;
}

const HOUR = 60 * 60 * 1000;

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const gameParams = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', pattern: UUID_PATTERN } },
  },
} as const;

const createSchema = {
  body: {
    type: 'object',
    required: ['name', 'maxPlayers', 'speed'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: GAME_NAME_MAX_LENGTH, pattern: '\\S' },
      maxPlayers: { type: 'integer', minimum: MIN_PLAYERS, maximum: MAX_PLAYERS },
      speed: { type: 'integer', enum: GAME_SPEEDS.map((s) => s.speed) },
      revealOwners: { type: 'boolean' },
    },
  },
} as const;

/** Lobby API: list, create, join, leave, delete and start games. */
export async function lobbyRoutes(app: FastifyInstance, { sql, events }: LobbyOptions): Promise<void> {
  // Every lobby mutation broadcasts `lobbyChanged`, which makes every
  // connected client refetch the game list. So an unthrottled script could
  // both fill the `games` table and turn each row into a refetch in every
  // open browser. The limits are generous: a real player creates a handful of
  // games and joins a few a day. Created per app instance (not per module) so
  // separate instances, e.g. in tests, don't share counters.
  const createLimiter = new RateLimiter(20, HOUR);
  const joinLimiter = new RateLimiter(60, HOUR);

  app.addHook('preHandler', requireUser(sql));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof LobbyError) return reply.code(err.status).send({ error: err.message });
    return reply.send(err);
  });

  const userId = (req: { user: { id: string } | null }) => req.user!.id;

  app.get<{ Querystring: { before?: string; limit?: number } }>(
    '/api/games',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            before: { type: 'string', pattern: UUID_PATTERN },
            limit: { type: 'integer', minimum: 1, maximum: LIST_MAX_LIMIT },
          },
        },
      },
    },
    async (req) => listGames(sql, userId(req), req.query),
  );

  app.get<{ Params: { id: string } }>('/api/games/:id', { schema: gameParams }, async (req) =>
    getGame(sql, req.params.id),
  );

  app.post<{ Body: CreateGameRequest }>('/api/games', { schema: createSchema }, async (req, reply) => {
    if (!createLimiter.attempt(userId(req))) {
      return reply.code(429).send({ error: 'Too many games created. Try again later.' });
    }
    const id = await createGame(sql, userId(req), req.body);
    events.emit('lobbyChanged');
    return reply.code(201).send(await getGame(sql, id));
  });

  const action = (
    path: string,
    run: (gameId: string, userId: string) => Promise<void>,
    after?: (id: string) => void,
    limiter?: RateLimiter,
    limitedMessage?: string,
  ) =>
    app.post<{ Params: { id: string } }>(path, { schema: gameParams }, async (req, reply) => {
      if (limiter && !limiter.attempt(userId(req))) {
        return reply.code(429).send({ error: limitedMessage ?? 'Too many requests. Try again later.' });
      }
      await run(req.params.id, userId(req));
      events.emit('lobbyChanged');
      after?.(req.params.id);
      return reply.code(204).send();
    });

  action(
    '/api/games/:id/join',
    (id, user) => joinGame(sql, id, user),
    undefined,
    joinLimiter,
    'Too many games joined. Try again later.',
  );
  action('/api/games/:id/leave', (id, user) => leaveGame(sql, id, user));
  action('/api/games/:id/start', (id, user) => startGame(sql, id, user), (id) => events.emit('gameStarted', id));

  app.delete<{ Params: { id: string } }>('/api/games/:id', { schema: gameParams }, async (req, reply) => {
    await deleteGame(sql, req.params.id, userId(req));
    events.emit('lobbyChanged');
    return reply.code(204).send();
  });
}
