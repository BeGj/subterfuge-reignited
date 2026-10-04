import { randomInt } from 'node:crypto';
import { RULES_VERSION, type GameSummary } from '@subterfuge/engine';
import type { Sql, Tx } from '../db.ts';

/** Thrown for expected, user-facing failures; routes map `status` to HTTP. */
export class LobbyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const summaryColumns = (sql: Sql) => sql`
  g.id, g.name, g.status, g.max_players, g.speed, cu.username AS created_by,
  g.created_at, g.started_at, g.winner, g.end_reason,
  COALESCE(
    json_agg(
      json_build_object(
        'userId', p.user_id,
        'username', pu.username,
        'seat', p.seat,
        'playerId', p.player_id
      ) ORDER BY p.seat
    ) FILTER (WHERE p.user_id IS NOT NULL),
    '[]'
  ) AS players`;

const summaryJoins = (sql: Sql) => sql`
  FROM games g
  JOIN users cu ON cu.id = g.created_by
  LEFT JOIN game_players p ON p.game_id = g.id
  LEFT JOIN users pu ON pu.id = p.user_id`;

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 100;

/**
 * Open and running games, plus any game the user is in. Newest first.
 * Keyset pagination: pass the last id of a page as `before` to get the next
 * page. Game ids are UUIDv7, so id order is creation order.
 */
export async function listGames(
  sql: Sql,
  userId: string,
  page: { before?: string; limit?: number } = {},
): Promise<GameSummary[]> {
  const limit = Math.min(page.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
  return sql<GameSummary[]>`
    SELECT ${summaryColumns(sql)}
    ${summaryJoins(sql)}
    WHERE (g.status <> 'finished'
       OR EXISTS (SELECT 1 FROM game_players m WHERE m.game_id = g.id AND m.user_id = ${userId}))
      ${page.before ? sql`AND g.id < ${page.before}` : sql``}
    GROUP BY g.id, cu.username
    ORDER BY g.id DESC
    LIMIT ${limit}`;
}

export async function getGame(sql: Sql, gameId: string): Promise<GameSummary> {
  const [game] = await sql<GameSummary[]>`
    SELECT ${summaryColumns(sql)}
    ${summaryJoins(sql)}
    WHERE g.id = ${gameId}
    GROUP BY g.id, cu.username`;
  if (!game) throw new LobbyError(404, 'Game not found.');
  return game;
}

export async function createGame(
  sql: Sql,
  userId: string,
  input: { name: string; maxPlayers: number; speed: number },
): Promise<string> {
  return sql.begin(async (tx) => {
    const [game] = await tx<{ id: string }[]>`
      INSERT INTO games (name, max_players, speed, created_by)
      VALUES (${input.name.trim()}, ${input.maxPlayers}, ${input.speed}, ${userId})
      RETURNING id`;
    await tx`INSERT INTO game_players (game_id, user_id, seat) VALUES (${game!.id}, ${userId}, 1)`;
    return game!.id;
  });
}

interface LockedGame {
  status: string;
  maxPlayers: number;
  createdBy: string;
}

/** Locks the game row for the rest of the transaction, so joins can't race. */
async function lockGame(tx: Tx, gameId: string): Promise<LockedGame> {
  const [game] = await tx<LockedGame[]>`
    SELECT status, max_players, created_by FROM games WHERE id = ${gameId} FOR UPDATE`;
  if (!game) throw new LobbyError(404, 'Game not found.');
  return game;
}

export async function joinGame(sql: Sql, gameId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (game.status !== 'lobby') throw new LobbyError(409, 'This game has already started.');
    const seats = await tx<{ userId: string; seat: number }[]>`
      SELECT user_id, seat FROM game_players WHERE game_id = ${gameId}`;
    if (seats.some((s) => s.userId === userId)) throw new LobbyError(409, 'You are already in this game.');
    if (seats.length >= game.maxPlayers) throw new LobbyError(409, 'This game is full.');
    const taken = new Set(seats.map((s) => s.seat));
    let seat = 1;
    while (taken.has(seat)) seat++;
    await tx`INSERT INTO game_players (game_id, user_id, seat) VALUES (${gameId}, ${userId}, ${seat})`;
  });
}

export async function leaveGame(sql: Sql, gameId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (game.status !== 'lobby') throw new LobbyError(409, 'You cannot leave a game that has started.');
    if (game.createdBy === userId) throw new LobbyError(409, 'The creator cannot leave; delete the game instead.');
    const result = await tx`DELETE FROM game_players WHERE game_id = ${gameId} AND user_id = ${userId}`;
    if (result.count === 0) throw new LobbyError(409, 'You are not in this game.');
  });
}

export async function deleteGame(sql: Sql, gameId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (game.createdBy !== userId) throw new LobbyError(403, 'Only the creator can delete this game.');
    if (game.status !== 'lobby') throw new LobbyError(409, 'Only games that have not started can be deleted.');
    await tx`DELETE FROM games WHERE id = ${gameId}`;
  });
}

/**
 * Starts the game: gives players engine ids p1..pN in seat order, picks the
 * map seed and starts the clock.
 */
export async function startGame(sql: Sql, gameId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (game.createdBy !== userId) throw new LobbyError(403, 'Only the creator can start this game.');
    if (game.status !== 'lobby') throw new LobbyError(409, 'This game has already started.');
    const players = await tx<{ userId: string }[]>`
      SELECT user_id FROM game_players WHERE game_id = ${gameId} ORDER BY seat`;
    if (players.length < 2) throw new LobbyError(409, 'At least 2 players are needed to start.');

    for (const [i, p] of players.entries()) {
      await tx`
        UPDATE game_players SET player_id = ${`p${i + 1}`}
        WHERE game_id = ${gameId} AND user_id = ${p.userId}`;
    }
    await tx`
      UPDATE games SET status = 'running', started_at = now(), seed = ${randomInt(2 ** 31 - 1)},
        rules_version = ${RULES_VERSION}
      WHERE id = ${gameId}`;
  });
}
