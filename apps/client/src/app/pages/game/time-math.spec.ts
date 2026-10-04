import { DAY, LAUNCH_DELAY, UNKNOWN_PLAYER, type ArrivalPrediction, type PlayerView } from '@subterfuge/engine';
import { battleIcons } from './battle-icons';
import {
  HORIZON_PADDING,
  MIN_HORIZON,
  outcomeFor,
  outcomeSummary,
  scheduledAt,
  scrubHorizon,
  tickAtOrAfter,
  tickOf,
} from './time-math';
import { maskUnknown, type Prediction } from './time-machine';

const fight = (over: Partial<ArrivalPrediction> = {}): ArrivalPrediction => ({
  owner: 'p1',
  from: 'a',
  to: 'b',
  at: 600,
  departsAt: 0,
  arrivesAt: 600,
  outcome: 'win',
  combat: {
    at: 600,
    outpost: 'b',
    winner: 'p1',
    details: {
      sides: [
        { player: 'p1', drillersBefore: 30, drillersAfter: 12, specialists: 0 },
        { player: 'p2', drillersBefore: 10, drillersAfter: 0, specialists: 0 },
      ],
      shieldBefore: 8,
      shieldAfter: 0,
    },
  },
  ...over,
});

describe('time rounding', () => {
  it('rounds to ticks', () => {
    expect(tickOf(319.9)).toBe(310);
    expect(tickAtOrAfter(310.1)).toBe(320);
    expect(tickAtOrAfter(320)).toBe(320);
  });
});

describe('scheduledAt', () => {
  it('uses the scrubbed tick', () => {
    expect(scheduledAt(1003, 300, false)).toBe(1010);
  });
  it('never schedules before the server allows', () => {
    expect(scheduledAt(301, 300, true)).toBe(300 + LAUNCH_DELAY);
    expect(scheduledAt(300, 300, false)).toBe(310);
  });
});

describe('scrubHorizon', () => {
  it('reaches at least 3 days ahead', () => {
    expect(scrubHorizon(100, [])).toBe(tickAtOrAfter(100 + MIN_HORIZON));
  });
  it('reaches past the latest arrival', () => {
    expect(scrubHorizon(0, [fight({ at: 5 * DAY })])).toBe(5 * DAY + HORIZON_PADDING);
  });
});

describe('outcomeFor / outcomeSummary', () => {
  it('reads your own launch as is', () => {
    expect(outcomeFor(fight(), 'p1')).toBe('win');
    expect(outcomeSummary(fight(), 'p1')).toBe('Wins with 12 drillers left.');
  });

  it('flips an enemy attack on you', () => {
    expect(outcomeFor(fight({ owner: 'p2' }), 'p1')).toBe('lose');
  });

  it('says how many more drillers a losing launch needs (ties go to the defender)', () => {
    const lose = fight({
      outcome: 'lose',
      combat: {
        at: 600,
        outpost: 'b',
        winner: 'p2',
        details: {
          sides: [
            { player: 'p1', drillersBefore: 10, drillersAfter: 0, specialists: 0 },
            { player: 'p2', drillersBefore: 15, drillersAfter: 7, specialists: 0 },
          ],
          shieldBefore: 2,
          shieldAfter: 0,
        },
      },
    });
    expect(outcomeSummary(lose, 'p1')).toBe('Loses: needs about 8 more drillers.');
  });

  it('words a lost sub-vs-sub fight as a sub loss', () => {
    const subFight = fight({ owner: 'p2', combat: { ...fight().combat!, outpost: undefined } });
    expect(outcomeSummary(subFight, 'p1')).toBe('Your sub is predicted to lose this fight.');
  });

  it('ignores fights you are not part of and peaceful arrivals', () => {
    expect(outcomeFor(fight({ owner: 'p2' }), 'p3')).toBe('none');
    expect(outcomeFor(fight({ outcome: 'safe', combat: undefined }), 'p1')).toBe('none');
  });

  it('reports unknown targets', () => {
    expect(outcomeFor(fight({ outcome: 'unknown' }), 'p1')).toBe('unknown');
  });
});

const view: PlayerView = {
  you: 'p1',
  time: 0,
  width: 1000,
  height: 1000,
  players: [
    { id: 'p1', name: 'One', neptunium: 0, outpostCount: 1, minesDrilled: 0, eliminated: false },
    { id: UNKNOWN_PLAYER, name: 'Unknown', neptunium: 0, outpostCount: 1, minesDrilled: 0, eliminated: true },
  ],
  outposts: [
    { id: 'a', name: 'A', position: { x: 0, y: 0 }, owner: 'p1', drillers: 10, visible: true, type: 'factory' },
    { id: 'b', name: 'B', position: { x: 600, y: 0 }, owner: UNKNOWN_PLAYER, drillers: 0, visible: true, type: 'mine' },
  ],
  subs: [],
  specialists: [],
  winner: null,
  endedAt: null,
};

describe('maskUnknown', () => {
  it('hides placeholder-owned outposts and drops the placeholder player', () => {
    const masked = maskUnknown(view);
    expect(masked.players.map((p) => p.id)).toEqual(['p1']);
    expect(masked.outposts[1]).toEqual({ id: 'b', name: 'B', position: { x: 600, y: 0 }, visible: false, type: 'mine' });
  });
});

describe('battleIcons', () => {
  const prediction = (over: Partial<Prediction>): Prediction => ({ ...fight(), key: 'order:1', yours: 'win', ...over });

  it('puts outpost fights on the target and skips fights you are not in', () => {
    const icons = battleIcons(view, [prediction({}), prediction({ key: 'order:2', yours: 'none' })]);
    expect(icons).toEqual([{ key: 'order:1', outcome: 'win', at: { x: 600, y: 0 } }]);
  });

  it('draws a sub-vs-sub fight once, using your own sub', () => {
    const combat = { ...fight().combat!, at: 300, outpost: undefined };
    const icons = battleIcons(view, [
      prediction({ key: 'sub:enemy', owner: 'p2', from: 'b', to: 'a', yours: 'lose', at: 300, combat }),
      prediction({ key: 'sub:mine', owner: 'p1', yours: 'lose', at: 300, combat }),
    ]);
    expect(icons.map((i) => i.key)).toEqual(['sub:mine']);
  });

  it('puts sub-vs-sub fights along the route', () => {
    const p = prediction({ at: 300, combat: { ...fight().combat!, at: 300, outpost: undefined } });
    const [icon] = battleIcons(view, [p]);
    expect(icon!.at.y).toBe(0);
    expect(icon!.at.x).toBeGreaterThan(0);
    expect(icon!.at.x).toBeLessThan(600);
  });
});
