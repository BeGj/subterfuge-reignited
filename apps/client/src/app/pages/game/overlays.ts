import { LAUNCH_DELAY, TICK, type PendingOrder, type PlayerView, type Point } from '@subterfuge/engine';
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
    const wait = formatDuration(Math.max(0, p.order.at - minute));
    switch (p.order.kind) {
      case 'launch': {
        const anchor = pos.get(p.order.from);
        const target = pos.get(p.order.to);
        if (anchor && target) markers.push({ orderId: p.id, kind: 'launch', anchor, target, text: `${wait} · ${p.order.drillers}` });
        break;
      }
      case 'drillMine':
      case 'setShield': {
        const anchor = pos.get(p.order.outpost);
        const what = p.order.kind === 'drillMine' ? 'Mine' : p.order.enabled ? 'Shield on' : 'Shield off';
        if (anchor) markers.push({ orderId: p.id, kind: 'outpost', anchor, text: `${what} ${wait}` });
        break;
      }
      case 'resign':
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
