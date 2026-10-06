import { describe, expect, it } from 'vitest';
import type { GameEvent, Order, PlayerView } from '@subterfuge/engine';
import { eventVisibleTo, imminentLaunchesFor } from './runtime.ts';

describe('eventVisibleTo', () => {
  const launch: Order = { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists: [], at: 10, player: 'p1' };
  const cases: [GameEvent, string[]][] = [
    [{ kind: 'orderRejected', at: 10, order: launch, reason: 'x' }, ['p1']],
    [{ kind: 'subLaunched', at: 10, sub: 's', owner: 'p1', from: 'o-1', to: 'o-2' }, ['p1']],
    [{ kind: 'outpostCaptured', at: 10, outpost: 'o-2', from: 'p2', to: 'p1' }, ['p1', 'p2']],
    [{ kind: 'combat', at: 10, outpost: 'o-2', subs: ['s'], players: ['p1', 'p2'], winner: 'p1', details: { sides: [] } }, ['p1', 'p2']],
    [{ kind: 'mineDrilled', at: 10, outpost: 'o-1', player: 'p1' }, ['p1', 'p2', 'p3']],
    [{ kind: 'gameWon', at: 10, player: 'p1', reason: 'neptunium' }, ['p1', 'p2', 'p3']],
    [{ kind: 'specialistOffered', at: 10, player: 'p1', offer: { at: 10, kinds: { other: 'princess' } } }, ['p1']],
    [{ kind: 'specialistHired', at: 10, player: 'p1', kinds: ['princess'], outpost: 'o-1' }, ['p1', 'p2', 'p3']],
    [
      { kind: 'specialistCaptured', at: 10, specialists: ['spec-2'], owners: ['p2'], by: 'p1', outpost: 'o-2' },
      ['p1', 'p2'],
    ],
    [{ kind: 'specialistDestroyed', at: 10, specialists: ['spec-3'], owners: ['p2'] }, ['p2']],
    [{ kind: 'subRedirected', at: 10, sub: 's', owner: 'p1', from: 'o-1', to: 'o-2' }, ['p1']],
  ];

  it.each(cases)('%o is visible only to %o', (event, allowed) => {
    for (const player of ['p1', 'p2', 'p3']) {
      expect(eventVisibleTo(event, player)).toBe(allowed.includes(player));
    }
  });
});

describe('imminentLaunchesFor', () => {
  const view = {
    you: 'p2',
    time: 100,
    width: 1000,
    height: 1000,
    players: [],
    outposts: [
      { id: 'seen', name: 'Seen', position: { x: 0, y: 0 }, owner: 'p1', visible: true },
      { id: 'hidden', name: 'Hidden', position: { x: 900, y: 0 }, visible: false },
      { id: 'mine', name: 'Mine', position: { x: 100, y: 0 }, owner: 'p2', visible: true },
    ],
    subs: [],
    specialists: [],
    hiring: { nextOfferAt: Number.MAX_SAFE_INTEGER, offer: null },
    winner: null,
    endedAt: null,
    endVotes: [],
  } as unknown as PlayerView;
  const launch = (id: string, from: string, to: string, at: number, player = 'p1') => ({
    id,
    order: { kind: 'launch', from, to, drillers: 10, specialists: [], at, player } as Order,
  });

  it('shows enemy launches about to leave from inside your sonar or heading for you', () => {
    const shown = imminentLaunchesFor(
      view,
      [
        launch('a', 'seen', 'hidden', 110), // visible origin, about to launch
        launch('b', 'hidden', 'mine', 120), // hidden origin, but heading for you
        launch('c', 'hidden', 'seen', 110), // hidden origin, not heading for you
        launch('d', 'seen', 'hidden', 500), // scheduled far ahead: still secret
        launch('e', 'mine', 'seen', 110, 'p2'), // your own
      ],
      100,
    );
    expect(shown.map((o) => `${o.from}->${o.to}@${o.at}`)).toEqual(['seen->hidden@110', 'hidden->mine@120']);
  });
});
