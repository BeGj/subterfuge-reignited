import type { Point } from './types.js';

/**
 * Straight-line distance in map units. The map does not wrap around.
 * Uses `Math.sqrt`, not `Math.hypot`: sqrt is exactly specified by IEEE 754,
 * hypot isn't, and server and browsers must compute identical results.
 */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
