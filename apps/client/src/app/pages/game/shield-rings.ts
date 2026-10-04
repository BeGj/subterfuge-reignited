import { QUEEN_SHIELD_BONUS, type OutpostView, type PlayerView } from '@subterfuge/engine';

/** Shield charge one ring represents: a 10-shield has 1 ring, a 20-shield 2. */
export const CHARGE_PER_RING = 10;

/**
 * The outpost's real shield maximum: its base max (10 or 20) plus the
 * Queen's +20 when its owner's free Queen is there. The view's `shieldMax`
 * is the base value only.
 */
export function effectiveShieldMax(view: PlayerView, outpost: OutpostView): number | undefined {
  if (outpost.shieldMax === undefined) return undefined;
  const queenHere = view.specialists.some(
    (s) =>
      s.kind === 'queen' &&
      s.owner === outpost.owner &&
      s.captiveOf === null &&
      'outpost' in s.location &&
      s.location.outpost === outpost.id,
  );
  return outpost.shieldMax + (queenHere ? QUEEN_SHIELD_BONUS : 0);
}

/**
 * How full each shield ring is, innermost first (0–1 each). Rings fill from
 * the inside out: 14 / 20 → [1, 0.4].
 */
export function shieldRingFill(charge: number, max: number): number[] {
  const rings = Math.max(1, Math.ceil(max / CHARGE_PER_RING));
  return Array.from({ length: rings }, (_, i) => Math.min(1, Math.max(0, (charge - i * CHARGE_PER_RING) / CHARGE_PER_RING)));
}
