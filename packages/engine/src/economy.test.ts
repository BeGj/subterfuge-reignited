import { describe, expect, it } from 'vitest';
import { electricalOutput, factoryCycleOutput, mineDrillCost, neptuniumPerDay } from './economy.js';

describe('electricalOutput', () => {
  it('is 150 base + 50 per generator (+50 when funded)', () => {
    expect(electricalOutput({ generators: 0 })).toBe(150);
    expect(electricalOutput({ generators: 4 })).toBe(350);
    expect(electricalOutput({ generators: 4, funded: true })).toBe(400);
  });
});

describe('factoryCycleOutput', () => {
  it('produces 6 per cycle (8 when funded)', () => {
    expect(factoryCycleOutput({ totalDrillers: 0, electricalOutput: 150 })).toBe(6);
    expect(factoryCycleOutput({ totalDrillers: 0, electricalOutput: 150, funded: true })).toBe(8);
  });

  it('stops at the electrical output cap without removing drillers', () => {
    expect(factoryCycleOutput({ totalDrillers: 147, electricalOutput: 150 })).toBe(3);
    expect(factoryCycleOutput({ totalDrillers: 200, electricalOutput: 150 })).toBe(0);
  });
});

describe('mineDrillCost', () => {
  it('follows 50, 100, 200, 300, 400', () => {
    expect([0, 1, 2, 3, 4].map(mineDrillCost)).toEqual([50, 100, 200, 300, 400]);
  });
});

describe('neptuniumPerDay', () => {
  it('rulebook: 7 outposts with 2 mines gives 14 kg/day', () => {
    expect(neptuniumPerDay(2, 7)).toBe(14);
  });
});
