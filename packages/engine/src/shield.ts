import { SHIELD_FULL_CHARGE_TIME } from './constants.js';

/**
 * Shields fill from empty to full in `SHIELD_FULL_CHARGE_TIME`, whatever
 * their max. A 20-shield therefore charges twice as fast as a 10-shield.
 *
 * To keep that exact with integer maths we store shield *progress*:
 * every minute adds `max` progress, and one unit of charge equals
 * `SHIELD_FULL_CHARGE_TIME` progress. Partial charge is never lost when
 * a shield is advanced in many small steps.
 */

/** Whole shield charge represented by a progress value. */
export function shieldCharge(progress: number): number {
  return Math.floor(progress / SHIELD_FULL_CHARGE_TIME);
}

/** Progress value for a whole charge (e.g. after combat drains it). */
export function progressForCharge(charge: number): number {
  return charge * SHIELD_FULL_CHARGE_TIME;
}

/** Progress after `minutes` of charging, capped at `max`. */
export function chargeShield(progress: number, max: number, minutes: number): number {
  const cap = progressForCharge(max);
  if (progress >= cap) return cap;
  return Math.min(cap, progress + max * minutes);
}
