import { describe, expect, it } from 'vitest';
import { DAY, HOUR, TICK } from './constants.js';
import { generateMap } from './map.js';
import { advance, travelTime } from './simulation.js';
import type { GameEvent, GameState, Order } from './types.js';

/*
 * The architecture rests on one promise: state = generateMap(seed) + orders,
 * replayed. The server loads a game by replaying in ONE advance() call, but
 * runs it live one tick per call. These tests make sure both paths (and any
 * other chunking) give byte-identical state and events.
 */

const SEED = 4242;
const END = 4 * DAY;

function initial(): GameState {
  return generateMap({
    seed: SEED,
    players: [
      { id: 'p1', name: 'One' },
      { id: 'p2', name: 'Two' },
      { id: 'p3', name: 'Three' },
    ],
  });
}

/** A scripted order log exercising launches, combat, captures, drills, shields and a resign. */
function orderLog(state: GameState): Order[] {
  const orders: Order[] = [];
  const owned = (p: string) => state.outposts.filter((o) => o.owner === p);
  const queenOutpost = (p: string) => {
    const q = state.specialists.find((s) => s.owner === p && s.kind === 'queen')!;
    return 'outpost' in q.location ? q.location.outpost : '';
  };
  const byDistanceFrom = (from: string) => {
    const at = state.outposts.find((o) => o.id === from)!.position;
    return [...state.outposts]
      .filter((o) => o.id !== from)
      .sort((a, b) => Math.hypot(a.position.x - at.x, a.position.y - at.y) - Math.hypot(b.position.x - at.x, b.position.y - at.y));
  };

  for (const p of ['p1', 'p2', 'p3']) {
    const mine = owned(p);
    const armies = mine.filter((o) => o.drillers > 0);
    const [a, b, ...raiders] = armies;
    // Expand: the raiding armies grab their nearest dormant outposts.
    raiders.forEach((o, i) => {
      const targets = byDistanceFrom(o.id).filter((t) => t.owner === null).slice(0, 2);
      targets.forEach((t, j) => orders.push({ kind: 'launch', at: TICK * (1 + i + j), player: p, from: o.id, to: t.id, drillers: 8, specialists: [] }));
    });
    // Consolidate two armies (40 + 40) and drill a mine (cost 50) once they arrive.
    if (a && b) {
      orders.push({ kind: 'launch', at: 2 * HOUR, player: p, from: b.id, to: a.id, drillers: 40, specialists: [] });
      const arrive = 2 * HOUR + travelTime(state, b.id, a.id);
      orders.push({ kind: 'drillMine', at: arrive + TICK, player: p, outpost: a.id });
    }
    // Shields off and on again.
    orders.push({ kind: 'setShield', at: 3 * HOUR, player: p, outpost: mine[0]!.id, enabled: false });
    orders.push({ kind: 'setShield', at: 9 * HOUR, player: p, outpost: mine[0]!.id, enabled: true });
    // Raid the next player's Queen outpost with whatever is left, repeatedly.
    const victim = p === 'p1' ? 'p2' : p === 'p2' ? 'p3' : 'p1';
    for (let k = 0; k < 8; k++) {
      const from = raiders[k % raiders.length]!;
      orders.push({ kind: 'launch', at: 6 * HOUR + k * 4 * HOUR, player: p, from: from.id, to: queenOutpost(victim), drillers: 6, specialists: [] });
    }
    // Probing launches between neighbours every couple of hours (many will be rejected later: that's part of the log).
    for (let k = 0; k < 10; k++) {
      const from = mine[k % mine.length]!;
      const to = byDistanceFrom(from.id)[k % 3]!;
      orders.push({ kind: 'launch', at: 2 * HOUR * (k + 1) + TICK, player: p, from: from.id, to: to.id, drillers: 3, specialists: [] });
    }
  }
  orders.push({ kind: 'resign', at: 3 * DAY, player: 'p3' });
  return orders;
}

const json = (v: unknown) => JSON.stringify(v);

function runInChunks(start: GameState, orders: Order[], steps: number[]): { state: GameState; events: GameEvent[] } {
  let state = start;
  const events: GameEvent[] = [];
  let i = 0;
  while (state.time < END) {
    const until = Math.min(END, state.time + steps[i++ % steps.length]! * TICK);
    const r = advance(state, orders, until);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('replay determinism', () => {
  const start = initial();
  const orders = orderLog(start);
  const startJson = json(start);
  const ordersJson = json(orders);
  const once = advance(start, orders, END);

  it('uses a meaningful order log', () => {
    expect(orders.length).toBeGreaterThanOrEqual(50);
    const kinds = new Set(once.events.map((e) => e.kind));
    for (const k of ['subLaunched', 'outpostCaptured', 'combat', 'mineDrilled', 'playerEliminated', 'orderRejected']) {
      expect(kinds, `expected a ${k} event`).toContain(k);
    }
  });

  it('gives identical results for the same seed and order log', () => {
    const again = advance(initial(), orderLog(initial()), END);
    expect(json(again.state)).toBe(json(once.state));
    expect(json(again.events)).toBe(json(once.events));
  });

  it('matches tick-by-tick advancing (the live runtime path)', () => {
    const live = runInChunks(start, orders, [1]);
    expect(json(live.state)).toBe(json(once.state));
    expect(json(live.events)).toBe(json(once.events));
  });

  it('matches advancing in irregular chunks', () => {
    const chunked = runInChunks(start, orders, [7, 1, 33, 2, 144, 5]);
    expect(json(chunked.state)).toBe(json(once.state));
    expect(json(chunked.events)).toBe(json(once.events));
  });

  it('never mutates its inputs', () => {
    expect(json(start)).toBe(startJson);
    expect(json(orders)).toBe(ordersJson);
  });
});
