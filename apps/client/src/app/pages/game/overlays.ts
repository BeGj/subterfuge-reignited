import { LAUNCH_DELAY, TICK, outpostOfSpec, type PendingOrder, type PlayerView, type Point } from '@subterfuge/engine';
import { toScreen, type Camera, type Viewport } from './camera';
import { formatDuration } from './format';

/** Game minute a launch ordered now would actually leave (next tick after the launch delay). */
export function estimatedLaunchAt(minute: number): number {
  return Math.ceil((minute + LAUNCH_DELAY) / TICK) * TICK;
}

/**
 * A pending order drawn on the map. Launches become a ghost route with a
 * badge near the origin; other orders a badge on their outpost.
 */
export interface OrderMarker {
  orderId: string;
  /** `hire` and `promote` show on the outpost the specialist is at. */
  kind: 'launch' | 'outpost';
  /** Map position of the origin / affected outpost. */
  anchor: Point;
  /** Launch target, for ghost routes. */
  target?: Point;
  /** Badge text, e.g. "8m · 20". */
  text: string;
}

export function orderMarkers(view: PlayerView, pending: readonly PendingOrder[], minute: number): OrderMarker[] {
  const pos = new Map(view.outposts.map((o) => [o.id, o.position]));
  const markers: OrderMarker[] = [];
  for (const p of pending) {
    // A const, so the discriminated union stays narrowed inside the callbacks.
    const order = p.order;
    const wait = formatDuration(Math.max(0, order.at - minute));
    switch (order.kind) {
      case 'launch': {
        const anchor = pos.get(order.from);
        const target = pos.get(order.to);
        if (anchor && target) markers.push({ orderId: p.id, kind: 'launch', anchor, target, text: `${wait} · ${order.drillers}` });
        break;
      }
      case 'drillMine':
      case 'setShield': {
        const anchor = pos.get(order.outpost);
        const what = order.kind === 'drillMine' ? 'Mine' : order.enabled ? 'Shield on' : 'Shield off';
        if (anchor) markers.push({ orderId: p.id, kind: 'outpost', anchor, text: `${what} ${wait}` });
        break;
      }
      case 'redirect': {
        const anchor = pos.get(order.to);
        if (anchor) markers.push({ orderId: p.id, kind: 'outpost', anchor, text: `Redirect ${wait}` });
        break;
      }
      case 'hire': {
        // The new specialist appears where the Queen is.
        const player = order.player;
        const queen = view.specialists.find(
          (s) => s.kind === 'queen' && s.owner === player && outpostOfSpec(s) !== null,
        );
        const anchor = queen ? pos.get(outpostOfSpec(queen)!) : undefined;
        if (anchor) markers.push({ orderId: p.id, kind: 'outpost', anchor, text: `Hire ${wait}` });
        break;
      }
      case 'promote': {
        const wanted = order.specialist;
        const spec = view.specialists.find((s) => s.id === wanted);
        const anchor = spec ? pos.get(outpostOfSpec(spec) ?? '') : undefined;
        if (anchor) markers.push({ orderId: p.id, kind: 'outpost', anchor, text: `Promote ${wait}` });
        break;
      }
      case 'resign':
      case 'voteEnd':
        break;
    }
  }
  return markers;
}

/** Screen pixels between an outpost and its order badge. */
export const BADGE_OFFSET = 30;

/**
 * Screen centre of a marker's badge: along the route for launches, up and to
 * the right of the outpost for other orders. Badges for several orders on the
 * same outpost are stacked by `index`.
 */
export function badgeCenter(marker: OrderMarker, camera: Camera, viewport: Viewport, index = 0): Point {
  const a = toScreen(camera, viewport, marker.anchor);
  if (marker.kind === 'launch' && marker.target) {
    const b = toScreen(camera, viewport, marker.target);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along = Math.min(BADGE_OFFSET + index * 18, len / 2);
    return { x: a.x + ((b.x - a.x) / len) * along, y: a.y + ((b.y - a.y) / len) * along };
  }
  return { x: a.x + BADGE_OFFSET, y: a.y - 18 - index * 18 };
}
