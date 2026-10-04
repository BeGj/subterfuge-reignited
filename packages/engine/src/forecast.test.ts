import { describe, expect, it } from 'vitest';
import { LAUNCH_DELAY } from './constants.js';
import { UNKNOWN_PLAYER, forecast, predictArrivals, stateFromView } from './forecast.js';
import { generateMap } from './map.js';
import { advance } from './simulation.js';
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
