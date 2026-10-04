import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  LAUNCH_DELAY,
  advance,
  generateMap,
  viewFor,
  type GameSnapshot,
  type GameState,
  type LaunchOrder,
} from '@subterfuge/engine';
import { TimeMachine } from './time-machine';

/** A live 2-player game and a time machine bound to p1's snapshot of it. */
function setup() {
  const state: GameState = generateMap({ seed: 7, players: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] });
  const view = viewFor(state, 'p1');
  const from = view.outposts.find((o) => o.owner === 'p1' && (o.drillers ?? 0) >= 40)!;
  const target = view.outposts
    .filter((o) => o.visible && o.owner === null)
    .sort((a, b) => Math.hypot(a.position.x - from.position.x, a.position.y - from.position.y) - Math.hypot(b.position.x - from.position.x, b.position.y - from.position.y))[0]!;
  const launch: LaunchOrder = { kind: 'launch', at: LAUNCH_DELAY, player: 'p1', from: from.id, to: target.id, drillers: 30, specialists: [] };
  const snapshot = signal<GameSnapshot | null>({
    gameId: 'g',
    view,
    pendingOrders: [{ id: '1', order: launch }],
    clock: { startedAt: new Date(0).toISOString(), speed: 60, serverNow: new Date(0).toISOString() },
    events: [],
  });

  TestBed.configureTestingModule({ providers: [TimeMachine] });
  const tm = TestBed.inject(TimeMachine);
  tm.bind(snapshot, signal(0));
  return { state, tm, target, launch };
}

describe('TimeMachine', () => {
  it('lets you jump to an arrival and launch the arrived drillers onward', () => {
    const { state, tm, target, launch } = setup();
    const arrival = tm.prediction('order:1')!;
    expect(arrival.outcome).toBe('safe');

    tm.jumpTo(arrival.at);
    // On screen: the target is ours, with the drillers that just arrived.
    expect(tm.view()!.outposts.find((o) => o.id === target.id)).toMatchObject({ owner: 'p1', drillers: 30 });

    const onward = view(tm).outposts.find((o) => o.visible && o.owner === null && o.id !== target.id)!;
    const next = { kind: 'launch' as const, from: target.id, to: onward.id, drillers: 30, specialists: [] };
    expect(tm.validateScheduled(next)).toBeNull();

    // And the real game agrees: both orders replayed through the engine.
    const at = tm.scheduleFor(next)!;
    expect(at).toBe(arrival.at + 10);
    const { events } = advance(state, [launch, { ...next, at, player: 'p1' }], at);
    expect(events.filter((e) => e.kind === 'orderRejected')).toEqual([]);
    expect(events.some((e) => e.kind === 'subLaunched' && e.from === target.id && e.at === at)).toBe(true);
  });

  it("keeps other players' leaderboard numbers live in a forecast", () => {
    const { tm } = setup();
    tm.jumpTo(3 * 24 * 60);
    expect(tm.view()!.players.find((p) => p.id === 'p2')?.outpostCount).toBe(5);
  });

  it('animates through time to the target, then stops', () => {
    const { tm } = setup();
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const step = (ms: number) => {
      now += ms;
      frames.splice(0).forEach((cb) => cb(now));
    };

    tm.travelTo(600);
    expect(tm.playing()).toBe(true);
    step(16);
    step(300);
    const mid = tm.scrub()!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(600);
    step(5000);
    expect(tm.scrub()).toBe(600);
    expect(tm.playing()).toBe(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('still rejects orders that would fail at that time', () => {
    const { tm, target } = setup();
    tm.jumpTo(tm.prediction('order:1')!.at);
    const tooMany = { kind: 'launch' as const, from: target.id, to: target.id === 'o-1' ? 'o-2' : 'o-1', drillers: 31, specialists: [] };
    expect(tm.validateScheduled(tooMany)).toMatch(/Not enough drillers/);
  });
});

const view = (tm: TimeMachine) => tm.view()!;
