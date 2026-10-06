/** Shield charge one ring represents: a 10-shield has 1 ring, a 20-shield 2. */
export const CHARGE_PER_RING = 10;

/**
 * How full each shield ring is, innermost first (0–1 each). Rings fill from
 * the inside out: 14 / 20 → [1, 0.4].
 */
export function shieldRingFill(charge: number, max: number): number[] {
  const rings = Math.max(1, Math.ceil(max / CHARGE_PER_RING));
  return Array.from({ length: rings }, (_, i) => Math.min(1, Math.max(0, (charge - i * CHARGE_PER_RING) / CHARGE_PER_RING)));
}