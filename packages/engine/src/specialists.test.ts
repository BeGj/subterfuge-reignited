import { describe, expect, it } from 'vitest';
import {
  KING_SHIELD_DELTA,
  OFFICER_SPEED,
  QUEEN_SHIELD_BONUS,
  SECURITY_CHIEF_SHIELD_BONUS,
  SONAR_RANGE,
  TICK,
} from './constants.js';
import { inertHiring } from './hiring.js';
import {
  SPECIALIST_CATEGORIES,
  SPECIALISTS,
  cargoSpeed,
  drillerDestroyedInCombat,
  engineerRepair,
  hireableKinds,
  productionBonusAt,
  runSpecialistPhase,
  shieldMaxAt,
  sonarRangeAt,
  speedFor,
  type CombatFighter,
} from './specialists.js';
import type { GameState, Outpost, Specialist, SpecialistKind, Sub } from './types.js';

// --- Fixture ---------------------------------------------------------------

function outpost(id: string, x: number, y: number, owner: string | null, extra: Partial<Outpost> = {}): Outpost {
  return { id, name: id, type: 'factory', position: { x, y }, owner, drillers: 0, shieldMax: 10, shieldProgress: 0, shieldEnabled: true, ...extra };
}

function spec(id: string, kind: SpecialistKind, owner: string, at: string, captiveOf: string | null = null): Specialist {
  return { id, kind, owner, location: { outpost: at }, captiveOf };
}

/** One player owning two outposts: A at the origin, B half a sonar east. */
function makeState(over: Partial<GameState> = {}): GameState {
  return {
    time: 0,
    seed: 1,
    width: 10_000,
    height: 2000,
    players: [
      { id: 'p1', name: 'One', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
      { id: 'p2', name: 'Two', neptunium: 0, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
    ],
    outposts: [
      outpost('A', 0, 0, 'p1'),
      outpost('B', SONAR_RANGE / 2, 0, 'p1'),
      outpost('E', 5000, 0, 'p2'),
    ],
    subs: [],
    specialists: [],
    nextId: 1,
    winner: null,
    endedAt: null,
    endVotes: [],
    ...over,
  };
}

const at = (state: GameState, id: string) => state.outposts.find((o) => o.id === id)!;

function fighter(owner: string, drillers: number, kinds: SpecialistKind[] = []): CombatFighter {
  return {
    owner,
    drillers,
    specialists: kinds.map((kind, i) => spec(`s${owner}-${i}`, kind, owner, 'A')),
  };
}

const sub = (over: Partial<Sub> = {}): Sub => ({
  id: 'sub-1',
  owner: 'p1',
  from: 'A',
  to: 'E',
  drillers: 10,
  specialists: [],
  launchedAt: 0,
  arrivesAt: TICK,
  isGift: false,
  speed: 1,
  lastRedirectAt: null,
  ...over,
});

// --- Catalogue -------------------------------------------------------------

describe('the catalogue', () => {
  const kinds = Object.keys(SPECIALISTS) as SpecialistKind[];

  it('gives every kind a display name, a category and a blurb', () => {
    for (const kind of kinds) {
      expect(SPECIALISTS[kind].name.length, kind).toBeGreaterThan(0);
      expect(SPECIALISTS[kind].blurb.length, kind).toBeGreaterThan(10);
      expect(SPECIALIST_CATEGORIES, kind).toContain(SPECIALISTS[kind].category);
    }
  });

  it('links promotions in both directions', () => {
    for (const kind of kinds) {
      const to = SPECIALISTS[kind].promotesTo;
      if (!to) continue;
      expect(SPECIALISTS[to].promotedFrom, `${kind} → ${to}`).toBe(kind);
    }
    for (const kind of kinds) {
      const from = SPECIALISTS[kind].promotedFrom;
      if (!from) continue;
      expect(SPECIALISTS[from].promotesTo, `${from} → ${kind}`).toBe(kind);
      expect(SPECIALISTS[kind].hireable, `${kind} is reached by promotion, not hiring`).toBe(false);
    }
  });

  it('only hires the Queen and promoted kinds out of the decks', () => {
    const hireable = hireableKinds();
    expect(hireable).not.toContain('queen');
    expect(hireable).not.toContain('general');
    expect(hireable.sort()).toEqual([...hireable].sort());
    for (const kind of hireable) expect(SPECIALISTS[kind].hireable, kind).toBe(true);
    // Every category has something to offer.
    for (const category of SPECIALIST_CATEGORIES) {
      expect(hireableKinds(category).length, category).toBeGreaterThan(0);
    }
  });
});

// --- Movement --------------------------------------------------------------

describe('cargoSpeed', () => {
  it('is 1 for an empty cargo', () => {
    expect(cargoSpeed([])).toBe(1);
  });

  it('takes the fastest specialist, never the product', () => {
    expect(cargoSpeed(['helmsman'])).toBe(2);
    expect(cargoSpeed(['helmsman', 'lieutenant', 'admiral'])).toBe(2);
    expect(cargoSpeed(['lieutenant', 'general', 'admiral'])).toBe(OFFICER_SPEED);
    expect(cargoSpeed(['thief', 'queen'])).toBe(1);
  });

  it("gives the Admiral's bonus only to subs with no specialist", () => {
    expect(cargoSpeed([], { ownerHasAdmiral: true })).toBe(1.5);
    expect(cargoSpeed(['thief'], { ownerHasAdmiral: true })).toBe(1);
    expect(cargoSpeed([], { ownerHasAdmiral: false })).toBe(1);
  });
});

describe('speedFor', () => {
  it('uses the free cargo and whether the destination is one of your outposts', () => {
    const state = makeState({
      specialists: [spec('h', 'helmsman', 'p1', 'A'), spec('adm', 'admiral', 'p1', 'A')],
    });
    expect(speedFor(state, { owner: 'p1', cargo: [state.specialists[0]!], to: 'E' })).toBe(2);
    // Carrying someone: no Admiral bonus.
    expect(speedFor(state, { owner: 'p1', cargo: [state.specialists[0]!], to: 'B' })).toBe(2);
    expect(speedFor(state, { owner: 'p1', cargo: [], to: 'E' })).toBe(1.5);
    expect(speedFor(state, { owner: 'p2', cargo: [], to: 'E' })).toBe(1);
  });

  it('ignores a captive specialist', () => {
    const state = makeState({ specialists: [spec('h', 'helmsman', 'p2', 'E', 'p1')] });
    expect(speedFor(state, { owner: 'p2', cargo: [state.specialists[0]!], to: 'E' })).toBe(1);
  });
});

// --- Shields ---------------------------------------------------------------

describe('shieldMaxAt', () => {
  it("adds the Queen's bonus only where she stands", () => {
    const state = makeState({ specialists: [spec('q', 'queen', 'p1', 'A')] });
    expect(shieldMaxAt(state, at(state, 'A'))).toBe(10 + QUEEN_SHIELD_BONUS);
    expect(shieldMaxAt(state, at(state, 'B'))).toBe(10);
  });

  it('gives the Security Chief +10 everywhere and +10 more at her outpost', () => {
    const state = makeState({ specialists: [spec('c', 'securityChief', 'p1', 'A')] });
    expect(shieldMaxAt(state, at(state, 'A'))).toBe(10 + 2 * SECURITY_CHIEF_SHIELD_BONUS);
    expect(shieldMaxAt(state, at(state, 'B'))).toBe(10 + SECURITY_CHIEF_SHIELD_BONUS);
  });

  it("takes the King's shield off everywhere but adds it at his own outpost", () => {
    const strong = (id: string) => outpost(id, id === 'A' ? 0 : 100, 0, 'p1', { shieldMax: 30 });
    const state = makeState({ outposts: [strong('A'), strong('B'), outpost('E', 5000, 0, 'p2')], specialists: [spec('k', 'king', 'p1', 'A')] });
    expect(shieldMaxAt(state, at(state, 'A'))).toBe(30 - KING_SHIELD_DELTA);
    expect(shieldMaxAt(state, at(state, 'B'))).toBe(30 + KING_SHIELD_DELTA);
  });

  it('adds the King\'s 20 at every outpost where one of several Kings stands', () => {
    // Three Hypnotists per deck make two Kings possible: A and B each hold
    // one (+20), C holds none (−20). Without the fix, B lost its +20.
    const state = makeState({
      outposts: [outpost('A', 0, 0, 'p1', { shieldMax: 30 }), outpost('B', 10, 0, 'p1', { shieldMax: 30 }), outpost('C', 20, 0, 'p1', { shieldMax: 30 })],
      specialists: [spec('k1', 'king', 'p1', 'A'), spec('k2', 'king', 'p1', 'B')],
    });
    expect(['A', 'B', 'C'].map((id) => shieldMaxAt(state, at(state, id)))).toEqual([50, 50, 10]);
  });

  it('never goes below zero', () => {
    const state = makeState({
      outposts: [outpost('A', 0, 0, 'p1', { shieldMax: 10 }), outpost('B', 10, 0, 'p1', { shieldMax: 10 })],
      specialists: [spec('k', 'king', 'p1', 'A'), spec('q', 'queen', 'p1', 'A')],
    });
    expect(shieldMaxAt(state, at(state, 'B'))).toBe(0);
  });

  it('ignores other players and prisoners', () => {
    const state = makeState({ specialists: [spec('q', 'queen', 'p2', 'A'), spec('q2', 'queen', 'p1', 'A', 'p2')] });
    expect(shieldMaxAt(state, at(state, 'A'))).toBe(10);
  });
});

// --- Sonar -----------------------------------------------------------------

describe('sonarRangeAt', () => {
  it('extends a Princess’s own outpost and an Intelligence Officer’s everywhere', () => {
    const princess = makeState({ specialists: [spec('p', 'princess', 'p1', 'A')] });
    expect(sonarRangeAt(princess, at(princess, 'A'))).toBe(SONAR_RANGE * 1.5);
    expect(sonarRangeAt(princess, at(princess, 'B'))).toBe(SONAR_RANGE);

    const officer = makeState({ specialists: [spec('i', 'intelOfficer', 'p1', 'B')] });
    expect(sonarRangeAt(officer, at(officer, 'A'))).toBe(SONAR_RANGE * 1.25);
    expect(sonarRangeAt(officer, at(officer, 'E'))).toBe(SONAR_RANGE);
  });

  it('multiplies the two bonuses', () => {
    const state = makeState({ specialists: [spec('p', 'princess', 'p1', 'A'), spec('i', 'intelOfficer', 'p1', 'B')] });
    expect(sonarRangeAt(state, at(state, 'A'))).toBe(SONAR_RANGE * 1.5 * 1.25);
  });

  it('is dormant for an outpost nobody owns', () => {
    const state = makeState({ outposts: [outpost('D', 0, 0, null)] });
    expect(sonarRangeAt(state, at(state, 'D'))).toBe(SONAR_RANGE);
  });
});

// --- Production ------------------------------------------------------------

describe('productionBonusAt', () => {
  it('gives a Foreman +4 within half a sonar of her outpost', () => {
    const state = makeState({ specialists: [spec('f', 'foreman', 'p1', 'A')] });
    expect(productionBonusAt(state, at(state, 'A'))).toBe(4);
    expect(productionBonusAt(state, at(state, 'B'))).toBe(4); // exactly half a sonar away
    const far = makeState({
      outposts: [outpost('A', 0, 0, 'p1'), outpost('C', 900, 0, 'p1')],
      specialists: [spec('f', 'foreman', 'p1', 'A')],
    });
    expect(productionBonusAt(far, at(far, 'C'))).toBe(0);
  });

  it('is nothing without a Foreman, and never crosses owners', () => {
    expect(productionBonusAt(makeState(), at(makeState(), 'A'))).toBe(0);
    const state = makeState({ specialists: [spec('f', 'foreman', 'p2', 'E')] });
    expect(productionBonusAt(state, at(state, 'A'))).toBe(0);
  });
});

// --- Combat ----------------------------------------------------------------

/** Sub-vs-sub: every specialist acts, on either side. */
const SUBS = { atOutpost: false };

describe('runSpecialistPhase', () => {
  it('does nothing without a specialist that acts', () => {
    const a = fighter('p1', 10, ['queen', 'foreman']);
    const b = fighter('p2', 10);
    expect(runSpecialistPhase(a, b, SUBS)).toEqual({ notes: [] });
    expect([a.drillers, b.drillers]).toEqual([10, 10]);
  });

  it('a Thief converts 15% of the enemy drillers, rounded up', () => {
    const a = fighter('p1', 10, ['thief']);
    const b = fighter('p2', 11);
    const { notes } = runSpecialistPhase(a, b, SUBS);
    expect([a.drillers, b.drillers]).toEqual([12, 9]); // ceil(11 × 0.15) = 2
    expect(notes).toEqual(['Thief stole 2 drillers']);
  });

  it('a Lieutenant destroys 5 enemy drillers, never more than there are', () => {
    const a = fighter('p1', 10, ['lieutenant']);
    const b = fighter('p2', 3);
    runSpecialistPhase(a, b, SUBS);
    expect([a.drillers, b.drillers]).toEqual([10, 0]);
  });

  it('acts in priority order: the Thief (4) steals before the Lieutenant (8) fights', () => {
    const a = fighter('p1', 10, ['thief', 'lieutenant']);
    const b = fighter('p2', 100);
    runSpecialistPhase(a, b, SUBS);
    // 100 − 15 stolen = 85, then 5 destroyed.
    expect([a.drillers, b.drillers]).toEqual([25, 80]);
  });

  it('a Thief defending an outpost steals nothing; attacking one he does', () => {
    const attacker = fighter('p1', 20);
    const defender = fighter('p2', 20, ['thief']);
    expect(runSpecialistPhase(attacker, defender, { atOutpost: true }).notes).toEqual([]);
    expect([attacker.drillers, defender.drillers]).toEqual([20, 20]);
    const raider = fighter('p1', 20, ['thief']);
    const target = fighter('p2', 20);
    runSpecialistPhase(raider, target, { atOutpost: true });
    expect([raider.drillers, target.drillers]).toEqual([23, 17]);
  });

  it('lets opposing Thieves act together, so neither side goes first', () => {
    // Each steals ceil(15%) of what the other had when the tier started:
    // 3 of 20 and 6 of 40, whichever sub is "a".
    const a = fighter('p1', 20, ['thief']);
    const b = fighter('p2', 40, ['thief']);
    runSpecialistPhase(a, b, SUBS);
    expect([a.drillers, b.drillers]).toEqual([20 - 3 + 6, 40 - 6 + 3]);
    const b2 = fighter('p2', 40, ['thief']);
    const a2 = fighter('p1', 20, ['thief']);
    runSpecialistPhase(b2, a2, SUBS);
    expect([a2.drillers, b2.drillers]).toEqual([23, 37]);
  });

  it('ignores prisoners', () => {
    const a = fighter('p1', 10);
    a.specialists = [{ ...spec('t', 'thief', 'p1', 'A'), captiveOf: 'p2' }];
    const b = fighter('p2', 100);
    runSpecialistPhase(a, b, SUBS);
    expect(b.drillers).toBe(100);
  });
});

describe('drillerDestroyedInCombat', () => {
  it('is nothing without a General or a King', () => {
    expect(drillerDestroyedInCombat(makeState(), fighter('p1', 40))).toEqual({ drillers: 0, notes: [] });
  });

  it('a General needs a specialist of his side standing in the fight', () => {
    const state = makeState({ specialists: [spec('g', 'general', 'p1', 'A')] });
    const present = drillerDestroyedInCombat(state, fighter('p1', 40, ['thief']));
    expect(present).toEqual({ drillers: 10, notes: ['General destroyed 10 drillers'] });
    expect(drillerDestroyedInCombat(state, fighter('p1', 40)).drillers).toBe(0);
    // Someone else's General doesn't count.
    expect(drillerDestroyedInCombat(state, fighter('p2', 40, ['thief'])).drillers).toBe(0);
  });

  it('a King destroys 1 per 4 drillers of his own, present or not', () => {
    const state = makeState({ specialists: [spec('k', 'king', 'p1', 'A')] });
    expect(drillerDestroyedInCombat(state, fighter('p1', 40)).drillers).toBe(10);
    expect(drillerDestroyedInCombat(state, fighter('p1', 7)).drillers).toBe(1);
    expect(drillerDestroyedInCombat(state, fighter('p1', 3)).drillers).toBe(0);
  });

  it('stacks a General and a King', () => {
    const state = makeState({
      specialists: [spec('g', 'general', 'p1', 'A'), spec('k', 'king', 'p1', 'A')],
    });
    const result = drillerDestroyedInCombat(state, fighter('p1', 40, ['thief']));
    expect(result).toEqual({ drillers: 20, notes: ['General destroyed 10 drillers', 'King destroyed 10 drillers'] });
  });

  it('ignores a captive General', () => {
    const state = makeState({ specialists: [spec('g', 'general', 'p1', 'A', 'p2')] });
    expect(drillerDestroyedInCombat(state, fighter('p1', 40, ['thief'])).drillers).toBe(0);
  });
});

describe('engineerRepair', () => {
  it('never repairs more than was lost', () => {
    const state = makeState({ specialists: [spec('e', 'engineer', 'p1', 'A')] });
    // ceil(1/4) twice would give back 2 of 1 lost.
    expect(engineerRepair(state, 'p1', 1, { outpost: 'A' })).toBe(1);
    expect(engineerRepair(state, 'p1', 20, { outpost: 'A' })).toBe(10);
    expect(engineerRepair(state, 'p1', 20, { outpost: 'B' })).toBe(5);
  });
});
