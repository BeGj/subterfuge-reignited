import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.ts';
import { createTestDb, createUser, dbAvailable, type TestDb } from '../test/test-db.ts';
import {
  LobbyError,
  createGame,
  deleteGame,
  getGame,
  joinGame,
  leaveGame,
  listGames,
  startGame,
} from './lobby-store.ts';

describe.skipIf(!dbAvailable)('lobby-store (Postgres)', () => {
  let db: TestDb;
  let sql: Sql;
  let n = 0;
  const user = (prefix = 'usr') => createUser(sql, `${prefix}${++n}`);
  const newGame = (creator: string, maxPlayers = 4) =>
    createGame(sql, creator, { name: `Game ${++n}`, maxPlayers, speed: 60 });

  /** Asserts that `promise` rejects with a LobbyError of `status`. */
  async function rejects(promise: Promise<unknown>, status: number, message?: RegExp): Promise<void> {
    const err = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LobbyError);
    expect((err as LobbyError).status).toBe(status);
    if (message) expect((err as LobbyError).message).toMatch(message);
  }

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
  });
  afterAll(async () => {
    await db?.cleanup();
  });

  it('creator gets seat 1; joins take the lowest free seat, including after a leave', async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    const id = await newGame(a);
    await joinGame(sql, id, b);
    await joinGame(sql, id, c);
    await leaveGame(sql, id, b);
    await joinGame(sql, id, d);
    const seats = Object.fromEntries((await getGame(sql, id)).players.map((p) => [p.userId, p.seat]));
    expect(seats).toEqual({ [a]: 1, [d]: 2, [c]: 3 });
  });

  it('rejects joining a full game or joining twice', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await newGame(a, 2);
    await rejects(joinGame(sql, id, a), 409, /already in/);
    await joinGame(sql, id, b);
    await rejects(joinGame(sql, id, c), 409, /full/);
  });

  it('enforces creator-only start/delete and the creator-cannot-leave rule', async () => {
    const [a, b] = [await user(), await user()];
    const id = await newGame(a);
    await rejects(leaveGame(sql, id, a), 409, /creator cannot leave/);
    await rejects(startGame(sql, id, a), 409, /At least 2/);
    await joinGame(sql, id, b);
    await rejects(startGame(sql, id, b), 403);
    await rejects(deleteGame(sql, id, b), 403);
    await rejects(leaveGame(sql, id, await user()), 409, /not in this game/);
  });

  it('start assigns p1..pN in seat order and sets seed, start time and status', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await newGame(a);
    await joinGame(sql, id, b);
    await joinGame(sql, id, c);
    await leaveGame(sql, id, b); // leaves a gap at seat 2
    await joinGame(sql, id, b); // takes seat 2 again
    await startGame(sql, id, a);

    const game = await getGame(sql, id);
    expect(game.status).toBe('running');
    expect(game.startedAt).not.toBeNull();
    expect(game.players.map((p) => [p.userId, p.playerId])).toEqual([
      [a, 'p1'],
      [b, 'p2'],
      [c, 'p3'],
    ]);
    const [row] = await sql<{ seed: number | null }[]>`SELECT seed FROM games WHERE id = ${id}`;
    expect(row!.seed).toEqual(expect.any(Number));

    await rejects(startGame(sql, id, a), 409, /already started/);
    await rejects(leaveGame(sql, id, b), 409, /has started/);
    await rejects(deleteGame(sql, id, a), 409, /not started/);
    await rejects(joinGame(sql, id, await user()), 409, /already started/);
  });

  it('creator can delete a lobby game', async () => {
    const a = await user();
    const id = await newGame(a);
    await deleteGame(sql, id, a);
    await rejects(getGame(sql, id), 404);
  });

  it('lets exactly one of two concurrent joins take the last seat (row lock)', async () => {
    for (let round = 0; round < 5; round++) {
      const [a, b, c] = [await user(), await user(), await user()];
      const id = await newGame(a, 2);
      const results = await Promise.allSettled([joinGame(sql, id, b), joinGame(sql, id, c)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failure.reason as LobbyError).status).toBe(409);
      expect((await getGame(sql, id)).players).toHaveLength(2);
    }
  });

  it('lists finished games only for their members', async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const id = await newGame(a);
    await joinGame(sql, id, b);
    await startGame(sql, id, a);
    await sql`UPDATE games SET status = 'finished', finished_at = now(), winner = 'p1' WHERE id = ${id}`;

    const ids = async (u: string) => (await listGames(sql, u, { limit: 100 })).map((g) => g.id);
    expect(await ids(a)).toContain(id);
    expect(await ids(b)).toContain(id);
    expect(await ids(outsider)).not.toContain(id);
  });

  it('paginates newest first with `before`, without duplicates or gaps', async () => {
    // A fresh DB-wide view: count what's already listed for this user.
    const viewer = await user('viewer');
    const before = (await listGames(sql, viewer, { limit: 100 })).length;
    const creator = await user();
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push(await newGame(creator));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listGames(sql, viewer, { limit: 3, ...(cursor ? { before: cursor } : {}) });
      if (page.length === 0) break;
      expect(page.length).toBeLessThanOrEqual(3);
      seen.push(...page.map((g) => g.id));
      cursor = page.at(-1)!.id;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(before + 7);
    // Newest first: the 7 just created come first, in reverse creation order.
    expect(seen.slice(0, 7)).toEqual([...created].reverse());
    // Ids are UUIDv7, so list order is strictly descending.
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it('caps the page size', async () => {
    const viewer = await user();
    const creator = await user();
    for (let i = 0; i < 3; i++) await newGame(creator);
    expect(await listGames(sql, viewer, { limit: 2 })).toHaveLength(2);
    expect((await listGames(sql, viewer, { limit: 1000 })).length).toBeLessThanOrEqual(100);
  });
});
