import { describe, expect, it } from 'vitest';
import type { GameEvent, Order } from '@subterfuge/engine';
import { eventVisibleTo } from './runtime.ts';

describe('eventVisibleTo', () => {
  const launch: Order = { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists: [], at: 10, player: 'p1' };
  const cases: [GameEvent, string[]][] = [
    [{ kind: 'orderRejected', at: 10, order: launch, reason: 'x' }, ['p1']],
    [{ kind: 'subLaunched', at: 10, sub: 's', owner: 'p1', from: 'o-1', to: 'o-2' }, ['p1']],
    [{ kind: 'outpostCaptured', at: 10, outpost: 'o-2', from: 'p2', to: 'p1' }, ['p1', 'p2']],
    [{ kind: 'combat', at: 10, outpost: 'o-2', subs: ['s'], players: ['p1', 'p2'], winner: 'p1' }, ['p1', 'p2']],
    [{ kind: 'mineDrilled', at: 10, outpost: 'o-1', player: 'p1' }, ['p1', 'p2', 'p3']],
    [{ kind: 'gameWon', at: 10, player: 'p1', reason: 'neptunium' }, ['p1', 'p2', 'p3']],
  ];

  it.each(cases)('%o is visible only to %o', (event, allowed) => {
    for (const player of ['p1', 'p2', 'p3']) {
      expect(eventVisibleTo(event, player)).toBe(allowed.includes(player));
    }
  });
});
