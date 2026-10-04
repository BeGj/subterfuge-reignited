import type { PendingOrder, PlayerView } from '@subterfuge/engine';
import { distanceToSegment, pick, type Hittable } from './geometry';
import { BADGE_OFFSET, badgeCenter, estimatedLaunchAt, orderMarkers } from './overlays';
import { isSelected, sameSelection, type Selection } from './selection';

const view = {
  you: 'p1',
  outposts: [
    { id: 'o-1', name: 'A', position: { x: 0, y: 0 }, visible: true },
    { id: 'o-2', name: 'B', position: { x: 100, y: 0 }, visible: true },
  ],
} as unknown as PlayerView;

const pending = (order: Record<string, unknown>, id = '1'): PendingOrder =>
  ({ id, order: { at: 120, player: 'p1', ...order } }) as unknown as PendingOrder;

describe('estimatedLaunchAt', () => {
  it('adds the launch delay and rounds up to the next tick', () => {
    expect(estimatedLaunchAt(100)).toBe(110);
    expect(estimatedLaunchAt(103)).toBe(120);
  });
});

describe('orderMarkers', () => {
  it('turns launches into routes and other orders into outpost badges', () => {
    const markers = orderMarkers(
      view,
      [
        pending({ kind: 'launch', from: 'o-1', to: 'o-2', drillers: 20, specialists: [] }, '1'),
        pending({ kind: 'setShield', outpost: 'o-2', enabled: false }, '2'),
        pending({ kind: 'drillMine', outpost: 'o-1' }, '3'),
        pending({ kind: 'resign' }, '4'),
      ],
      110,
    );
    expect(markers).toEqual([
      { orderId: '1', kind: 'launch', anchor: { x: 0, y: 0 }, target: { x: 100, y: 0 }, text: '10m · 20' },
      { orderId: '2', kind: 'outpost', anchor: { x: 100, y: 0 }, text: 'Shield off 10m' },
      { orderId: '3', kind: 'outpost', anchor: { x: 0, y: 0 }, text: 'Mine 10m' },
    ]);
  });

  it('skips orders whose outposts are unknown', () => {
    expect(orderMarkers(view, [pending({ kind: 'drillMine', outpost: 'o-9' })], 0)).toEqual([]);
  });
});

describe('badgeCenter', () => {
  const camera = { center: { x: 0, y: 0 }, scale: 1 };
  const viewport = { width: 0, height: 0 };

  it('places launch badges along the route, never past halfway', () => {
    const marker = { orderId: '1', kind: 'launch' as const, anchor: { x: 0, y: 0 }, target: { x: 100, y: 0 }, text: '' };
    expect(badgeCenter(marker, camera, viewport)).toEqual({ x: BADGE_OFFSET, y: 0 });
    const short = { ...marker, target: { x: 20, y: 0 } };
    expect(badgeCenter(short, camera, viewport)).toEqual({ x: 10, y: 0 });
  });

  it('stacks outpost badges for several orders', () => {
    const marker = { orderId: '1', kind: 'outpost' as const, anchor: { x: 0, y: 0 }, text: '' };
    expect(badgeCenter(marker, camera, viewport, 1).y).toBeLessThan(badgeCenter(marker, camera, viewport, 0).y);
  });
});

describe('hit testing', () => {
  it('measures distance to a segment, clamped to its ends', () => {
    expect(distanceToSegment({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
  });

  it('prefers earlier groups, then the nearest target', () => {
    const sub: Selection = { kind: 'sub', id: 's' };
    const near: Selection = { kind: 'outpost', id: 'near' };
    const far: Selection = { kind: 'outpost', id: 'far' };
    const groups: Hittable<Selection>[][] = [[{ value: sub, at: { x: 10, y: 0 } }], [
      { value: far, at: { x: 8, y: 0 } },
      { value: near, at: { x: 1, y: 0 } },
    ]];
    expect(pick(groups, { x: 0, y: 0 }, 16)).toBe(sub);
    expect(pick([groups[1]!], { x: 0, y: 0 }, 16)).toBe(near);
    expect(pick(groups, { x: 100, y: 0 }, 16)).toBeUndefined();
    expect(pick([[{ value: far, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]], { x: 50, y: 4 }, 6)).toBe(far);
  });
});

describe('selection', () => {
  it('compares selections by kind and id', () => {
    expect(sameSelection({ kind: 'sub', id: 'a' }, { kind: 'sub', id: 'a' })).toBe(true);
    expect(sameSelection({ kind: 'sub', id: 'a' }, { kind: 'outpost', id: 'a' })).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
    expect(isSelected({ kind: 'order', id: '1' }, 'order', '1')).toBe(true);
    expect(isSelected(null, 'order', '1')).toBe(false);
  });
});
