import { describe, expect, it } from 'vitest';
import {
  FACTORY_CYCLE,
  FACTORY_DRILLERS_PER_CYCLE,
  FOREMAN_DRILLERS_PER_CYCLE,
  FOREMAN_RADIUS_SHARE,
  SONAR_RANGE,
} from './constants.js';
import { inertHiring } from './hiring.js';
import { advance } from './simulation.js';
import type { GameState, Outpost, OutpostType, Specialist, SpecialistKind } from './types.js';

/*
 * The Foreman through a real production cycle: her bonus reaches the factories
 * within half a sonar of her outpost, and the electrical cap still applies.
 * The query itself (`productionBonusAt`) is unit-tested in specialists.test.ts.
 */

const RADIUS = SONAR_RANGE * FOREMAN_RADIUS_SHARE;

function outpost(id: string, x: number, type: OutpostType, drillers: number): Outpost {
  return {
    id,
    name: id,
    type,
    position: { x, y: 0 },
    owner: 'p1',
    drillers,
    shieldMax: 10,
    shieldProgress: 0,
    shieldEnabled: false,
  };
}

const spec = (id: string, kind: SpecialistKind, at: string): Specialist => ({
  id,
  kind,
  owner: 'p1',
  location: { outpost: at },
  captiveOf: null,
});

/**
 * p1 holds a factory F1 with a Foreman, F2 inside her radius, F3 outside it,
 * and a generator G for the Queen. 10 drillers everywhere.
 */
function makeState(): GameState {
  return {
    time: 0,
    seed: 1,
    width: 4000,
    height: 1000,
    players: [{ id: 'p1', name: 'One', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() }],
    outposts: [
      outpost('F1', 0, 'factory', 10),
      outpost('F2', RADIUS - 10, 'factory', 10),
      outpost('F3', RADIUS + 10, 'factory', 10),
      outpost('G', 3000, 'generator', 10),
    ],
    subs: [],
    specialists: [spec('q1', 'queen', 'G'), spec('f1', 'foreman', 'F1')],
    nextId: 2,
    winner: null,
    endedAt: null,
    endVotes: [],
  };
}

const drillers = (state: GameState, id: string) => state.outposts.find((o) => o.id === id)!.drillers;

describe('foreman production', () => {
  it('adds +4 per cycle to factories within half a sonar of her outpost, not beyond', () => {
    const { state } = advance(makeState(), [], FACTORY_CYCLE);
    const boosted = 10 + FACTORY_DRILLERS_PER_CYCLE + FOREMAN_DRILLERS_PER_CYCLE;
    expect(drillers(state, 'F1')).toBe(boosted);
    expect(drillers(state, 'F2')).toBe(boosted);
    expect(drillers(state, 'F3')).toBe(10 + FACTORY_DRILLERS_PER_CYCLE);
    expect(drillers(state, 'G')).toBe(10);
  });

  it('still stops at the electrical cap', () => {
    // Cap with one generator is 200; 190 already exist, so only 10 more fit
    // (not 6+4 + 6+4 + 6 = 26), shared between the three factories.
    const start = makeState();
    start.outposts.find((o) => o.id === 'G')!.drillers = 160;
    const { state } = advance(start, [], FACTORY_CYCLE);
    const total = state.outposts.reduce((n, o) => n + o.drillers, 0);
    expect(total).toBe(200);
    expect(['F1', 'F2', 'F3'].map((id) => drillers(state, id) - 10).sort()).toEqual([3, 3, 4]);
  });

  it('gives nothing while she is travelling on a sub', () => {
    const start = makeState();
    start.subs.push({
      id: 's9',
      owner: 'p1',
      from: 'F1',
      to: 'G',
      drillers: 0,
      specialists: ['f1'],
      launchedAt: 0,
      arrivesAt: 100 * FACTORY_CYCLE,
      isGift: false,
      speed: 1,
      lastRedirectAt: null,
    });
    start.specialists.find((s) => s.id === 'f1')!.location = { sub: 's9' };
    const { state } = advance(start, [], FACTORY_CYCLE);
    for (const id of ['F1', 'F2', 'F3']) expect(drillers(state, id)).toBe(10 + FACTORY_DRILLERS_PER_CYCLE);
  });
});
