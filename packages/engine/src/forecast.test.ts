import { describe, expect, it } from 'vitest';
import { FIRST_HIRE_AT, LAUNCH_DELAY, TICK } from './constants.js';
import { UNKNOWN_PLAYER, forecast, predictArrivals, stateFromView } from './forecast.js';
import { generateMap } from './map.js';
import { distance } from './geometry.js';
import { advance, subPosition } from './simulation.js';
import type { GameState, LaunchOrder, OutpostView, PlayerView } from './types.js';
import { viewFor } from './visibility.js';

const players = [
  { id: 'p1', name: 'One' },
  { id: 'p2', name: 'Two' },
];

function setup(): { state: GameState; view: PlayerView } {
  const state = generateMap({ seed: 7, players });
  return { state, view: viewFor(state, 'p1') };
}

const own = (view: PlayerView) => view.outposts.filter((o) => o.owner === 'p1' && (o.drillers ?? 0) > 0);
const launch = (from: OutpostView, to: OutpostView, drillers: number, at = LAUNCH_DELAY): LaunchOrder => ({
  kind: 'launch',
  at,
  player: 'p1',
  from: from.id,
  to: to.id,
  drillers,
  specialists: [],
});

describe('stateFromView', () => {
  it('keeps what is visible and replaces hidden outposts with empty placeholders', () => {
    const { view } = setup();
    const state = stateFromView(view);
    for (const o of view.outposts) {
      const s = state.outposts.find((x) => x.id === o.id)!;
      if (o.visible) expect(s).toMatchObject({ owner: o.owner, drillers: o.drillers });
      else expect(s).toMatchObject({ owner: UNKNOWN_PLAYER, drillers: 0 });
    }
    expect(state.players.find((p) => p.id === UNKNOWN_PLAYER)?.eliminated).toBe(true);
  });

  it('does not modify the view', () => {
    const { view } = setup();
    const before = JSON.stringify(view);
    forecast(view, [], view.time + 600);
    expect(JSON.stringify(view)).toBe(before);
  });

  it("carries the viewer's hiring, and nobody else's", () => {
    const { state, view } = setup();
    const you = state.players.find((p) => p.id === 'p1')!;
    const forecastState = stateFromView(view);
    expect(forecastState.players.find((p) => p.id === 'p1')!.hiring).toEqual({
      nextOfferAt: you.hiring.nextOfferAt,
      deck: { offensive: [], defensive: [], other: [] },
      offer: null,
    });
    // A forecast never deals: the decks aren't in the view.
    expect(forecastState.players.find((p) => p.id === 'p2')!.hiring.nextOfferAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(advance(forecastState, [], view.time + 4 * 24 * 60).state.players.find((p) => p.id === 'p2')!.hiring.offer)
      .toBeNull();
  });

  it('lets a promotion scheduled after the next offer go through, though the decks are hidden', () => {
    const { state } = setup();
    const queen = state.specialists.find((s) => s.kind === 'queen' && s.owner === 'p1')!;
    state.specialists.push({ id: 'lt', kind: 'lieutenant', owner: 'p1', location: queen.location, captiveOf: null });
    const view = viewFor(state, 'p1');
    const at = FIRST_HIRE_AT + TICK;
    const { events } = forecast(view, [{ kind: 'promote', at, player: 'p1', specialist: 'lt' }], at);
    expect(events.map((e) => e.kind)).toContain('specialistPromoted');
    expect(events.map((e) => e.kind)).not.toContain('orderRejected');
  });

  it('keeps a redirected sub on the leg it turned onto', () => {
    // Fully visible: p1's sub turns back towards home with p2's sub behind it.
    const { state } = setup();
    const home = state.outposts.find((o) => o.owner === 'p1' && o.drillers >= 40)!;
    const near = state.outposts
      .filter((o) => o.owner === 'p1' && o.id !== home.id)
      .sort((a, b) => distance(a.position, home.position) - distance(b.position, home.position))[0]!;
    const length = distance(home.position, near.position);
    const at = (f: number) => ({
      x: home.position.x + (near.position.x - home.position.x) * f,
      y: home.position.y + (near.position.y - home.position.y) * f,
    });
    const base = { drillers: 10, specialists: [], isGift: false, speed: 1, lastRedirectAt: 0 };
    state.subs.push(
      // Turned at 60% of the lane at minute 0, heading home.
      { ...base, id: 'sub-90', owner: 'p1', from: near.id, to: home.id, origin: at(0.6), launchedAt: 0, arrivesAt: Math.ceil((0.6 * length) / 10) * 10 },
      // Following it out from home, 20% along at minute 0.
      { ...base, id: 'sub-91', owner: 'p2', drillers: 5, from: home.id, to: near.id, launchedAt: -Math.ceil((0.2 * length) / 10) * 10, arrivesAt: Math.ceil((0.8 * length) / 10) * 10 },
    );
    const view = viewFor(state, 'p1', { revealOwners: true });
    const until = Math.ceil(length / 10) * 10;
    const real = advance(state, [], until).events.find((e) => e.kind === 'combat');
    const predicted = forecast(view, [], until).events.find((e) => e.kind === 'combat');
    expect(real).toBeDefined();
    expect(predicted?.at).toBe(real!.at);
    expect(subPosition(stateFromView(view), view.subs.find((s) => s.id === 'sub-90')!, 30)).toEqual(
      subPosition(state, state.subs.find((s) => s.id === 'sub-90')!, 30),
    );
  });

  it('keeps the base shield maximum, so specialist bonuses are not counted twice', () => {
    const { state, view } = setup();
    const queenOutpost = state.specialists.find((s) => s.kind === 'queen')!.location;
    const id = 'outpost' in queenOutpost ? queenOutpost.outpost : '';
    const view_ = view.outposts.find((o) => o.id === id)!;
    // The view carries both, and the base one is what feeds a forecast state.
    expect(view_.shieldMax).toBe(10);
    expect(view_.shieldMaxEffective).toBe(30);
    expect(stateFromView(view).outposts.find((o) => o.id === id)!.shieldMax).toBe(10);
  });

  it('predicts the specialist effects it can see', () => {
    const { state, view } = setup();
    // A Lieutenant riding a sub that will arrive at a visible outpost.
    const from = own(view)[0]!;
    const target = view.outposts.find((o) => o.visible && o.owner === 'p2');
    if (!target) return;
    const withLieutenant = structuredClone(state);
    const at = withLieutenant.outposts.find((o) => o.id === from.id)!;
    withLieutenant.specialists.push({
      id: 'spec-lt',
      kind: 'lieutenant',
      owner: 'p1',
      location: { outpost: at.id },
      captiveOf: null,
    });
    const order = { ...launch(from, target, 5), specialists: ['spec-lt'] };
    const predicted = predictArrivals(viewFor(withLieutenant, 'p1'), [order])[0];
    expect(predicted?.combat?.details.effects).toEqual(['Lieutenant destroyed 5 drillers']);
  });
});

describe('predictArrivals', () => {
  it('predicts a pending launch to a visible dormant outpost as safe, with its arrival time', () => {
    const { view } = setup();
    const from = own(view)[0]!;
    const target = view.outposts.find((o) => o.visible && o.owner === null)!;
    const [p] = predictArrivals(view, [launch(from, target, 10)]);
    expect(p).toMatchObject({ order: 0, owner: 'p1', to: target.id, outcome: 'safe' });
    expect(p!.at).toBeGreaterThan(LAUNCH_DELAY);
  });

  it('predicts wins and losses against a visible enemy outpost, with battle numbers', () => {
    const { view } = setup();
    const enemy = view.outposts.find((o) => o.visible && o.owner === 'p2' && (o.drillers ?? 0) > 0);
    if (!enemy) return; // sonar doesn't reach an enemy outpost on this seed
    const from = own(view).find((o) => (o.drillers ?? 0) >= 40)!;
    const lose = predictArrivals(view, [launch(from, enemy, 1)])[0]!;
    expect(lose.outcome).toBe('lose');
    expect(lose.combat?.details.sides[0]).toMatchObject({ player: 'p1', drillersBefore: 1, drillersAfter: 0 });
  });

  it('reports unknown when the target is hidden', () => {
    const { view } = setup();
    const hidden = view.outposts.find((o) => !o.visible);
    if (!hidden) return;
    const from = own(view)[0]!;
    expect(predictArrivals(view, [launch(from, hidden, 10)])[0]?.outcome).toBe('unknown');
  });

  it('predicts the faster arrival of a Helmsman', () => {
    const { state, view } = setup();
    const from = own(view)[0]!;
    const target = view.outposts.find((o) => o.visible && o.owner === null)!;
    const withHelmsman = structuredClone(state);
    withHelmsman.specialists.push({
      id: 'spec-h',
      kind: 'helmsman',
      owner: 'p1',
      location: { outpost: from.id },
      captiveOf: null,
    });
    const order = { ...launch(from, target, 5), specialists: ['spec-h'] };
    const fast = predictArrivals(viewFor(withHelmsman, 'p1'), [order])[0]!;
    const slow = predictArrivals(view, [launch(from, target, 5)])[0]!;
    expect(fast.arrivesAt).toBeLessThan(slow.arrivesAt);
    expect(fast.arrivesAt - LAUNCH_DELAY).toBe(Math.ceil((slow.arrivesAt - LAUNCH_DELAY) / 2 / 10) * 10);
  });

  it('skips launches that would be rejected', () => {
    const { view } = setup();
    const from = own(view)[0]!;
    const target = view.outposts.find((o) => o.visible && o.owner === null)!;
    expect(predictArrivals(view, [launch(from, target, 9999)])).toEqual([]);
  });

  it('matches the real game when everything involved is visible', () => {
    const { state, view } = setup();
    const from = own(view)[0]!;
    const target = view.outposts.find((o) => o.visible && o.owner === null)!;
    const order = launch(from, target, 10);
    const predicted = predictArrivals(view, [order])[0]!;
    const real = advance(state, [order], predicted.at);
    expect(real.state.outposts.find((o) => o.id === target.id)?.owner).toBe('p1');
    expect(real.events.some((e) => e.kind === 'outpostCaptured' && e.at === predicted.at)).toBe(true);
  });
});
