import { describe, expect, it } from 'vitest';
import { TICK } from './constants.js';
import { inertHiring } from './hiring.js';
import { progressForCharge } from './shield.js';
import { advance, travelTime, validateOrder } from './simulation.js';
import type { GameState, LaunchOrder, Order, Outpost, Specialist, SpecialistKind } from './types.js';

/*
 * The specialist phase in a real fight, plus the specialists that reach beyond
 * it: Queen succession, the Hypnotist, the Inspector and the Engineer.
 * Sub-vs-sub combat is in `movement-specialists.test.ts`.
 */

function outpost(id: string, x: number, owner: string | null, drillers: number, extra: Partial<Outpost> = {}): Outpost {
  return {
    id,
    name: id,
    // Generators, so the factory cycle doesn't change the numbers mid-test.
    type: 'generator',
    position: { x, y: 0 },
    owner,
    drillers,
    shieldMax: 10,
    shieldProgress: 0,
    shieldEnabled: false,
    ...extra,
  };
}

const spec = (id: string, kind: SpecialistKind, owner: string, at: string, captiveOf: string | null = null): Specialist => ({
  id,
  kind,
  owner,
  location: { outpost: at },
  captiveOf,
});

/** p1 holds A with its Queen, p2 holds B 600 units away. Both shields are off. */
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
    outposts: [outpost('A', 0, 'p1', 40), outpost('B', 600, 'p2', 20)],
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

const find = (state: GameState, id: string) => state.outposts.find((o) => o.id === id)!;
const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

/** Sends a sub from A to B and returns the state after the fight. */
function fight(state: GameState, order: LaunchOrder) {
  const arrival = travelTime(state, order.from, order.to);
  return advance(state, [order], TICK + arrival);
}

/** Puts a specialist of `owner` at `at` and returns the state. */
function withSpecialist(state: GameState, kind: SpecialistKind, owner: string, at: string, id: string): GameState {
  state.specialists.push(spec(id, kind, owner, at));
  state.nextId = Math.max(state.nextId, Number(id.replace(/\D/g, '')) + 1);
  return state;
}

// --- The specialist phase --------------------------------------------------

describe('the specialist phase', () => {
  it('lets a Lieutenant destroy 5 drillers before the driller phase', () => {
    const base = withSpecialist(makeState(), 'lieutenant', 'p1', 'A', 's1');
    // 10 vs 10 would be a tie, so the outpost would hold.
    expect(find(fight(makeState(), launch({ player: 'p1', from: 'A', to: 'B', drillers: 10 })).state, 'B').owner).toBe('p2');
    const { state, events } = fight(base, launch({ player: 'p1', from: 'A', to: 'B', drillers: 10, specialists: ['s1'] }));
    // 10 attackers vs 20 − 5 = 15 defenders: the outpost holds.
    expect(find(state, 'B').owner).toBe('p2');
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toEqual(['Lieutenant destroyed 5 drillers']);

    // One driller more and the capture happens with 5 − 1 = ... 11 − 15 loses,
    // so give the attacker 16: 16 vs 15 leaves 1.
    const won = fight(base, launch({ player: 'p1', from: 'A', to: 'B', drillers: 16, specialists: ['s1'] })).state;
    expect(find(won, 'B')).toMatchObject({ owner: 'p1', drillers: 1 });
  });

  it('lets a Thief take 15% of the defenders for the attacker', () => {
    const state = withSpecialist(makeState(), 'thief', 'p1', 'A', 's1');
    const { events } = fight(state, launch({ player: 'p1', from: 'A', to: 'B', drillers: 10, specialists: ['s1'] }));
    const combat = events.find((e) => e.kind === 'combat')!;
    expect(combat.details.effects).toEqual(['Thief stole 3 drillers']); // ceil(20 × 0.15)
    // 10 + 3 = 13 attackers against 17 defenders: both sides are wiped out
    // and the tie goes to the outpost, which keeps the 4 it had left.
    expect(combat.details.sides[0]).toMatchObject({ drillersBefore: 10, drillersAfter: 0 });
    expect(combat.details.sides[1]).toMatchObject({ drillersBefore: 20, drillersAfter: 4 });
  });

  it('does not let a Thief defending the outpost steal', () => {
    const scene = withSpecialist(makeState(), 'thief', 'p2', 'B', 's1');
    const { state, events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toBeUndefined();
    expect(find(state, 'B')).toMatchObject({ owner: 'p1', drillers: 10 });
  });

  it("lets a General destroy 10 drillers when his side has a specialist standing", () => {
    // The General himself stays at A: his global effect only needs *a*
    // specialist of his side in the fight, and the Thief is on the sub.
    const scene = withSpecialist(makeState(), 'general', 'p1', 'A', 'g');
    withSpecialist(scene, 'thief', 'p1', 'A', 't');
    const { events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30, specialists: ['t'] }));
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toEqual([
      'Thief stole 3 drillers',
      'General destroyed 10 drillers',
    ]);
    // 33 attackers (30 + 3 stolen) against 20 − 10 = 10 defenders.
    expect(events.find((e) => e.kind === 'combat')?.details.sides[1]).toMatchObject({ drillersAfter: 0 });
  });

  it('does nothing for a General whose side has no specialist in the fight', () => {
    const scene = withSpecialist(makeState(), 'general', 'p1', 'A', 'g');
    const { events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toBeUndefined();
  });

  it('lets a King destroy 1 enemy driller per 4 of his own', () => {
    const scene = withSpecialist(makeState(), 'king', 'p2', 'B', 'k');
    // p2 has 20 drillers, so 5 of the attackers die. Unlike the General, the
    // King needs no specialist of his own in the fight.
    const { events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toEqual(['King destroyed 5 drillers']);
    // 25 attackers against 20 defenders: the outpost falls with 5 left.
    expect(events.find((e) => e.kind === 'combat')?.details.sides[0]).toMatchObject({ drillersAfter: 5 });
  });

  it('applies a General and a King together, after the phase', () => {
    const scene = makeState({
      specialists: [
        spec('q1', 'queen', 'p1', 'A'),
        spec('q2', 'queen', 'p2', 'B'),
        spec('g', 'general', 'p1', 'A'),
        spec('k', 'king', 'p1', 'A'),
        spec('t', 'thief', 'p1', 'A'),
      ],
    });
    const { events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30, specialists: ['t'] }));
    // The Thief (priority 4) takes 3 first, leaving 33; then the General's
    // flat 10 and the King's floor(33 / 4) = 8.
    expect(events.find((e) => e.kind === 'combat')?.details.effects).toEqual([
      'Thief stole 3 drillers',
      'General destroyed 10 drillers',
      'King destroyed 8 drillers',
    ]);
  });
});

// --- Engineers -------------------------------------------------------------

describe('engineer', () => {
  it('repairs 25% of what you lost after a win', () => {
    const scene = withSpecialist(makeState(), 'engineer', 'p1', 'A', 's1');
    // 30 attackers beat 20 defenders, so 20 drillers were lost in the fight.
    const { state: won } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(find(won, 'B')).toMatchObject({ owner: 'p1', drillers: 15 }); // 10 + ceil(20 / 4)
  });

  it('repairs another 25% where the Engineer stands', () => {
    const scene = withSpecialist(makeState(), 'engineer', 'p1', 'B', 's1');
    const { state: won } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(find(won, 'B').drillers).toBe(20); // 10 + 5 + 5
  });

  it('counts an Engineer riding the attacking sub as present', () => {
    const scene = withSpecialist(makeState(), 'engineer', 'p1', 'A', 's1');
    const { state: won } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30, specialists: ['s1'] }));
    expect(find(won, 'B').drillers).toBe(20); // 10 + 5 + 5
  });

  it('repairs what the specialist phase took too', () => {
    // p2's Lieutenant destroys 5 of the 30 first: 25 beat 20, so p1 lost 25
    // in all and gets ceil(25 / 4) = 7 back, not ceil(20 / 4) = 5.
    const scene = withSpecialist(makeState(), 'engineer', 'p1', 'A', 's1');
    withSpecialist(scene, 'lieutenant', 'p2', 'B', 's2');
    const { state: won } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(find(won, 'B')).toMatchObject({ owner: 'p1', drillers: 5 + 7 });
  });

  it('repairs nothing when your side lost the fight', () => {
    const scene = withSpecialist(makeState(), 'engineer', 'p1', 'A', 's1');
    const { state: after } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5 }));
    // The Engineer is p1's, and p1 lost, so nobody repairs anything.
    expect(find(after, 'B')).toMatchObject({ owner: 'p2', drillers: 15 });
  });
});

// --- Queens and Princesses -------------------------------------------------

describe('Queen succession', () => {
  it('promotes the nearest Princess instead of eliminating her owner', () => {
    const scene = withSpecialist(makeState(), 'princess', 'p1', 'A', 'pr1');
    // p1's Queen travels to B and loses the fight, so she is captured there.
    const { state: after, events } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5, specialists: ['q1'] }));
    expect(player(after, 'p1')).toMatchObject({ eliminated: false });
    // The captured Queen joins p2 as a Princess; p1's own Princess takes over.
    expect(after.specialists.find((s) => s.id === 'q1')).toMatchObject({ kind: 'princess', owner: 'p2' });
    expect(after.specialists.find((s) => s.id === 'pr1')).toMatchObject({ kind: 'queen', owner: 'p1' });
    expect(events).toContainEqual({
      kind: 'queenSucceeded',
      at: 610,
      player: 'p1',
      specialist: 'pr1',
      lostQueen: 'q1',
    });
    expect(find(after, 'B')).toMatchObject({ owner: 'p2' });
  });

  it('eliminates the owner when the only Princess is a prisoner', () => {
    const scene = withSpecialist(makeState(), 'princess', 'p1', 'A', 'pr1');
    scene.specialists.find((s) => s.id === 'pr1')!.captiveOf = 'p2';
    const { state: after } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5, specialists: ['q1'] }));
    expect(player(after, 'p1')).toMatchObject({ eliminated: true });
    expect(after.specialists.find((s) => s.id === 'pr1')!.kind).toBe('princess');
  });

  it('takes the nearest Princess to the lost Queen, not just the first one', () => {
    const scene = makeState({
      specialists: [
        spec('q1', 'queen', 'p1', 'A'),
        spec('q2', 'queen', 'p2', 'B'),
        spec('far', 'princess', 'p1', 'A'),
        spec('near', 'princess', 'p1', 'B'),
      ],
    });
    const { state: after } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5, specialists: ['q1'] }));
    expect(after.specialists.find((s) => s.id === 'near')!.kind).toBe('queen');
    expect(after.specialists.find((s) => s.id === 'far')!.kind).toBe('princess');
  });

  it("loses a Queen with no Princess to replace her, whoever takes her", () => {
    // p2's Queen is captured: p2 has no Princess, so p2 is out and p1 wins.
    const { state } = fight(makeState(), launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(player(state, 'p2')).toMatchObject({ eliminated: true });
    expect(state.specialists.find((s) => s.id === 'q2')).toMatchObject({ kind: 'princess', owner: 'p1' });
    expect(state.winner).toBe('p1');
  });
});

// --- Hypnotist -------------------------------------------------------------

describe('hypnotist', () => {
  /** p2 holds B with a prisoner of p1's at it, and p1 takes B with a Hypnotist. */
  const scene = () => {
    const state = withSpecialist(makeState(), 'thief', 'p1', 'B', 'prisoner');
    state.specialists.find((s) => s.id === 'prisoner')!.captiveOf = 'p2';
    state.specialists.find((s) => s.id === 'q2')!.captiveOf = 'p2';
    return withSpecialist(state, 'hypnotist', 'p1', 'A', 'hyp');
  };

  it('takes every prisoner at the outpost he is on', () => {
    const { state } = fight(scene(), launch({ player: 'p1', from: 'A', to: 'B', drillers: 30, specialists: ['hyp'] }));
    for (const id of ['prisoner', 'q2']) {
      expect(state.specialists.find((s) => s.id === id), id).toMatchObject({
        owner: 'p1',
        captiveOf: null,
        location: { outpost: 'B' },
      });
    }
    // A converted enemy Queen is a Princess, and p2 is out.
    expect(state.specialists.find((s) => s.id === 'q2')!.kind).toBe('princess');
    expect(player(state, 'p2')).toMatchObject({ eliminated: true });
  });

  it('converts nothing when he is not at the outpost', () => {
    // The Hypnotist stays at A: he is not converted (he was free), and the
    // prisoners held at B just change hands.
    const withoutHim = withSpecialist(scene(), 'thief', 'p1', 'A', 'other');
    const { state } = fight(withoutHim, launch({ player: 'p1', from: 'A', to: 'B', drillers: 30 }));
    expect(state.specialists.find((s) => s.id === 'hyp')).toMatchObject({ owner: 'p1', location: { outpost: 'A' } });
    expect(state.specialists.find((s) => s.id === 'q2')).toMatchObject({ owner: 'p2', captiveOf: 'p1' });
    // p1's own prisoner is simply freed.
    expect(state.specialists.find((s) => s.id === 'prisoner')).toMatchObject({ owner: 'p1', captiveOf: null });
  });
});

// --- Inspector -------------------------------------------------------------

describe('inspector', () => {
  it('recharges her outpost’s shield after a fight there', () => {
    const state = withSpecialist(makeState(), 'inspector', 'p2', 'B', 's1');
    find(state, 'B').shieldEnabled = true;
    find(state, 'B').shieldProgress = progressForCharge(4);
    const { state: after } = fight(state, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5 }));
    expect(find(after, 'B')).toMatchObject({ owner: 'p2' });
    expect(find(after, 'B').shieldProgress).toBe(progressForCharge(30)); // 10 + the Queen's 20
  });

  it('recharges when a sub arrives at her outpost', () => {
    const scene = makeState();
    find(scene, 'A').shieldEnabled = true;
    scene.outposts.push(outpost('C', -600, 'p1', 10));
    withSpecialist(scene, 'inspector', 'p1', 'C', 's1');
    const { state: after } = advance(
      scene,
      [launch({ player: 'p1', from: 'C', to: 'A', drillers: 5, specialists: ['s1'] })],
      TICK + travelTime(scene, 'C', 'A'),
    );
    expect(find(after, 'A').shieldProgress).toBe(progressForCharge(30)); // 10 + the Queen's 20
  });

  it('does not recharge for a sub arriving without her', () => {
    // Inspector at A, a plain reinforcement from C: the shield just keeps
    // charging as it would without her (goal.md: "when arriving there").
    const scene = (inspector: boolean) => {
      const state = makeState();
      find(state, 'A').shieldEnabled = true;
      state.outposts.push(outpost('C', -60, 'p1', 10));
      if (inspector) withSpecialist(state, 'inspector', 'p1', 'A', 's1');
      return advance(state, [launch({ player: 'p1', from: 'C', to: 'A', drillers: 5 })], TICK + travelTime(state, 'C', 'A'))
        .state;
    };
    expect(find(scene(true), 'A').shieldProgress).toBe(find(scene(false), 'A').shieldProgress);
    expect(find(scene(true), 'A').shieldProgress).toBeLessThan(progressForCharge(30));
  });

  it('leaves a disabled shield at 0', () => {
    const scene = makeState();
    find(scene, 'A').shieldEnabled = false;
    scene.outposts.push(outpost('C', -600, 'p1', 10));
    withSpecialist(scene, 'inspector', 'p1', 'C', 's1');
    const { state: after } = advance(
      scene,
      [launch({ player: 'p1', from: 'C', to: 'A', drillers: 5, specialists: ['s1'] })],
      TICK + travelTime(scene, 'C', 'A'),
    );
    expect(find(after, 'A')).toMatchObject({ shieldEnabled: false, shieldProgress: 0 });
  });

  it('recharges to the maximum the specialists allow', () => {
    const scene = withSpecialist(makeState(), 'inspector', 'p2', 'B', 'i');
    withSpecialist(scene, 'securityChief', 'p2', 'B', 'c');
    find(scene, 'B').shieldEnabled = true;
    find(scene, 'B').shieldProgress = progressForCharge(1);
    const { state: after } = fight(scene, launch({ player: 'p1', from: 'A', to: 'B', drillers: 5 }));
    // 10 + 10 for the chief everywhere + 10 more at her outpost + the Queen.
    expect(find(after, 'B').shieldProgress).toBe(progressForCharge(50));
  });
});

// --- Orders ----------------------------------------------------------------

describe('promotion and elimination still check the Queen', () => {
  it('keeps refusing a Queen gift', () => {
    const state = makeState();
    state.outposts.push(outpost('C', -600, 'p2', 0));
    const order = launch({ player: 'p1', from: 'A', to: 'C', drillers: 5, specialists: ['q1'], isGift: true });
    expect(validateOrder(state, order)).toBe('The Queen cannot be gifted.');
    const { events } = advance(state, [order as Order], 2 * TICK);
    expect(events.filter((e) => e.kind === 'orderRejected')).toHaveLength(1);
  });
});