import { describe, expect, it } from 'vitest';
import { HOUR, SHIELD_FULL_CHARGE_TIME } from './constants.js';
import { chargeShield, progressForCharge, shieldCharge } from './shield.js';

describe('shields', () => {
  it('fill completely in 48 hours regardless of max', () => {
    expect(shieldCharge(chargeShield(0, 10, SHIELD_FULL_CHARGE_TIME))).toBe(10);
    expect(shieldCharge(chargeShield(0, 20, SHIELD_FULL_CHARGE_TIME))).toBe(20);
  });

  it('charges a 20-shield twice as fast as a 10-shield', () => {
    expect(shieldCharge(chargeShield(0, 10, 24 * HOUR))).toBe(5);
    expect(shieldCharge(chargeShield(0, 20, 24 * HOUR))).toBe(10);
  });

  it('keeps partial progress across many small steps', () => {
    let progress = 0;
    for (let i = 0; i < 24 * 6; i++) progress = chargeShield(progress, 10, 10);
    expect(shieldCharge(progress)).toBe(5);
  });

  it('never exceeds max', () => {
    expect(chargeShield(progressForCharge(10), 10, 1000)).toBe(progressForCharge(10));
  });
});
