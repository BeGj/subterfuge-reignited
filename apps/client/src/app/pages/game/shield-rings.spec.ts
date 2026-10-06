import { shieldRingFill } from './shield-rings';

describe('shieldRingFill', () => {
  it('draws one ring for a 10-shield and two for a 20-shield', () => {
    expect(shieldRingFill(0, 10)).toEqual([0]);
    expect(shieldRingFill(0, 20)).toEqual([0, 0]);
  });

  it('fills from the inner ring outwards', () => {
    expect(shieldRingFill(5, 10)).toEqual([0.5]);
    expect(shieldRingFill(5, 20)).toEqual([0.5, 0]);
    expect(shieldRingFill(14, 20)).toEqual([1, 0.4]);
    expect(shieldRingFill(20, 20)).toEqual([1, 1]);
  });

  it('adds rings for the Queen bonus (30 or 40)', () => {
    expect(shieldRingFill(25, 40)).toEqual([1, 1, 0.5, 0]);
  });
});
