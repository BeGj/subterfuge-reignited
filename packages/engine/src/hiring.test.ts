import { describe, expect, it } from 'vitest';
import { FIRST_HIRE_AT, HIRE_DECK_COPIES, HIRE_INTERVAL, TICK } from './constants.js';
import { buildHiring } from './hiring.js';
import { generateMap } from './map.js';
import { SPECIALISTS, hireableKinds } from './specialists.js';
import { advance, validateOrder } from './simulation.js';
import type { GameState, HireOrder, Order, PromoteOrder, SpecialistKind } from './types.js';

/*
 * Hiring (goal.md → Hiring): an offer at 4 hours and every 18 hours after,
 * one card per category from a deck of 3 copies of every hireable specialist.
 * Promotion is the alternative to hiring.
 */

const players = [
  { id: 'p1', name: 'One' },
  { id: 'p2', name: 'Two' },
];

const map = (seed = 7) => generateMap({ seed, players });

const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;
const queenOutpost = (state: GameState, id: string) => {
  const q = state.specialists.find((s) => s.owner === id && s.kind === 'queen')!;
  return 'outpost' in q.location ? q.location.outpost : '';
};

const hire = (o: Partial<HireOrder> & Pick<HireOrder, 'player' | 'choice'>): HireOrder => ({
  kind: 'hire',
  at: TICK,
  ...o,
});

const promote = (o: Partial<PromoteOrder> & Pick<PromoteOrder, 'player' | 'specialist'>): PromoteOrder => ({
  kind: 'promote',
  at: TICK,
  ...o,
});

// --- Decks -----------------------------------------------------------------

describe('buildHiring', () => {
  it('holds 3 copies of every hireable specialist in each category', () => {
    for (const category of ['offensive', 'defensive', 'other'] as const) {
      const expected = hireableKinds(category).length * HIRE_DECK_COPIES;
      expect(buildHiring(7, 'p1').deck[category], category).toHaveLength(expected);
    }
  });

  it('is deterministic for the same seed and player, and different between players', () => {
    expect(buildHiring(7, 'p1')).toEqual(buildHiring(7, 'p1'));
    expect(buildHiring(7, 'p1').deck.other).not.toEqual(buildHiring(7, 'p2').deck.other);
    expect(buildHiring(7, 'p1').deck.other).not.toEqual(buildHiring(8, 'p1').deck.other);
  });

  it('shuffles the deck rather than dealing it in catalogue order', () => {
    const deck = buildHiring(7, 'p1').deck.offensive;
    expect(deck).toHaveLength(new Set(deck).size * HIRE_DECK_COPIES); // all three copies of each
    const ordered = hireableKinds('offensive').flatMap((k) => [k, k, k]);
    expect(deck).not.toEqual(ordered);
  });

  it("leaves the map generator alone: hiring doesn't change the outposts", () => {
    const withHiring = map();
    expect(withHiring.outposts).toEqual(generateMap({ seed: 7, players }).outposts);
  });
});

// --- Offers ----------------------------------------------------------------

describe('offers', () => {
  it('appears at 4 hours, then every 18, with one card per category', () => {
    const state = map();
    const offered = advance(state, [], FIRST_HIRE_AT).events.filter((e) => e.kind === 'specialistOffered');
    expect(offered).toHaveLength(2);
    expect(offered[0]).toMatchObject({ at: FIRST_HIRE_AT, player: 'p1' });
    const offer = player(advance(state, [], FIRST_HIRE_AT).state, 'p1').hiring.offer!;
    expect(Object.keys(offer.kinds).sort()).toEqual(['defensive', 'offensive', 'other']);
    for (const [category, kind] of Object.entries(offer.kinds)) {
      expect(SPECIALISTS[kind as SpecialistKind].category, String(kind)).toBe(category);
      expect(hireableKinds(category as 'offensive')).toContain(kind);
    }
  });

  it('offers nothing before the first interval and nothing twice', () => {
    const state = map();
    expect(player(advance(state, [], FIRST_HIRE_AT - TICK).state, 'p1').hiring.offer).toBeNull();
    const twice = advance(state, [], FIRST_HIRE_AT + HIRE_INTERVAL).events.filter(
      (e) => e.kind === 'specialistOffered' && e.player === 'p1',
    );
    expect(twice.map((e) => e.at)).toEqual([FIRST_HIRE_AT, FIRST_HIRE_AT + HIRE_INTERVAL]);
  });

  it('replaces an offer you ignored, and the drawn cards stay out of the deck', () => {
    const state = map();
    const before = player(state, 'p1').hiring.deck.other.length;
    const later = advance(state, [], FIRST_HIRE_AT + HIRE_INTERVAL).state;
    const hiring = player(later, 'p1').hiring;
    expect(hiring.offer!.at).toBe(FIRST_HIRE_AT + HIRE_INTERVAL);
    // One card per category per offer, taken or not.
    expect(hiring.deck.other).toHaveLength(before - 2);
    expect(hiring.nextOfferAt).toBe(FIRST_HIRE_AT + 2 * HIRE_INTERVAL);
  });

  it('skips a category whose deck has run out', () => {
    const state = map();
    player(state, 'p1').hiring.deck.defensive = [];
    const later = advance(state, [], FIRST_HIRE_AT).state;
    expect(Object.keys(player(later, 'p1').hiring.offer!.kinds)).not.toContain('defensive');
  });
});

// --- Hire and promote ------------------------------------------------------

describe('hire', () => {
  /** A state with a live offer, by advancing to the first one. */
  const offered = () => {
    const state = advance(map(), [], FIRST_HIRE_AT).state;
    return { state, choice: Object.values(player(state, 'p1').hiring.offer!.kinds)[0]! };
  };

  it('puts the specialist at the Queen’s outpost', () => {
    const { state, choice } = offered();
    const at = queenOutpost(state, 'p1');
    const { state: after, events } = advance(state, [hire({ player: 'p1', choice, at: FIRST_HIRE_AT + TICK })], FIRST_HIRE_AT + TICK);
    const hired = after.specialists.find((s) => s.owner === 'p1' && s.kind === choice)!;
    expect(hired).toMatchObject({ kind: choice, owner: 'p1', location: { outpost: at }, captiveOf: null });
    expect(player(after, 'p1').hiring.offer).toBeNull();
    expect(events).toContainEqual({ kind: 'specialistHired', at: FIRST_HIRE_AT + TICK, player: 'p1', kinds: [choice], outpost: at });
  });

  it('needs the Queen at one of your own outposts', () => {
    const { state, choice } = offered();
    const queen = state.specialists.find((s) => s.owner === 'p1' && s.kind === 'queen')!;
    queen.location = { outpost: player(state, 'p2').hiring && state.outposts.find((o) => o.owner === 'p2')!.id };
    expect(validateOrder(state, hire({ player: 'p1', choice }))).toBe(
      'Your Queen must be at one of your own outposts to hire.',
    );
  });

  it('rejects a specialist that is not on offer, and an order with no offer', () => {
    const { state, choice } = offered();
    const other = hireableKinds('other').find((k) => k !== choice)!;
    expect(validateOrder(state, hire({ player: 'p1', choice: other }))).toBe('That specialist is not on offer.');
    const later = advance(state, [], FIRST_HIRE_AT + HIRE_INTERVAL + TICK).state;
    player(later, 'p1').hiring.offer = null;
    expect(validateOrder(later, hire({ player: 'p1', choice }))).toBe('There is no offer to take right now.');
  });

  it('is rejected by the engine when it cannot happen any more', () => {
    const { state, choice } = offered();
    const category = SPECIALISTS[choice].category;
    delete player(state, 'p1').hiring.offer!.kinds[category];
    const { events } = advance(state, [hire({ player: 'p1', choice, at: FIRST_HIRE_AT + TICK })], FIRST_HIRE_AT + TICK);
    expect(events.filter((e) => e.kind === 'orderRejected')).toHaveLength(1);
  });

  it("doesn't deal to a player who was eliminated before the offer", () => {
    const state = map();
    const orders: Order[] = [{ kind: 'resign', at: TICK, player: 'p1' }];
    const { events } = advance(state, orders, FIRST_HIRE_AT);
    expect(events.filter((e) => e.kind === 'specialistOffered' && e.player === 'p1')).toHaveLength(0);
  });
});

describe('promote', () => {
  /** A map where the first offer holds a Lieutenant, hired at the Queen. */
  const withLieutenant = () => {
    const state = advance(map(), [], FIRST_HIRE_AT).state;
    player(state, 'p1').hiring.offer!.kinds.offensive = 'lieutenant';
    const after = advance(state, [hire({ player: 'p1', choice: 'lieutenant', at: FIRST_HIRE_AT + TICK })], FIRST_HIRE_AT + TICK)
      .state;
    const lieutenant = after.specialists.find((s) => s.kind === 'lieutenant')!;
    return { state: after, lieutenant };
  };

  /** The hire used up the first offer; this waits for the second one. */
  const SECOND_OFFER = FIRST_HIRE_AT + HIRE_INTERVAL;

  it('promotes in place, keeping her id and outpost', () => {
    const { state: hired, lieutenant } = withLieutenant();
    const state = advance(hired, [], SECOND_OFFER).state;
    const at = 'outpost' in lieutenant.location ? lieutenant.location.outpost : '';
    const { state: after, events } = advance(
      state,
      [promote({ player: 'p1', specialist: lieutenant.id, at: SECOND_OFFER + TICK })],
      SECOND_OFFER + TICK,
    );
    expect(after.specialists.find((s) => s.id === lieutenant.id)).toMatchObject({
      kind: SPECIALISTS[lieutenant.kind].promotesTo,
      owner: 'p1',
      location: { outpost: at },
    });
    expect(events[0]).toMatchObject({ kind: 'specialistPromoted', player: 'p1', from: lieutenant.kind });
  });

  it('is taken instead of a hire, so it needs an offer and uses it up', () => {
    const { state: hired, lieutenant } = withLieutenant();
    // The hire took the first offer: nothing to promote with until the next.
    expect(validateOrder(hired, promote({ player: 'p1', specialist: lieutenant.id }))).toBe(
      'There is no offer to take right now.',
    );
    const state = advance(hired, [], SECOND_OFFER).state;
    const offered = player(state, 'p1').hiring.offer!.kinds.offensive!;
    const { state: after, events } = advance(
      state,
      [
        promote({ player: 'p1', specialist: lieutenant.id, at: SECOND_OFFER + TICK }),
        hire({ player: 'p1', choice: offered, at: SECOND_OFFER + TICK }),
      ],
      SECOND_OFFER + TICK,
    );
    expect(player(after, 'p1').hiring.offer).toBeNull();
    expect(events.map((e) => e.kind)).toEqual(['specialistPromoted', 'orderRejected']);
  });

  it('a hire uses up the offer for promoting too', () => {
    const { state: hired, lieutenant } = withLieutenant();
    const state = advance(hired, [], SECOND_OFFER).state;
    const offered = player(state, 'p1').hiring.offer!.kinds.offensive!;
    const { events } = advance(
      state,
      [
        hire({ player: 'p1', choice: offered, at: SECOND_OFFER + TICK }),
        promote({ player: 'p1', specialist: lieutenant.id, at: SECOND_OFFER + TICK }),
      ],
      SECOND_OFFER + TICK,
    );
    expect(events.map((e) => e.kind)).toEqual(['specialistHired', 'orderRejected']);
  });

  it('still works once every deck has run dry', () => {
    const { state: hired, lieutenant } = withLieutenant();
    for (const p of hired.players) p.hiring.deck = { offensive: [], defensive: [], other: [] };
    const state = advance(hired, [], SECOND_OFFER).state;
    // An offer still comes, with no cards in it, and it allows a promotion.
    expect(player(state, 'p1').hiring.offer).toEqual({ at: SECOND_OFFER, kinds: {} });
    expect(validateOrder(state, promote({ player: 'p1', specialist: lieutenant.id }))).toBeNull();
  });

  it('needs the specialist on one of your own outposts', () => {
    const { state, lieutenant } = withLieutenant();
    lieutenant.location = { outpost: state.outposts.find((o) => o.owner === 'p2')!.id };
    expect(validateOrder(state, promote({ player: 'p1', specialist: lieutenant.id }))).toBe(
      'The specialist must be at one of your own outposts.',
    );
    lieutenant.location = { sub: 'sub-9' };
    expect(validateOrder(state, promote({ player: 'p1', specialist: lieutenant.id }))).toBe(
      'The specialist must be at an outpost.',
    );
  });

  it('refuses to promote the Queen, or anything twice', () => {
    const { state, lieutenant } = withLieutenant();
    const queen = state.specialists.find((s) => s.owner === 'p1' && s.kind === 'queen')!;
    expect(validateOrder(state, promote({ player: 'p1', specialist: queen.id }))).toBe('Queen cannot be promoted.');
    const promoted: GameState = structuredClone(state);
    promoted.specialists.find((s) => s.id === lieutenant.id)!.kind = 'general';
    expect(validateOrder(promoted, promote({ player: 'p1', specialist: lieutenant.id }))).toBe(
      'General cannot be promoted.',
    );
  });

  it("refuses someone else's or a captive specialist", () => {
    const { state, lieutenant } = withLieutenant();
    expect(validateOrder(state, promote({ player: 'p2', specialist: lieutenant.id }))).toBe('Invalid specialist.');
    lieutenant.captiveOf = 'p2';
    expect(validateOrder(state, promote({ player: 'p1', specialist: lieutenant.id }))).toBe('Invalid specialist.');
  });
});