import { describe, expect, it } from 'vitest';
import { NAVIGATOR_COOLDOWN, TICK } from './constants.js';
import { inertHiring } from './hiring.js';
import { advance, subPosition, travelTime, validateOrder } from './simulation.js';
import type { GameState, LaunchOrder, Order, Outpost, RedirectOrder, Specialist, SpecialistKind, Sub } from './types.js';

/*
 * Travel speed, the Admiral's bonus, redirecting with a Navigator, and the
 * sub-vs-sub combat the specialists turn on its head.
 */

function outpost(id: string, x: number, owner: string | null, drillers: number): Outpost {
  return {
    id,
    name: id,
    type: 'generator', // generators don't produce, so the numbers stay put
    position: { x, y: 0 },
    owner,
    drillers,
    shieldMax: 10,
    shieldProgress: 0,
    shieldEnabled: false,
  };
}

const spec = (id: string, kind: SpecialistKind, owner: string, at: string): Specialist => ({
  id,
  kind,
  owner,
  location: { outpost: at },
  captiveOf: null,
});

/** A at the origin, C 600 west, B 600 east; A and B hold the Queens. */
function makeState(over: Partial<GameState> = {}): GameState {
  return {
    time: 0,
    seed: 1,
    width: 4000,
    height: 1000,
    players: [
      { id: 'p1', name: 'One', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
      { id: 'p2', name: 'Two', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
    ],
    outposts: [outpost('A', 0, 'p1', 40), outpost('C', -600, 'p1', 40), outpost('B', 600, 'p2', 40)],
    subs: [],
    specialists: [spec('q1', 'queen', 'p1', 'A'), spec('q2', 'queen', 'p2', 'B')],
    nextId: 3,
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

const redirect = (o: Partial<RedirectOrder> & Pick<RedirectOrder, 'player' | 'sub' | 'to'>): RedirectOrder => ({
  kind: 'redirect',
  at: TICK,
  ...o,
});

const withSpecialist = (kind: SpecialistKind, owner: string, at: string, id: string) => (state: GameState) => {
  state.specialists.push(spec(id, kind, owner, at));
  return state;
};

const subIn = (state: GameState, id: string) => state.subs.find((s) => s.id === id) as Sub;

/** A sub that left at 0 and arrives at 600, i.e. at 1.0 speed. */
function flying(id: string, owner: string, from: string, to: string, drillers: number): Sub {
  return { id, owner, from, to, drillers, specialists: [], launchedAt: 0, arrivesAt: 600, isGift: false, speed: 1, lastRedirectAt: null };
}

// --- Speed -----------------------------------------------------------------

describe('travel speed', () => {
  it('halves the trip for a Helmsman and freezes the speed on the sub', () => {
    const state = withSpecialist('helmsman', 'p1', 'A', 'h')(makeState());
    expect(travelTime(state, 'A', 'B')).toBe(600);
    expect(travelTime(state, 'A', 'B', { owner: 'p1', cargo: [state.specialists[2]!] })).toBe(300);
    const { state: launched } = advance(
      state,
      [launch({ player: 'p1', from: 'A', to: 'B', drillers: 10, specialists: ['h'] })],
      TICK,
    );
    expect(subIn(launched, 'sub-3')).toMatchObject({ speed: 2, arrivesAt: TICK + 300 });
  });

  it('arrives earlier for real: the sub is there at 310, not 610', () => {
    const state = withSpecialist('helmsman', 'p1', 'A', 'h')(makeState());
    const { events } = advance(
      state,
      [launch({ player: 'p1', from: 'A', to: 'B', drillers: 30, specialists: ['h'] })],
      400,
    );
    expect(events.find((e) => e.kind === 'subArrived')?.at).toBe(310);
    expect(events.find((e) => e.kind === 'combat')?.at).toBe(310);
  });

  it('speeds a Lieutenant at 1.5×', () => {
    const state = withSpecialist('lieutenant', 'p1', 'A', 'l')(makeState());
    expect(travelTime(state, 'A', 'B', { owner: 'p1', cargo: [state.specialists[2]!] })).toBe(400);
  });

  it('gives the Admiral +50% only to subs carrying no specialist', () => {
    const state = withSpecialist('admiral', 'p1', 'A', 'ad')(makeState());
    const helm = withSpecialist('helmsman', 'p1', 'A', 'h')(state);
    // 600 / 1.5 = 400.
    expect(travelTime(helm, 'A', 'B', { owner: 'p1', cargo: [] })).toBe(400);
    expect(travelTime(helm, 'A', 'B', { owner: 'p1', cargo: [helm.specialists[3]!] })).toBe(300);
    // The enemy gets nothing from your Admiral.
    expect(travelTime(helm, 'B', 'A', { owner: 'p2', cargo: [] })).toBe(600);
  });
});

// --- Redirect --------------------------------------------------------------

describe('redirect', () => {
  const launched = () => {
    const state = withSpecialist('navigator', 'p1', 'A', 'n')(makeState());
    const { state: after } = advance(
      state,
      [launch({ player: 'p1', from: 'A', to: 'B', drillers: 10, specialists: ['n'] })],
      TICK,
    );
    return after;
  };

  it('turns where the sub is, and measures the new trip from there', () => {
    const state = launched();
    // Launched at 10 towards B, it is 10 units east of A at 20. C is 600
    // west of A, so the new trip is 610, not the 600 from A.
    const { state: after, events } = advance(
      state,
      [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 2 * TICK })],
      2 * TICK,
    );
    expect(subIn(after, 'sub-3')).toMatchObject({
      to: 'C',
      origin: { x: 10, y: 0 },
      launchedAt: 2 * TICK,
      arrivesAt: 2 * TICK + 610,
      lastRedirectAt: 2 * TICK,
    });
    expect(events).toContainEqual({ kind: 'subRedirected', at: 2 * TICK, sub: 'sub-3', owner: 'p1', from: 'B', to: 'C' });
  });

  it('does not jump: the position at the turn is the same before and after', () => {
    const state = advance(launched(), [], 5 * TICK).state;
    const before = subPosition(state, subIn(state, 'sub-3'), 5 * TICK);
    const turned = advance(state, [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 6 * TICK })], 6 * TICK).state;
    const sub = subIn(turned, 'sub-3');
    expect(subPosition(turned, sub, 6 * TICK)).toEqual({ x: before.x + TICK, y: 0 });
    // Ten minutes later it has moved 10 units west, towards C.
    expect(subPosition(turned, sub, 7 * TICK)).toEqual({ x: before.x, y: 0 });
  });

  it('reaches the new target', () => {
    const state = launched();
    const early = advance(state, [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 2 * TICK })], 2 * TICK + 600).state;
    expect(early.outposts.find((o) => o.id === 'C')!.drillers).toBe(40);
    const { state: after } = advance(early, [], 2 * TICK + 610);
    expect(after.outposts.find((o) => o.id === 'C')!.drillers).toBe(50); // 40 + the sub's 10
  });

  it('can turn straight back home, arriving from where it is', () => {
    const state = advance(launched(), [], 20 * TICK).state; // 190 east of A
    const { state: after } = advance(state, [redirect({ player: 'p1', sub: 'sub-3', to: 'A', at: 21 * TICK })], 21 * TICK);
    expect(subIn(after, 'sub-3')).toMatchObject({ from: 'B', to: 'A', arrivesAt: 21 * TICK + 200 });
  });

  /** p2's sub following p1's Navigator sub from A towards B, 90 minutes behind. */
  const withFollower = () => {
    const state = launched();
    state.subs.push({
      id: 'sub-9',
      owner: 'p2',
      from: 'A',
      to: 'B',
      drillers: 4,
      specialists: [],
      launchedAt: 100,
      arrivesAt: 700,
      isGift: false,
      speed: 1,
      lastRedirectAt: null,
    });
    return state;
  };

  it('a sub that turns back meets whoever was following it', () => {
    // At 200 p1 is at 190 and the follower at 100. Heading towards each
    // other, they meet at 245, resolved in the tick at 250.
    const { events } = advance(withFollower(), [redirect({ player: 'p1', sub: 'sub-3', to: 'A', at: 200 })], 300);
    expect(events.find((e) => e.kind === 'combat')).toMatchObject({ at: 250, subs: ['sub-3', 'sub-9'], winner: 'p1' });
  });

  /** p2's sub coming the other way, B → A: without a turn they meet at 305. */
  const headOn = () => {
    const state = launched();
    state.subs.push({
      id: 'sub-9',
      owner: 'p2',
      from: 'B',
      to: 'A',
      drillers: 4,
      specialists: [],
      launchedAt: 0,
      arrivesAt: 600,
      isGift: false,
      speed: 1,
      lastRedirectAt: null,
    });
    return state;
  };

  it('a turn onto a new course leaves the lane, so the oncoming sub is missed', () => {
    const { events } = advance(headOn(), [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 2 * TICK })], 400);
    expect(events.some((e) => e.kind === 'combat')).toBe(false);
  });

  it('a redirect in the very tick of a fight comes too late to dodge it', () => {
    const { state, events } = advance(headOn(), [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 310 })], 310);
    expect(events.find((e) => e.kind === 'combat')).toMatchObject({ at: 310, winner: 'p1' });
    // The winner carries on, and then turns.
    expect(subIn(state, 'sub-3')).toMatchObject({ to: 'C', origin: { x: 300, y: 0 } });
  });

  it('needs a Navigator, your own sub, and a real change of plan', () => {
    const state = launched();
    expect(validateOrder(state, redirect({ player: 'p2', sub: 'sub-3', to: 'C' }))).toBe('That sub is not yours.');
    expect(validateOrder(state, redirect({ player: 'p1', sub: 'sub-9', to: 'C' }))).toBe('That sub has already arrived.');
    expect(validateOrder(state, redirect({ player: 'p1', sub: 'sub-3', to: 'B' }))).toBe('The sub is already going there.');
    // Turning back home is allowed: it's how a sub retreats.
    expect(validateOrder(state, redirect({ player: 'p1', sub: 'sub-3', to: 'A' }))).toBeNull();
    // Without the Navigator aboard.
    const bare = advance(state, [], TICK).state;
    const noNav = structuredClone(bare);
    noNav.subs[0]!.specialists = [];
    expect(validateOrder(noNav, redirect({ player: 'p1', sub: 'sub-3', to: 'C' }))).toBe(
      'That sub carries no Navigator.',
    );
  });

  it('waits 8 game hours between redirects', () => {
    const state = launched();
    const first = advance(state, [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 2 * TICK })], 2 * TICK).state;
    const soon = advance(first, [redirect({ player: 'p1', sub: 'sub-3', to: 'A', at: 2 * TICK + TICK })], 2 * TICK + TICK)
      .state;
    expect(subIn(soon, 'sub-3').to).toBe('C');
    expect(validateOrder(soon, redirect({ player: 'p1', sub: 'sub-3', to: 'B' }))).toBe(
      'The Navigator needs 8 game hours between redirects.',
    );
    const later = advance(first, [], NAVIGATOR_COOLDOWN + 3 * TICK).state;
    expect(validateOrder(later, redirect({ player: 'p1', sub: 'sub-3', to: 'B' }))).toBeNull();
  });

  it('is refused by the engine when the sub has already arrived', () => {
    const state = launched();
    const { events } = advance(state, [redirect({ player: 'p1', sub: 'sub-3', to: 'C', at: 700 })], 800);
    expect(events.filter((e) => e.kind === 'orderRejected')).toHaveLength(1);
    expect(events.some((e) => e.kind === 'subRedirected')).toBe(false);
  });
});

// --- Sub-vs-sub ------------------------------------------------------------

describe('sub-vs-sub combat', () => {
  /** Two subs meeting head-on at 300, with `with` riding on p1's sub. */
  const base = (with_?: SpecialistKind) => {
    const state = makeState({ nextId: 3 });
    state.subs = [
      flying('sub-1', 'p1', 'A', 'B', 12),
      flying('sub-2', 'p2', 'B', 'A', 10),
    ];
    if (with_) {
      state.specialists.push({ id: 'cargo', kind: with_, owner: 'p1', location: { sub: 'sub-1' }, captiveOf: null });
      state.subs[0]!.specialists = ['cargo'];
    }
    return state;
  };

  it('is decided by drillers, as before', () => {
    const { state, events } = advance(base(), [], 400);
    expect(events.find((e) => e.kind === 'combat')).toMatchObject({ winner: 'p1' });
    expect(state.subs.find((s) => s.id === 'sub-1')!.drillers).toBe(2);
  });

  it('a Lieutenant on the sub destroys 5 of the enemy before the fight', () => {
    const { events } = advance(base('lieutenant'), [], 400);
    const combat = events.find((e) => e.kind === 'combat')!;
    expect(combat.details.effects).toEqual(['Lieutenant destroyed 5 drillers']);
    expect(combat.details.sides[0]).toMatchObject({ drillersBefore: 12, drillersAfter: 7 });
  });

  it('a Thief on the sub takes 15% for his side', () => {
    const { events } = advance(base('thief'), [], 400);
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toEqual(['Thief stole 2 drillers']);
  });

  it('an Engineer on the winning sub repairs what it lost', () => {
    const { state } = advance(base('engineer'), [], 400);
    // 2 survivors out of 12, so 10 were lost: ceil(10 / 4) = 3 from her global
    // quarter plus 3 more where she stands.
    expect(state.subs.find((s) => s.id === 'sub-1')!.drillers).toBe(8);
  });

  it('sends the loser’s specialists to the winner’s nearest outpost', () => {
    const state = base('thief');
    state.specialists.push({ id: 'cargo2', kind: 'foreman', owner: 'p2', location: { sub: 'sub-2' }, captiveOf: null });
    state.subs[1]!.specialists = ['cargo2'];
    const { state: after } = advance(state, [], 400);
    expect(after.specialists.find((s) => s.id === 'cargo2')).toMatchObject({
      captiveOf: 'p1',
      location: { outpost: 'A' },
    });
  });
});