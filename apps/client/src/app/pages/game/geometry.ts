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
