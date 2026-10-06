import { describe, expect, it } from 'vitest';
import { FIRST_HIRE_AT, SONAR_RANGE } from './constants.js';
import { buildHiring, inertHiring } from './hiring.js';
import { advance } from './simulation.js';
import type { GameState, Outpost, SpecialistKind, Sub } from './types.js';
import { viewFor } from './visibility.js';

function outpost(id: string, x: number, owner: string | null, extra: Partial<Outpost> = {}): Outpost {
  return {
    id,
    name: `Name ${id}`,
    type: 'factory',
    position: { x, y: 0 },
    owner,
    drillers: 12,
    shieldMax: 10,
    shieldProgress: 0,
    shieldEnabled: true,
    ...extra,
  };
}

function sub(id: string, owner: string, from: string, to: string): Sub {
  return { id, owner, from, to, drillers: 7, specialists: [], launchedAt: 0, arrivesAt: 100, isGift: false, speed: 1, lastRedirectAt: null };
}

function makeState(): GameState {
  return {
    time: 0,
    seed: 1,
    width: 10_000,
    height: 1000,
    players: [
      { id: 'p1', name: 'One', neptunium: 5, minesDrilled: 0, eliminated: false, hiring: inertHiring() },
      { id: 'p2', name: 'Two', neptunium: 9, minesDrilled: 1, eliminated: false, hiring: inertHiring() },
    ],
    outposts: [
      outpost('A', 0, 'p1'),
      outpost('N', SONAR_RANGE, 'p2'), // exactly at the edge of A's sonar
      outpost('M', 6000, 'p2', { type: 'mine' }),
      outpost('G', 7000, 'p2', { type: 'generator' }),
      outpost('H', 8000, 'p2'),
    ],
    subs: [sub('sub-1', 'p2', 'G', 'H'), sub('sub-2', 'p2', 'H', 'A'), sub('sub-3', 'p1', 'A', 'M')],
    specialists: [
      { id: 'q1', kind: 'queen', owner: 'p1', location: { outpost: 'A' }, captiveOf: null },
      { id: 'q2', kind: 'queen', owner: 'p2', location: { outpost: 'H' }, captiveOf: null },
    ],
    nextId: 4,
    winner: null,
    endedAt: null,
    endVotes: [],
  };
}

describe('viewFor', () => {
  const view = viewFor(makeState(), 'p1');
  const byId = (id: string) => view.outposts.find((o) => o.id === id)!;

  it('shows own and in-sonar outposts in full', () => {
    expect(byId('A')).toMatchObject({ visible: true, owner: 'p1', drillers: 12, type: 'factory' });
    expect(byId('N')).toMatchObject({ visible: true, owner: 'p2', drillers: 12, shieldMax: 10 });
  });

  it('hides details outside sonar but keeps positions, names and mine types', () => {
    expect(byId('G')).toEqual({ id: 'G', name: 'Name G', position: { x: 7000, y: 0 }, visible: false });
    expect(byId('M')).toEqual({ id: 'M', name: 'Name M', position: { x: 6000, y: 0 }, type: 'mine', visible: false });
  });

  it('shows own subs, subs in sonar and subs heading for you — nothing else', () => {
    expect(view.subs.map((s) => s.id).sort()).toEqual(['sub-2', 'sub-3']);
  });

  it('shows only specialists at visible places, plus your own', () => {
    expect(view.specialists.map((s) => s.id)).toEqual(['q1']);
  });

  it('lists public player info for everyone', () => {
    expect(view.players).toEqual([
      { id: 'p1', name: 'One', neptunium: 5, outpostCount: 1, minesDrilled: 0, eliminated: false },
      { id: 'p2', name: 'Two', neptunium: 9, outpostCount: 4, minesDrilled: 1, eliminated: false },
    ]);
    expect(view.you).toBe('p1');
  });

  it('does not share object references with the state', () => {
    const state = makeState();
    const v = viewFor(state, 'p1');
    v.subs[0]!.drillers = 999;
    v.outposts[0]!.position.x = 999;
    expect(state.subs.find((s) => s.id === v.subs[0]!.id)!.drillers).toBe(7);
    expect(state.outposts[0]!.position.x).toBe(0);
  });
});

describe('specialists in the view', () => {
  /** p1 owns A at the origin; the rest sit outside a normal sonar. */
  const scene = (): GameState => ({
    ...makeState(),
    outposts: [
      outpost('A', 0, 'p1'),
      // Just outside a normal sonar, inside a Princess's (1.5×) and an
      // Intelligence Officer's (1.25×).
      outpost('NEAR', Math.round(SONAR_RANGE * 1.2), 'p2'),
      outpost('FAR', 7000, 'p2', { type: 'generator' }),
    ],
    subs: [],
    specialists: [{ id: 'q1', kind: 'queen', owner: 'p1', location: { outpost: 'A' }, captiveOf: null }],
    nextId: 2,
  });

  const add = (state: GameState, kind: SpecialistKind, owner: string, at: string, id: string): GameState => {
    state.specialists.push({ id, kind, owner, location: { outpost: at }, captiveOf: null });
    return state;
  };

  const seen = (state: GameState, id: string) => viewFor(state, 'p1').outposts.find((o) => o.id === id)!;

  it('sends the maximum a shield really reaches, next to the base one', () => {
    expect(seen(scene(), 'A')).toMatchObject({ shieldMax: 10, shieldMaxEffective: 30 }); // the Queen is there
    const withChief = add(scene(), 'securityChief', 'p1', 'A', 'c');
    expect(seen(withChief, 'A')).toMatchObject({ shieldMax: 10, shieldMaxEffective: 50 });
  });

  it('extends sonar with a Princess', () => {
    expect(seen(scene(), 'NEAR').visible).toBe(false);
    const withPrincess = add(scene(), 'princess', 'p1', 'A', 'pr');
    expect(seen(withPrincess, 'NEAR').visible).toBe(true);
    // She only extends her own outpost.
    const elsewhere = add(scene(), 'princess', 'p2', 'FAR', 'pr');
    expect(seen(elsewhere, 'NEAR').visible).toBe(false);
  });

  it('reaches a little further with an Intelligence Officer, and reveals every type', () => {
    expect(seen(scene(), 'NEAR').visible).toBe(false);
    const officer = add(scene(), 'intelOfficer', 'p1', 'A', 'i');
    expect(seen(officer, 'NEAR').visible).toBe(true); // 1.25× reaches it
    // FAR is still out of sonar, but its type is known.
    expect(seen(scene(), 'FAR').visible).toBe(false);
    expect(seen(scene(), 'FAR').type).toBeUndefined();
    expect(seen(officer, 'FAR')).toMatchObject({ visible: false, type: 'generator' });
  });

  it("sends only the viewer's own hiring, without their decks", () => {
    const state = scene();
    state.players[0]!.hiring = buildHiring(99, 'p1');
    const view = viewFor(state, 'p1');
    expect(view.hiring.nextOfferAt).toBe(FIRST_HIRE_AT);
    expect(view.hiring.offer).toBeNull();
    expect('deck' in view.hiring).toBe(false);
    // A player who isn't in the game gets inert hiring rather than a crash.
    expect(viewFor(state, 'nobody').hiring.nextOfferAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('shows the offer once it is dealt, to its owner only', () => {
    const state = scene();
    state.players[0]!.hiring = buildHiring(99, 'p1');
    const later = advance(state, [], FIRST_HIRE_AT).state;
    const view = viewFor(later, 'p1');
    expect(view.hiring.offer!.at).toBe(FIRST_HIRE_AT);
    expect(Object.keys(view.hiring.offer!.kinds).sort()).toEqual(['defensive', 'offensive', 'other']);
    expect(viewFor(later, 'p2').hiring.offer).toBeNull();
  });
});

describe('viewFor with revealOwners', () => {
  it('shows who owns hidden outposts, but nothing else about them', () => {
    const state = makeState();
    const hidden = viewFor(state, 'p1').outposts.find((o) => !o.visible)!;
    expect(hidden.owner).toBeUndefined();
    const revealed = viewFor(state, 'p1', { revealOwners: true }).outposts.find((o) => o.id === hidden.id)!;
    const real = state.outposts.find((o) => o.id === hidden.id)!;
    expect(revealed.owner).toBe(real.owner);
    expect(revealed.drillers).toBeUndefined();
    expect(revealed.shieldCharge).toBeUndefined();
    expect(revealed.visible).toBe(false);
  });
});
