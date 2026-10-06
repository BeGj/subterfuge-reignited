import { cargoSpeed, type OutpostView, type Sub } from '@subterfuge/engine';
import { fitPoints, pan, toMap, toScreen, zoomAt } from './camera';
import { gameMinuteAt, minutesToNextProduction, syncClock } from './clock';
import { describeEvent, describeOrder, namesFor } from './describe';
import { formatDuration, formatGameTime, formatNeptunium, plannedTripLabel } from './format';
import { hitTestOutpost, subPositionAt, travelMinutes } from './geometry';

describe('format', () => {
  it('formats game time as day and clock', () => {
    expect(formatGameTime(0)).toBe('Day 1, 00:00');
    expect(formatGameTime(24 * 60 + 270.9)).toBe('Day 2, 04:30');
  });

  it('formats durations compactly, rounding up', () => {
    expect(formatDuration(7.2)).toBe('8m');
    expect(formatDuration(370)).toBe('6h 10m');
    expect(formatDuration(360)).toBe('6h');
    expect(formatDuration(3 * 1440 + 125)).toBe('3d 2h');
    expect(formatDuration(-5)).toBe('0m');
  });

  it('shows neptunium in kg with one decimal, never rounding up', () => {
    expect(formatNeptunium(0)).toBe('0.0');
    expect(formatNeptunium(1440 * 12.59)).toBe('12.5');
  });
});

describe('geometry', () => {
  it('rounds travel time up to whole ticks', () => {
    expect(travelMinutes({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(10);
    expect(travelMinutes({ x: 0, y: 0 }, { x: 361, y: 0 })).toBe(370);
  });

  it('shortens the trip for a fast cargo, using the engine\'s rule', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1200, y: 0 };
    expect(travelMinutes(a, b)).toBe(1200);
    // A Helmsman at 2×: the fastest specialist wins, so a Lieutenant on board
    // doesn't make it slower.
    expect(travelMinutes(a, b, cargoSpeed(['helmsman']))).toBe(600);
    expect(travelMinutes(a, b, cargoSpeed(['helmsman', 'lieutenant']))).toBe(600);
    expect(travelMinutes(a, b, cargoSpeed([], { ownerHasAdmiral: true }))).toBe(800);
  });

  it('interpolates subs and clamps to the route', () => {
    const sub = { launchedAt: 100, arrivesAt: 200 } as Sub;
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    expect(subPositionAt(sub, from, to, 150)).toEqual({ x: 50, y: 25 });
    expect(subPositionAt(sub, from, to, 50)).toEqual(from);
    expect(subPositionAt(sub, from, to, 999)).toEqual(to);
  });

  it('starts a redirected sub at the point where it turned', () => {
    const sub = { launchedAt: 100, arrivesAt: 200, origin: { x: 40, y: 0 } } as Sub;
    const from = { x: 0, y: 0 };
    const to = { x: 140, y: 0 };
    expect(subPositionAt(sub, from, to, 100)).toEqual({ x: 40, y: 0 });
    expect(subPositionAt(sub, from, to, 150)).toEqual({ x: 90, y: 0 });
  });

  it('hit-tests the nearest outpost within the radius', () => {
    const outposts = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 10, y: 0 } },
    ] as OutpostView[];
    expect(hitTestOutpost(outposts, { x: 7, y: 0 }, 5)?.id).toBe('b');
    expect(hitTestOutpost(outposts, { x: 50, y: 50 }, 5)).toBeUndefined();
  });
});

describe('camera', () => {
  const viewport = { width: 800, height: 600 };

  it('fits points inside the viewport', () => {
    const camera = fitPoints([{ x: 0, y: 0 }, { x: 1000, y: 500 }], viewport, 50);
    expect(camera.center).toEqual({ x: 500, y: 250 });
    const tl = toScreen(camera, viewport, { x: 0, y: 0 });
    const br = toScreen(camera, viewport, { x: 1000, y: 500 });
    expect(tl.x).toBeGreaterThanOrEqual(49.9);
    expect(br.x).toBeLessThanOrEqual(750.1);
    expect(br.y).toBeLessThanOrEqual(550.1);
  });

  it('round-trips map ↔ screen', () => {
    const camera = { center: { x: 300, y: 200 }, scale: 0.5 };
    const p = { x: 123, y: 456 };
    const back = toMap(camera, viewport, toScreen(camera, viewport, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('keeps the anchor fixed while zooming, and pans with the drag', () => {
    const camera = { center: { x: 0, y: 0 }, scale: 0.5 };
    const anchor = { x: 100, y: 120 };
    const before = toMap(camera, viewport, anchor);
    const after = toMap(zoomAt(camera, viewport, anchor, 1.5), viewport, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(pan(camera, 10, -20).center).toEqual({ x: -20, y: 40 });
  });
});

describe('clock', () => {
  it('derives game minutes from wall time with skew correction', () => {
    const sync = syncClock({ startedAt: '2026-01-01T00:00:00.000Z', speed: 60, serverNow: '2026-01-01T00:01:00.000Z' }, Date.parse('2026-01-01T00:00:30.000Z'));
    // Local clock is 30s behind the server: local 00:00:30 is server 00:01:00 → 1 real minute → 60 game minutes.
    expect(gameMinuteAt(sync, Date.parse('2026-01-01T00:00:30.000Z'))).toBeCloseTo(60);
  });

  it('counts down to the next 8-hour production cycle', () => {
    expect(minutesToNextProduction(0)).toBe(480);
    expect(minutesToNextProduction(470)).toBe(10);
  });
});

describe('describe', () => {
  const view = {
    you: 'p1',
    players: [
      { id: 'p1', name: 'alice' },
      { id: 'p2', name: 'bob' },
    ],
    outposts: [
      { id: 'o-1', name: 'Kelthal' },
      { id: 'o-2', name: 'Vorn' },
    ],
  } as never;
  const names = namesFor(view);

  it('describes orders and events with names', () => {
    expect(describeOrder({ kind: 'launch', at: 10, player: 'p1', from: 'o-1', to: 'o-2', drillers: 10, specialists: [] }, names)).toBe(
      'Launch 10 drillers Kelthal → Vorn',
    );
    expect(describeEvent({ kind: 'outpostCaptured', at: 0, outpost: 'o-2', from: 'p2', to: 'p1' }, names)).toBe(
      'You captured Vorn from bob',
    );
    expect(describeEvent({ kind: 'playerEliminated', at: 0, player: 'p2', reason: 'queenCaptured' }, names)).toBe(
      'bob was eliminated (Queen captured)',
    );
  });

  it('names specialists, and describes hiring, promoting and redirecting', () => {
    expect(describeOrder({ kind: 'hire', at: 10, player: 'p1', choice: 'securityChief' }, names)).toBe(
      'Hire a Security Chief',
    );
    expect(describeOrder({ kind: 'promote', at: 10, player: 'p1', specialist: 'spec-3' }, names)).toBe(
      'Promote a specialist',
    );
    expect(describeOrder({ kind: 'redirect', at: 10, player: 'p1', sub: 'sub-1', to: 'o-2' }, names)).toBe(
      'Redirect a sub to Vorn',
    );
    expect(
      describeEvent(
        { kind: 'specialistHired', at: 0, player: 'p1', kinds: ['lieutenant'], outpost: 'o-1' },
        names,
      ),
    ).toBe('You hired Lieutenant at Kelthal');
    expect(
      describeEvent({ kind: 'queenSucceeded', at: 0, player: 'p1', specialist: 'spec-2', lostQueen: 'spec-1' }, names),
    ).toBe('A Princess took over as Queen for you');
  });

  it('shows what the specialists did in a fight, and reads naturally for you', () => {
    const sides = [
      { player: 'p1', drillersBefore: 0, drillersAfter: 0, specialists: 1 },
      { player: 'p2', drillersBefore: 40, drillersAfter: 34, specialists: 0 },
    ];
    expect(
      describeEvent(
        {
          kind: 'combat',
          at: 0,
          outpost: 'o-2',
          subs: ['sub-4'],
          players: ['p1', 'p2'],
          winner: 'p2',
          details: { sides, effects: ['Thief stole 6 drillers'] },
        },
        names,
      ),
    ).toBe('Combat at Vorn: bob won (Thief stole 6 drillers)');
    expect(describeEvent({ kind: 'subArrived', at: 0, sub: 'sub-4', owner: 'p1', outpost: 'o-2' }, names)).toBe(
      'Your sub arrived at Vorn',
    );
    expect(
      describeEvent({ kind: 'specialistCaptured', at: 0, specialists: ['spec-3'], owners: ['p1'], by: 'p2', outpost: 'o-2' }, names),
    ).toBe('bob captured a specialist at Vorn');
  });
});

describe('plannedTripLabel', () => {
  it('shows a fixed trip length, not a countdown', () => {
    expect(plannedTripLabel(700, 24 * 60 + 220)).toBe('travel 11h 40m · arrives ~Day 2, 03:40');
  });
});
