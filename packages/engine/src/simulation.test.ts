import { describe, expect, it } from 'vitest';
import { FACTORY_CYCLE, MINE_LOSS_PENALTY, NEPTUNIUM_TO_WIN, NEPTUNIUM_UNIT, TICK } from './constants.js';
import { inertHiring } from './hiring.js';
import { progressForCharge, shieldCharge } from './shield.js';
import { advance, subPosition, travelTime, validateOrder } from './simulation.js';
import type { GameState, LaunchOrder, Order, Outpost } from './types.js';

// --- Fixture ---------------------------------------------------------------

function outpost(id: string, x: number, owner: string | null, drillers: number, extra: Partial<Outpost> = {}): Outpost {
  return {
    id,
    name: id,
    type: 'factory',
    position: { x, y: 0 },
    owner,
    drillers,
    shieldMax: 10,
    shieldProgress: 0,
    shieldEnabled: true,
    ...extra,
  };
}

/**
 * p1 owns A (x=0, Queen); p2 owns generator E (x=600, full 8-shield) and Q (x=3000, Queen).
 * E is a generator so its driller count doesn't change during attacks.
 * C (x=300) is dormant. All on the x-axis, so distances are easy.
 */
function makeState(over: Partial<GameState> = {}): GameState {
  return {
    time: 0,
    seed: 1,
    width: 6000,
    height: 2000,
    players: [
      { id: 'p1', name: 'One', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
      { id: 'p2', name: 'Two', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
    ],
    outposts: [
      outpost('A', 0, 'p1', 40),
      outpost('C', 300, null, 0),
      outpost('E', 600, 'p2', 5, { type: 'generator', shieldMax: 8, shieldProgress: progressForCharge(8) }),
      outpost('Q', 3000, 'p2', 40),
    ],
    subs: [],
    specialists: [
      { id: 'q1', kind: 'queen', owner: 'p1', location: { outpost: 'A' }, captiveOf: null },
      { id: 'q2', kind: 'queen', owner: 'p2', location: { outpost: 'Q' }, captiveOf: null },
    ],
    nextId: 1,
    winner: null,
    endedAt: null,
    endVotes: [],
    ...over,
  };
}

const launch = (o: Partial<LaunchOrder> & Pick<LaunchOrder, 'player' | 'from' | 'to'>): LaunchOrder => ({
  kind: 'launch',
  at: TICK,
  drillers: 0,
  specialists: [],
  ...o,
});

const find = (state: GameState, id: string) => state.outposts.find((o) => o.id === id)!;
const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

// --- Tests -----------------------------------------------------------------

describe('travelTime', () => {
  it('rounds up to whole ticks, with at least one tick', () => {
    const s = makeState({
      outposts: [outpost('a', 0, 'p1', 0), outpost('b', 305, null, 0), outpost('c', 1, null, 0)],
    });
    expect(travelTime(s, 'a', 'b')).toBe(310);
    expect(travelTime(s, 'a', 'c')).toBe(TICK);
  });
});

describe('advance', () => {
  it('captures a dormant outpost on arrival', () => {
    const { state, events } = advance(makeState(), [launch({ player: 'p1', from: 'A', to: 'C', drillers: 10 })], 310);
    expect(find(state, 'A').drillers).toBe(30);
    expect(find(state, 'C')).toMatchObject({ owner: 'p1', drillers: 10 });
    expect(events).toContainEqual({ kind: 'outpostCaptured', at: 310, outpost: 'C', from: null, to: 'p1' });
  });

  it('applies the shield before drillers when attacking', () => {
    const { state } = advance(makeState(), [launch({ player: 'p1', from: 'A', to: 'E', drillers: 20 })], 610);
    // 20 attackers − 8 shield = 12 vs 5 defenders → 7 left.
    expect(find(state, 'E')).toMatchObject({ owner: 'p1', drillers: 7 });
    expect(shieldCharge(find(state, 'E').shieldProgress)).toBe(0);
  });

  it('lets the defender win and keep the difference', () => {
    const { state, events } = advance(makeState(), [launch({ player: 'p1', from: 'A', to: 'E', drillers: 10 })], 610);
    // 10 − 8 shield = 2 vs 5 → defender keeps 3.
    expect(find(state, 'E')).toMatchObject({ owner: 'p2', drillers: 3 });
    expect(events.find((e) => e.kind === 'combat')).toMatchObject({ winner: 'p2' });
  });

  it('gives a full tie to the defender, but surviving specialists break ties', () => {
    // 13 − 8 = 5 vs 5.
    const tie = advance(makeState(), [launch({ player: 'p1', from: 'A', to: 'E', drillers: 13 })], 610);
    expect(find(tie.state, 'E')).toMatchObject({ owner: 'p2', drillers: 0 });

    const withQueen = advance(
      makeState(),
      [launch({ player: 'p1', from: 'A', to: 'E', drillers: 13, specialists: ['q1'] })],
      610,
    );
    expect(find(withQueen.state, 'E')).toMatchObject({ owner: 'p1', drillers: 0 });
    expect(withQueen.state.specialists.find((s) => s.id === 'q1')!.location).toEqual({ outpost: 'E' });
  });

  it('captures specialists of a losing attacker', () => {
    const base = makeState();
    // A Helmsman, so the attacker is captured with someone who doesn't act.
    base.specialists.push({ id: 'h1', kind: 'helmsman', owner: 'p1', location: { outpost: 'A' }, captiveOf: null });
    const { state } = advance(
      base,
      [launch({ player: 'p1', from: 'A', to: 'E', drillers: 1, specialists: ['h1'] })],
      610,
    );
    expect(state.specialists.find((s) => s.id === 'h1')).toMatchObject({
      captiveOf: 'p2',
      owner: 'p1',
      location: { outpost: 'E' },
    });
    expect(player(state, 'p1').eliminated).toBe(false);
  });

  it('turns a captured Queen into a prisoner Princess and eliminates her owner', () => {
    const base = makeState();
    find(base, 'E').shieldEnabled = false;
    base.specialists[1]!.location = { outpost: 'E' };
    const { state, events } = advance(base, [launch({ player: 'p1', from: 'A', to: 'E', drillers: 20 })], 700);
    expect(state.specialists.find((s) => s.id === 'q2')).toMatchObject({
      kind: 'princess',
      owner: 'p1',
      captiveOf: null,
    });
    expect(player(state, 'p2')).toMatchObject({ eliminated: true, neptunium: 0 });
    expect(state.winner).toBe('p1');
    expect(events).toContainEqual({ kind: 'gameWon', at: 610, player: 'p1', reason: 'lastStanding' });
    expect(state.time).toBe(700);
  });

  it('produces 6 drillers per factory each cycle, up to the electrical cap', () => {
    const base = makeState();
    find(base, 'A').drillers = 146;
    find(base, 'E').type = 'factory';
    find(base, 'E').drillers = 0;
    find(base, 'Q').type = 'generator';
    const { state } = advance(base, [], FACTORY_CYCLE);
    expect(find(state, 'A').drillers).toBe(150); // capped at 150
    expect(find(state, 'E').drillers).toBe(6);
    // Not before the cycle completes.
    expect(find(advance(base, [], FACTORY_CYCLE - TICK).state, 'E').drillers).toBe(0);
  });

  it('drills mines at increasing cost', () => {
    const base = makeState();
    find(base, 'A').drillers = 60;
    base.outposts.push(outpost('B', -300, 'p1', 90));
    const orders: Order[] = [
      { kind: 'drillMine', at: TICK, player: 'p1', outpost: 'A' },
      { kind: 'drillMine', at: TICK, player: 'p1', outpost: 'B' },
    ];
    const { state, events } = advance(base, orders, TICK);
    expect(find(state, 'A')).toMatchObject({ type: 'mine', drillers: 10 });
    expect(player(state, 'p1').minesDrilled).toBe(1);
    expect(find(state, 'B')).toMatchObject({ type: 'factory', drillers: 90 });
    expect(events.find((e) => e.kind === 'orderRejected')).toMatchObject({ reason: expect.stringContaining('100') });
  });

  it('accrues Neptunium per mine per outpost owned', () => {
    const base = makeState();
    find(base, 'E').type = 'mine'; // p2: 2 outposts, 1 mine → 2 units/minute
    const { state } = advance(base, [], 6 * TICK);
    expect(player(state, 'p2').neptunium).toBe(2 * 6 * TICK);
    expect(player(state, 'p1').neptunium).toBe(0);
  });

  it('declares a Neptunium win', () => {
    const base = makeState();
    find(base, 'E').type = 'mine';
    player(base, 'p2').neptunium = NEPTUNIUM_TO_WIN * NEPTUNIUM_UNIT - 2 * TICK;
    const { state, events } = advance(base, [], 3 * TICK);
    expect(state.winner).toBe('p2');
    expect(events).toContainEqual({ kind: 'gameWon', at: TICK, player: 'p2', reason: 'neptunium' });
    // Nothing more happens once the game is won.
    expect(player(state, 'p2').neptunium).toBe(NEPTUNIUM_TO_WIN * NEPTUNIUM_UNIT);
  });

  it('costs the previous owner 20% of their Neptunium when a mine is captured', () => {
    const base = makeState();
    const e = find(base, 'E');
    e.type = 'mine';
    e.shieldEnabled = false;
    player(base, 'p2').neptunium = 1000;
    const orders = [launch({ player: 'p1', from: 'A', to: 'E', drillers: 20 })];
    const before = advance(base, orders, 600).state;
    const after = advance(before, orders, 610).state;
    const n = player(before, 'p2').neptunium;
    expect(find(after, 'E').owner).toBe('p1');
    expect(player(after, 'p2').neptunium).toBe(n - Math.floor(n * MINE_LOSS_PENALTY));
  });

  it('resolves a head-on encounter between subs on the same lane', () => {
    const orders = [
      launch({ player: 'p1', from: 'A', to: 'E', drillers: 10 }),
      launch({ player: 'p2', from: 'E', to: 'A', drillers: 4 }),
    ];
    const mid = advance(makeState(), orders, 310);
    // Both left at 10 and travel 600 minutes, so they cross at 310.
    expect(mid.events).toContainEqual({
      kind: 'combat',
      at: 310,
      subs: ['sub-1', 'sub-2'],
      players: ['p1', 'p2'],
      winner: 'p1',
      details: {
        sides: [
          { player: 'p1', drillersBefore: 10, drillersAfter: 6, specialists: 0 },
          { player: 'p2', drillersBefore: 4, drillersAfter: 0, specialists: 0 },
        ],
      },
    });
    expect(mid.state.subs).toHaveLength(1);
    expect(mid.state.subs[0]).toMatchObject({ id: 'sub-1', drillers: 6 });
  });

  it('does not make subs on different lanes fight', () => {
    const base = makeState();
    base.outposts.push(outpost('F', 300, 'p2', 10, { position: { x: 300, y: 300 } }));
    base.outposts.push(outpost('G', 300, 'p2', 0, { position: { x: 300, y: -300 } }));
    // A→E runs along y=0; F→G crosses it at x=300.
    const orders = [
      launch({ player: 'p1', from: 'A', to: 'E', drillers: 10 }),
      launch({ player: 'p2', from: 'F', to: 'G', drillers: 4 }),
    ];
    const { events } = advance(base, orders, 600);
    expect(events.filter((e) => e.kind === 'combat')).toHaveLength(0);
  });

  it('moves specialists with their sub and unloads them at a friendly outpost', () => {
    const base = makeState();
    base.outposts.push(outpost('B', -300, 'p1', 0));
    const orders = [launch({ player: 'p1', from: 'A', to: 'B', specialists: ['q1'] })];
    const mid = advance(base, orders, 20);
    expect(mid.state.specialists[0]!.location).toEqual({ sub: 'sub-1' });
    expect(subPosition(mid.state, mid.state.subs[0]!, 160)).toEqual({ x: -150, y: 0 });
    const end = advance(mid.state, orders, 310);
    expect(end.state.specialists[0]!.location).toEqual({ outpost: 'B' });
  });

  it('is pure and deterministic', () => {
    const base = makeState();
    const orders = [
      launch({ player: 'p1', from: 'A', to: 'E', drillers: 10 }),
      launch({ player: 'p2', from: 'E', to: 'A', drillers: 4 }),
    ];
    const snapshot = structuredClone(base);
    const ordersSnapshot = structuredClone(orders);
    const a = advance(base, orders, 2000);
    const b = advance(base, orders, 2000);
    expect(base).toEqual(snapshot);
    expect(orders).toEqual(ordersSnapshot);
    expect(a).toEqual(b);
  });

  it('ignores orders at or before the current time', () => {
    const base = { ...makeState(), time: 100 };
    const { state } = advance(base, [launch({ at: 100, player: 'p1', from: 'A', to: 'C', drillers: 5 })], 200);
    expect(state.subs).toHaveLength(0);
  });
});

describe('validateOrder', () => {
  const s = makeState();
  const cases: [string, Order, string][] = [
    ['not your outpost', launch({ player: 'p1', from: 'E', to: 'A', drillers: 1 }), 'own'],
    ['too many drillers', launch({ player: 'p1', from: 'A', to: 'C', drillers: 41 }), 'Not enough'],
    ['same outpost', launch({ player: 'p1', from: 'A', to: 'A', drillers: 1 }), 'different'],
    ['empty sub', launch({ player: 'p1', from: 'A', to: 'C' }), 'carry'],
    ['gifting the Queen', launch({ player: 'p1', from: 'A', to: 'E', specialists: ['q1'], isGift: true }), 'Queen'],
    ['specialist elsewhere', launch({ player: 'p2', from: 'E', to: 'A', specialists: ['q2'] }), 'not at'],
    ['unknown outpost', launch({ player: 'p1', from: 'A', to: 'nope', drillers: 1 }), 'Unknown'],
  ];
  it.each(cases)('rejects %s', (_, order, reason) => {
    expect(validateOrder(s, order)).toContain(reason);
  });

  it('accepts a valid launch', () => {
    expect(validateOrder(s, launch({ player: 'p1', from: 'A', to: 'C', drillers: 40, specialists: ['q1'] }))).toBeNull();
  });

  it('rejects orders from eliminated players and after the game ends', () => {
    const out = makeState();
    out.players[0]!.eliminated = true;
    expect(validateOrder(out, launch({ player: 'p1', from: 'A', to: 'C', drillers: 1 }))).toContain('eliminated');
    expect(validateOrder({ ...makeState(), winner: 'p2', endedAt: 100 }, launch({ player: 'p1', from: 'A', to: 'C', drillers: 1 }))).toContain(
      'over',
    );
  });
});

describe('production', () => {
  /** p1 owns three factories (ids deliberately out of order) holding `drillers` each; no generators → cap 150. */
  function underCap(drillers: [number, number, number]): GameState {
    return makeState({
      outposts: [
        outpost('o-10', 0, 'p1', drillers[0]),
        outpost('o-2', 100, 'p1', drillers[1]),
        outpost('o-3', 200, 'p1', drillers[2]),
        outpost('Q', 3000, 'p2', 0, { type: 'generator' }),
      ],
      specialists: [
        { id: 'q1', kind: 'queen', owner: 'p1', location: { outpost: 'o-2' }, captiveOf: null },
        { id: 'q2', kind: 'queen', owner: 'p2', location: { outpost: 'Q' }, captiveOf: null },
      ],
    });
  }
  const made = (before: GameState, after: GameState) =>
    Object.fromEntries(before.outposts.map((o) => [o.id, find(after, o.id).drillers - o.drillers]));

  it('splits the last room under the cap evenly, remainder by ascending outpost id', () => {
    const before = underCap([45, 50, 50]); // 145 of 150 → room 5 for 3 factories
    const after = advance(before, [], FACTORY_CYCLE).state;
    expect(made(before, after)).toEqual({ 'o-10': 1, 'o-2': 2, 'o-3': 2, Q: 0 });
  });

  it('does not depend on the order of state.outposts', () => {
    const a = underCap([45, 50, 50]);
    const b = structuredClone(a);
    b.outposts.reverse();
    const ra = advance(a, [], FACTORY_CYCLE).state;
    const rb = advance(b, [], FACTORY_CYCLE).state;
    for (const o of a.outposts) expect(find(rb, o.id).drillers).toBe(find(ra, o.id).drillers);
  });

  it('produces nothing at the cap and full output with plenty of room', () => {
    const full = underCap([50, 50, 50]);
    expect(made(full, advance(full, [], FACTORY_CYCLE).state)).toEqual({ 'o-10': 0, 'o-2': 0, 'o-3': 0, Q: 0 });
    const roomy = underCap([10, 10, 10]);
    expect(made(roomy, advance(roomy, [], FACTORY_CYCLE).state)).toEqual({ 'o-10': 6, 'o-2': 6, 'o-3': 6, Q: 0 });
  });

  it('never pushes a player over the cap', () => {
    const before = underCap([48, 50, 50]); // room 2 < 3 factories
    const after = advance(before, [], FACTORY_CYCLE).state;
    expect(made(before, after)).toEqual({ 'o-10': 0, 'o-2': 1, 'o-3': 1, Q: 0 });
  });
});

describe('gifts', () => {
  it('rejects gifts to dormant or own outposts', () => {
    const s = makeState();
    s.outposts.push(outpost('B', -300, 'p1', 0));
    const gift = (to: string) => launch({ player: 'p1', from: 'A', to, drillers: 5, isGift: true });
    expect(validateOrder(s, gift('C'))).toBe("Gifts must target another player's outpost.");
    expect(validateOrder(s, gift('B'))).toBe("Gifts must target another player's outpost.");
    expect(validateOrder(s, gift('E'))).toBeNull();
  });

  it("hands a gift's drillers to the other player's outpost", () => {
    const { state } = advance(makeState(), [launch({ player: 'p1', from: 'A', to: 'E', drillers: 5, isGift: true })], 700);
    expect(find(state, 'E')).toMatchObject({ owner: 'p2', drillers: 10 });
  });
});

describe('game end', () => {
  it('ends in a draw when the last players go out in the same tick', () => {
    // Both resign in the same tick, which is the same rule as both losing
    // their Queens at once. (Two Queens can't fall at once any more: a
    // captured Queen becomes the captor's Princess, and she may then succeed
    // her new owner's lost Queen.)
    const orders: Order[] = [
      { kind: 'resign', at: TICK, player: 'p1' },
      { kind: 'resign', at: TICK, player: 'p2' },
    ];
    const { state, events } = advance(makeState(), orders, 3 * TICK);
    expect(state.players.every((p) => p.eliminated)).toBe(true);
    expect(state).toMatchObject({ winner: null, endedAt: TICK });
    expect(events).toContainEqual({ kind: 'gameDrawn', at: TICK, reason: 'eliminated' });
    expect(events.filter((e) => e.kind === 'gameWon')).toHaveLength(0);
    // Nothing changes after the end.
    expect(advance(state, [], 100 * TICK).state).toEqual({ ...state, time: 100 * TICK });
  });

  it('sets endedAt on a win', () => {
    const s = makeState();
    s.players[0]!.neptunium = NEPTUNIUM_TO_WIN * NEPTUNIUM_UNIT;
    expect(advance(s, [], TICK).state).toMatchObject({ winner: 'p1', endedAt: TICK });
  });
});

describe('resign', () => {
  it('eliminates the player and lets the last one standing win', () => {
    const s = makeState();
    s.players[0]!.neptunium = 5000;
    const { state, events } = advance(s, [{ kind: 'resign', at: TICK, player: 'p1' }], 2 * TICK);
    expect(player(state, 'p1')).toMatchObject({ eliminated: true, neptunium: 0 });
    expect(events).toContainEqual({ kind: 'playerEliminated', at: TICK, player: 'p1', reason: 'resigned' });
    expect(state).toMatchObject({ winner: 'p2', endedAt: TICK });
  });

  it('is rejected once the game is over', () => {
    expect(validateOrder({ ...makeState(), endedAt: 10, winner: 'p2' }, { kind: 'resign', at: 20, player: 'p1' })).toContain(
      'over',
    );
  });

  it("skips an eliminated player's later orders without any event", () => {
    const s = makeState({ players: [...makeState().players, { id: 'p3', name: 'Three', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() }] });
    s.outposts.push(outpost('Z', 6000, 'p3', 10));
    s.specialists.push({ id: 'q3', kind: 'queen', owner: 'p3', location: { outpost: 'Z' }, captiveOf: null });
    const orders: Order[] = [
      { kind: 'resign', at: TICK, player: 'p1' },
      launch({ player: 'p1', from: 'A', to: 'C', drillers: 1, at: 3 * TICK }),
      { kind: 'setShield', at: 4 * TICK, player: 'p1', outpost: 'A', enabled: false },
    ];
    const { state, events } = advance(s, orders, 5 * TICK);
    expect(state.endedAt).toBeNull();
    expect(events.filter((e) => e.at > TICK)).toEqual([]);
    expect(find(state, 'A')).toMatchObject({ drillers: 40, shieldEnabled: true });
  });
});

describe('disabling shields', () => {
  const setShield = (outpost: string, enabled: boolean, at = 10): Order => ({ kind: 'setShield', at, player: 'p2', outpost, enabled });

  it('drops the charge to 0 when disabled and keeps it there while off', () => {
    const { state } = advance(makeState(), [setShield('E', false)], 24 * 60);
    expect(find(state, 'E')).toMatchObject({ shieldEnabled: false, shieldProgress: 0 });
  });

  it('recharges from 0 after being re-enabled', () => {
    const orders = [setShield('E', false), setShield('E', true, 20)];
    const { state } = advance(makeState(), orders, 20 + 6 * 60);
    // E has max 8: full in 48h, so 6h after re-enabling it holds 1 charge.
    expect(find(state, 'E').shieldEnabled).toBe(true);
    expect(shieldCharge(find(state, 'E').shieldProgress)).toBe(1);
  });

  it('lets a small sub capture a disabled outpost (the point of disabling)', () => {
    const { state } = advance(makeState(), [setShield('E', false), launch({ player: 'p1', from: 'A', to: 'E', drillers: 6, at: 10 })], 700);
    expect(find(state, 'E').owner).toBe('p1');
  });

  it('switches the shield back on for the new owner after a capture', () => {
    const { state } = advance(makeState(), [setShield('E', false), launch({ player: 'p1', from: 'A', to: 'E', drillers: 6, at: 10 })], 700);
    expect(find(state, 'E').shieldEnabled).toBe(true);
  });
});

describe('ending a game by agreement', () => {
  const vote = (player: string, agree: boolean, at = 10): Order => ({ kind: 'voteEnd', at, player, agree });

  it('ends with no winner once every player still in the game agrees', () => {
    const { state, events } = advance(makeState(), [vote('p1', true), vote('p2', true, 20)], 30);
    expect(state).toMatchObject({ winner: null, endedAt: 20 });
    expect(events).toContainEqual({ kind: 'gameDrawn', at: 20, reason: 'agreed' });
  });

  it('does not end while someone disagrees, and a vote can be withdrawn', () => {
    const one = advance(makeState(), [vote('p1', true)], 30).state;
    expect(one).toMatchObject({ endedAt: null, endVotes: ['p1'] });
    const withdrawn = advance(makeState(), [vote('p1', true), vote('p1', false, 20), vote('p2', true, 30)], 40).state;
    expect(withdrawn).toMatchObject({ endedAt: null, endVotes: ['p2'] });
  });

  it('ignores repeated identical votes', () => {
    const { events } = advance(makeState(), [vote('p1', true), vote('p1', true, 20)], 30);
    expect(events.filter((e) => e.kind === 'endVote')).toHaveLength(1);
  });
});
