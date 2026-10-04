import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { RULES_VERSION, type GameSnapshot, type OrderInput, type OutpostView } from '@subterfuge/engine';
import type { Sql } from '../db.ts';
import { createEventBus } from '../events.ts';
import { createTestDb, createUser, dbAvailable, type TestDb } from '../test/test-db.ts';
import { createGame, joinGame, startGame } from './lobby-store.ts';
import {
  EVENTS_PER_PLAYER,
  FINISHED_IDLE_UNLOAD_MS,
  GameRuntime,
  MAX_PENDING_PER_PLAYER,
  MAX_SCHEDULE_AHEAD,
  ORDER_RATE_LIMIT,
} from './runtime.ts';

/** Wall-clock start of every test game. At speed 60, 1 real second = 1 game minute. */
const T0 = Date.UTC(2026, 0, 1);
const SPEED = 60;
const atMinute = (minute: number) => T0 + minute * 1000;

const silentLog = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
  level: 'silent',
} as unknown as FastifyBaseLogger;

interface Published {
  gameId: string;
  playerId: string;
  snapshot: GameSnapshot;
}

/**
 * Wraps postgres.js so `INSERT INTO orders` waits until `release()` is
 * called. Everything else passes straight through.
 */
function gatedSql(sql: Sql) {
  let release!: () => void;
  let gate = Promise.resolve();
  let waiting = 0;
  const proxy = new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const strings = args[0];
      if (Array.isArray(strings) && 'raw' in strings && String(strings[0]).trimStart().startsWith('INSERT INTO orders')) {
        waiting++;
        return gate.then(() => Reflect.apply(target, thisArg, args));
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
  return {
    sql: proxy,
    close() {
      gate = new Promise((resolve) => (release = resolve));
    },
    release: () => release(),
    get waiting() {
      return waiting;
    },
  };
}

describe.skipIf(!dbAvailable)('GameRuntime (Postgres)', () => {
  let db: TestDb;
  let sql: Sql;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
  });
  afterAll(async () => {
    await db?.cleanup();
  });

  /** A started 2-player game whose clock starts at T0, plus a runtime on it. */
  async function setup(opts: { sql?: Sql } = {}) {
    const a = await createUser(sql, `alice${++n}`);
    const b = await createUser(sql, `bob${++n}`);
    const gameId = await createGame(sql, a, { name: `Test ${n}`, maxPlayers: 2, speed: SPEED });
    await joinGame(sql, gameId, b);
    await startGame(sql, gameId, a);
    await sql`UPDATE games SET started_at = ${new Date(T0)}, seed = 1234 WHERE id = ${gameId}`;

    let now = atMinute(0);
    const published: Published[] = [];
    const runtime = new GameRuntime({
      sql: opts.sql ?? sql,
      events: createEventBus(),
      log: silentLog,
      now: () => now,
      sink: (g, playerId, snapshot) => published.push({ gameId: g, playerId, snapshot }),
    });
    return {
      gameId,
      a,
      b,
      runtime,
      published,
      setMinute: (minute: number) => {
        now = atMinute(minute);
      },
      /** A second runtime on the same DB and clock, i.e. "after a restart". */
      restarted: () =>
        new GameRuntime({ sql, events: createEventBus(), log: silentLog, now: () => now, sink: () => {} }),
      // The loop is private; tests drive it by hand instead of with timers.
      loop: () => (runtime as unknown as { loop(): void }).loop(),
      issue: (user: string, order: OrderInput, at?: number) =>
        runtime.issueOrder(user, { gameId, order, ...(at === undefined ? {} : { at }) }),
    };
  }

  const ownOutposts = (s: GameSnapshot): OutpostView[] => s.view.outposts.filter((o) => o.owner === s.view.you);
  const launchFrom = (s: GameSnapshot): OrderInput => {
    const from = ownOutposts(s).find((o) => (o.drillers ?? 0) > 0)!;
    const to = s.view.outposts.find((o) => o.owner === null)!;
    return { kind: 'launch', from: from.id, to: to.id, drillers: 1, specialists: [] };
  };
  const shieldOff = (s: GameSnapshot): OrderInput => ({ kind: 'setShield', outpost: ownOutposts(s)[0]!.id, enabled: false });

  it('maps wall-clock time to game ticks', async () => {
    const t = await setup();
    t.setMinute(300);
    expect((await t.runtime.snapshot(t.gameId, t.a)).view.time).toBe(300);
    t.setMinute(315);
    expect((await t.runtime.snapshot(t.gameId, t.a)).view.time).toBe(310);
    expect((await t.runtime.snapshot(t.gameId, t.a)).clock).toMatchObject({ speed: SPEED, startedAt: new Date(T0).toISOString() });
  });

  it('picks the earliest allowed time and validates requested times', async () => {
    const t = await setup();
    t.setMinute(303);
    const snap = await t.runtime.snapshot(t.gameId, t.a);

    expect((await t.issue(t.a, launchFrom(snap))).order.at).toBe(320); // ceil(303 + 10)
    expect((await t.issue(t.a, shieldOff(snap))).order.at).toBe(310); // next tick

    await expect(t.issue(t.a, launchFrom(snap), 310)).rejects.toThrow(/too soon/);
    await expect(t.issue(t.a, launchFrom(snap), 325)).rejects.toThrow(/multiple of 10/);
    await expect(t.issue(t.a, launchFrom(snap), 320 + MAX_SCHEDULE_AHEAD + 10)).rejects.toThrow(/7 game days/);

    // A scheduled order is accepted, waits, then executes.
    const scheduled = await t.issue(t.a, shieldOff(snap), 400);
    t.setMinute(390);
    let view = (await t.runtime.snapshot(t.gameId, t.a)).view;
    const outpostId = (scheduled.order as { outpost: string }).outpost;
    expect((await t.runtime.snapshot(t.gameId, t.a)).pendingOrders.map((p) => p.id)).toContain(scheduled.id);
    t.setMinute(400);
    view = (await t.runtime.snapshot(t.gameId, t.a)).view;
    expect(view.outposts.find((o) => o.id === outpostId)!.shieldEnabled).toBe(false);
  });

  it('cancels only your own orders, once, before they execute', async () => {
    const t = await setup();
    t.setMinute(100);
    const snap = await t.runtime.snapshot(t.gameId, t.a);
    const order = await t.issue(t.a, shieldOff(snap), 200);

    await expect(t.runtime.cancelOrder(t.b, t.gameId, order.id)).rejects.toThrow(/already executed or does not exist/);
    await t.runtime.cancelOrder(t.a, t.gameId, order.id);
    const [row] = await sql<{ cancelledAt: Date | null }[]>`SELECT cancelled_at FROM orders WHERE id = ${order.id}`;
    expect(row!.cancelledAt).not.toBeNull();
    await expect(t.runtime.cancelOrder(t.a, t.gameId, order.id)).rejects.toThrow(/already executed/);

    const executed = await t.issue(t.a, launchFrom(snap));
    t.setMinute(executed.order.at + 10);
    await t.runtime.snapshot(t.gameId, t.a);
    await expect(t.runtime.cancelOrder(t.a, t.gameId, executed.id)).rejects.toThrow(/already executed/);
  });

  it('rebuilds identical state after a restart (replay = live)', async () => {
    const t = await setup();
    t.setMinute(50);
    const snapA = await t.runtime.snapshot(t.gameId, t.a);
    const snapB = await t.runtime.snapshot(t.gameId, t.b);
    await t.issue(t.a, launchFrom(snapA));
    await t.issue(t.b, launchFrom(snapB));
    await t.issue(t.b, shieldOff(snapB), 300);
    const cancelled = await t.issue(t.a, shieldOff(snapA), 600);
    await t.runtime.cancelOrder(t.a, t.gameId, cancelled.id);
    await t.issue(t.a, launchFrom(snapA), 900);

    // Advance the live runtime in several steps, as the loop would.
    for (const minute of [120, 480, 700, 1000, 1500]) {
      t.setMinute(minute);
      t.loop();
    }
    const fresh = t.restarted();
    for (const user of [t.a, t.b]) {
      const live = await t.runtime.snapshot(t.gameId, user);
      const replayed = await fresh.snapshot(t.gameId, user);
      expect(replayed.view).toEqual(live.view);
      expect(replayed.pendingOrders).toEqual(live.pendingOrders);
    }
  });

  it('does not let a tick pass while an order is being written (busy race)', async () => {
    const gated = gatedSql(sql);
    const t = await setup({ sql: gated.sql as Sql });
    t.setMinute(303);
    const snap = await t.runtime.snapshot(t.gameId, t.a);

    gated.close();
    const issuing = t.issue(t.a, launchFrom(snap)); // at = 320, insert now blocked
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gated.waiting).toBe(1);

    // Time passes well beyond the order's tick while the insert is pending.
    t.setMinute(400);
    expect((await t.runtime.snapshot(t.gameId, t.b)).view.time).toBe(300);
    t.loop();
    expect((await t.runtime.snapshot(t.gameId, t.a)).view.time).toBe(300);

    gated.release();
    const pending = await issuing;
    expect(pending.order.at).toBe(320);

    t.loop();
    const live = await t.runtime.snapshot(t.gameId, t.a);
    expect(live.view.time).toBe(400);
    expect(live.events.some((e) => e.kind === 'subLaunched' && e.at === 320)).toBe(true);

    // And the restart replay agrees with what happened live.
    const replayed = await t.restarted().snapshot(t.gameId, t.a);
    expect(replayed.view).toEqual(live.view);
  });

  it('publishes to every player even when another call advanced the state', async () => {
    const t = await setup();
    t.setMinute(300);
    t.loop(); // loads nothing yet: games load lazily
    await t.runtime.snapshot(t.gameId, t.a);
    t.loop();
    t.published.length = 0;

    t.setMinute(310);
    await t.runtime.snapshot(t.gameId, t.a); // advances to 310 without publishing
    expect(t.published).toHaveLength(0);
    t.loop();
    const playersAt310 = t.published.filter((p) => p.snapshot.view.time === 310).map((p) => p.playerId).sort();
    expect(playersAt310).toEqual(['p1', 'p2']);

    t.published.length = 0;
    t.loop(); // nothing new: no duplicate broadcast
    expect(t.published).toHaveLength(0);
  });

  it('rate-limits orders per player and caps waiting orders', async () => {
    const t = await setup();
    t.setMinute(10);
    const snap = await t.runtime.snapshot(t.gameId, t.a);
    const far = 5000;
    for (let i = 0; i < ORDER_RATE_LIMIT; i++) await t.issue(t.a, shieldOff(snap), far);
    await expect(t.issue(t.a, shieldOff(snap), far)).rejects.toThrow(/too quickly/);
    // The other player has their own budget.
    await t.issue(t.b, shieldOff(await t.runtime.snapshot(t.gameId, t.b)), far);

    t.setMinute(71); // a new rate-limit window (60 real seconds later)
    for (let i = ORDER_RATE_LIMIT; i < MAX_PENDING_PER_PLAYER; i++) await t.issue(t.a, shieldOff(snap), far);
    t.setMinute(132);
    await expect(t.issue(t.a, shieldOff(snap), far)).rejects.toThrow(new RegExp(`at most ${MAX_PENDING_PER_PLAYER} orders waiting`));
  });

  it('finishes the game on resign and cancels the resigner’s waiting orders', async () => {
    const t = await setup();
    t.setMinute(20);
    const snap = await t.runtime.snapshot(t.gameId, t.a);
    const later = await t.issue(t.a, shieldOff(snap), 2000);
    const resign = await t.issue(t.a, { kind: 'resign' });
    expect(resign.order.at).toBe(30);

    t.setMinute(40);
    t.loop();
    await expect.poll(async () => (await sql<{ status: string; winner: string | null; endReason: string | null }[]>`
      SELECT status, winner, end_reason FROM games WHERE id = ${t.gameId}`)[0]).toEqual({
      status: 'finished',
      winner: 'p2',
      endReason: 'won',
    });
    await expect.poll(async () => (await sql<{ cancelledAt: Date | null }[]>`
      SELECT cancelled_at FROM orders WHERE id = ${later.id}`)[0]!.cancelledAt).not.toBeNull();

    const view = (await t.runtime.snapshot(t.gameId, t.b)).view;
    expect(view.winner).toBe('p2');
    expect(view.endedAt).toBe(30);
    await expect(t.issue(t.b, shieldOff(snap))).rejects.toThrow(/game is over/);
  });

  it('unloads a finished game nobody is looking at, and reloads it on demand', async () => {
    const t = await setup();
    t.setMinute(20);
    await t.issue(t.a, { kind: 'resign' });
    t.setMinute(40);
    t.loop(); // executes the resign and finishes the game
    await expect.poll(async () => (await sql<{ status: string }[]>`SELECT status FROM games WHERE id = ${t.gameId}`)[0]!.status).toBe('finished');
    const before = (await t.runtime.snapshot(t.gameId, t.b)).view;

    // Still being looked at: stays loaded.
    const idle = FINISHED_IDLE_UNLOAD_MS / 1000; // test clock: 1 real s = 1 game min
    t.setMinute(40 + idle / 2);
    t.loop();
    expect(t.runtime.isLoaded(t.gameId)).toBe(true);

    // Nobody looked for longer than the limit: unloaded.
    t.setMinute(40 + idle * 2);
    t.loop();
    expect(t.runtime.isLoaded(t.gameId)).toBe(false);

    // Opening it again reloads the same final state.
    const after = (await t.runtime.snapshot(t.gameId, t.b)).view;
    expect(t.runtime.isLoaded(t.gameId)).toBe(true);
    expect({ winner: after.winner, endedAt: after.endedAt }).toEqual({ winner: before.winner, endedAt: before.endedAt });
  });

  it('ends the game with no winner when every player agrees', async () => {
    const t = await setup();
    t.setMinute(20);
    await t.issue(t.a, { kind: 'voteEnd', agree: true });
    t.setMinute(40);
    t.loop();
    const mid = (await t.runtime.snapshot(t.gameId, t.b)).view;
    expect(mid).toMatchObject({ endedAt: null, endVotes: ['p1'] });

    await t.issue(t.b, { kind: 'voteEnd', agree: true });
    t.setMinute(60);
    t.loop();
    await expect.poll(async () => (await sql<{ status: string; winner: string | null; endReason: string }[]>`
      SELECT status, winner, end_reason FROM games WHERE id = ${t.gameId}`)[0]).toEqual({
      status: 'finished',
      winner: null,
      endReason: 'agreed',
    });
  });

  it('ends instead of replaying a game started under different rules', async () => {
    const t = await setup();
    await sql`UPDATE games SET rules_version = ${RULES_VERSION + 1} WHERE id = ${t.gameId}`;
    await expect(t.runtime.snapshot(t.gameId, t.a)).rejects.toThrow(/older version of the rules/);
    const [row] = await sql<{ status: string; endReason: string | null; winner: string | null }[]>`
      SELECT status, end_reason, winner FROM games WHERE id = ${t.gameId}`;
    expect(row).toEqual({ status: 'finished', endReason: 'rulesChanged', winner: null });
  });

  it('records the rules version when a game starts', async () => {
    const t = await setup();
    const [row] = await sql<{ rulesVersion: number }[]>`SELECT rules_version FROM games WHERE id = ${t.gameId}`;
    expect(row!.rulesVersion).toBe(RULES_VERSION);
  });

  it('shows a launch to the other player while it is still cancellable, and hides it once cancelled', async () => {
    const t = await setup();
    t.setMinute(20);
    const snapB = await t.runtime.snapshot(t.gameId, t.b);
    // Launch from one of p1's outposts that p2 can see, if any; else at p2.
    const snapA = await t.runtime.snapshot(t.gameId, t.a);
    const seenByB = new Set(snapB.view.outposts.filter((o) => o.visible).map((o) => o.id));
    const from = ownOutposts(snapA).find((o) => seenByB.has(o.id) && (o.drillers ?? 0) > 0) ?? ownOutposts(snapA).find((o) => (o.drillers ?? 0) > 0)!;
    const to = snapA.view.outposts.find((o) => o.owner === 'p2') ?? snapA.view.outposts.find((o) => o.owner === null)!;
    t.published.length = 0;
    const pending = await t.issue(t.a, { kind: 'launch', from: from.id, to: to.id, drillers: 1, specialists: [] });

    const toB = t.published.filter((p) => p.playerId === 'p2').at(-1);
    const visibleToB = seenByB.has(from.id) || to.owner === 'p2';
    expect(toB?.snapshot.imminentLaunches.map((o) => o.from)).toEqual(visibleToB ? [from.id] : []);

    await t.runtime.cancelOrder(t.a, t.gameId, pending.id);
    expect(t.published.filter((p) => p.playerId === 'p2').at(-1)?.snapshot.imminentLaunches).toEqual([]);
  });

  it('reveals outpost owners outside sonar only when the game setting is on', async () => {
    const t = await setup();
    const hidden = (await t.runtime.snapshot(t.gameId, t.a)).view.outposts.filter((o) => !o.visible);
    expect(hidden.some((o) => o.owner !== undefined)).toBe(true);

    const off = await setup();
    await sql`UPDATE games SET reveal_owners = false WHERE id = ${off.gameId}`;
    const hiddenOff = (await off.restarted().snapshot(off.gameId, off.a)).view.outposts.filter((o) => !o.visible);
    expect(hiddenOff.every((o) => o.owner === undefined)).toBe(true);
  });

  it("keeps each player's event feed separate, so a busy player can't flush another's", async () => {
    const t = await setup();
    t.setMinute(10);
    const snapA = await t.runtime.snapshot(t.gameId, t.a);
    const snapB = await t.runtime.snapshot(t.gameId, t.b);
    await t.issue(t.b, launchFrom(snapB)); // B's only event: subLaunched at 20
    t.setMinute(30);
    t.loop();

    // Flood A's feed with orderRejected events (scheduled orders skip upfront
    // validation; launching from an outpost A doesn't own fails at execution).
    const notMine = snapA.view.outposts.find((o) => o.owner !== 'p1')!;
    const bad: OrderInput = { kind: 'launch', from: notMine.id, to: ownOutposts(snapA)[0]!.id, drillers: 1, specialists: [] };
    let minute = 30;
    for (let wave = 0; wave < 4; wave++) {
      for (let i = 0; i < ORDER_RATE_LIMIT - 1; i++) await t.issue(t.a, bad, minute + 100);
      minute += 70; // > 60 real seconds: a fresh rate-limit window
      t.setMinute(minute);
      for (let i = 0; i < 39; i++) await t.issue(t.a, bad, minute + 100);
      minute += 200;
      t.setMinute(minute);
      t.loop();
    }

    const feedA = (await t.runtime.snapshot(t.gameId, t.a)).events;
    const feedB = (await t.runtime.snapshot(t.gameId, t.b)).events;
    expect(feedA).toHaveLength(EVENTS_PER_PLAYER);
    expect(feedA.filter((e) => e.kind === 'orderRejected').length).toBeGreaterThan(EVENTS_PER_PLAYER - 5);
    expect(feedB.some((e) => e.kind === 'subLaunched' && e.owner === 'p2')).toBe(true);
    expect(feedB.some((e) => e.kind === 'orderRejected')).toBe(false);
  });
});
