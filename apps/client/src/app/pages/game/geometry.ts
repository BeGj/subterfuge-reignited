import { SUB_SPEED, TICK, distance, type OutpostView, type Point, type Sub } from '@subterfuge/engine';

/** Travel time in game minutes between two points at 1.0 speed (tick-rounded, min one tick). */
export function travelMinutes(a: Point, b: Point): number {
  return Math.max(TICK, Math.ceil(distance(a, b) / SUB_SPEED / TICK) * TICK);
}

/** Position of a sub at a fractional game minute: linear from→to, clamped to the route. */
export function subPositionAt(sub: Sub, from: Point, to: Point, minute: number): Point {
  const span = sub.arrivesAt - sub.launchedAt;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (minute - sub.launchedAt) / span));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * The outpost nearest `point` within `radius` (map units), or undefined.
 * Used to turn a click on the canvas into a selection.
 */
export function hitTestOutpost(outposts: readonly OutpostView[], point: Point, radius: number): OutpostView | undefined {
  let best: OutpostView | undefined;
  let bestDistance = radius;
  for (const outpost of outposts) {
    const d = distance(outpost.position, point);
    if (d <= bestDistance) {
      best = outpost;
      bestDistance = d;
    }
  }
  return best;
}

/** Distance from `p` to the segment a–b (same units as the inputs). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Something clickable on screen: a point target or a segment (route). */
export type Hittable<T> = { value: T; at: Point } | { value: T; from: Point; to: Point };

/**
 * The nearest target within `radius` of `point`, checking groups in priority
 * order: anything in an earlier group wins over anything in a later one.
 */
export function pick<T>(groups: readonly (readonly Hittable<T>[])[], point: Point, radius: number): T | undefined {
  for (const group of groups) {
    let best: T | undefined;
    let bestDistance = radius;
    for (const h of group) {
      const d = 'at' in h ? Math.hypot(h.at.x - point.x, h.at.y - point.y) : distanceToSegment(point, h.from, h.to);
      if (d <= bestDistance) {
        best = h.value;
        bestDistance = d;
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}
