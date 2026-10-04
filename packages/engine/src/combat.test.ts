import { describe, expect, it } from 'vitest';
import { resolveOutpostCombat, resolveSubCombat } from './combat.js';

const outpost = (o: Partial<Parameters<typeof resolveOutpostCombat>[0]>) =>
  resolveOutpostCombat({
    attackerDrillers: 0,
    attackerSpecialists: 0,
    defenderDrillers: 0,
    defenderShield: 0,
    defenderSpecialists: 0,
    ...o,
  });

describe('resolveOutpostCombat', () => {
  it('rulebook: an 8-charge shield vs 5 attackers destroys all 5 and keeps 3', () => {
    expect(outpost({ attackerDrillers: 5, defenderShield: 8 })).toEqual({
      winner: 'defender',
      attackerDrillers: 0,
      defenderDrillers: 0,
      defenderShield: 3,
    });
  });

  it('rulebook: 27 vs 11 leaves the winner with 16', () => {
    expect(outpost({ attackerDrillers: 27, defenderDrillers: 11 })).toMatchObject({
      winner: 'attacker',
      attackerDrillers: 16,
    });
  });

  it('applies the shield before drillers fight', () => {
    expect(outpost({ attackerDrillers: 30, defenderDrillers: 15, defenderShield: 10 })).toEqual({
      winner: 'attacker',
      attackerDrillers: 5,
      defenderDrillers: 0,
      defenderShield: 0,
    });
  });

  it('gives a full tie to the defender', () => {
    expect(outpost({ attackerDrillers: 10, defenderDrillers: 10 }).winner).toBe('defender');
  });

  it('breaks a driller tie with surviving specialists', () => {
    expect(outpost({ attackerDrillers: 10, defenderDrillers: 10, attackerSpecialists: 1 }).winner).toBe(
      'attacker',
    );
  });

  it('lets the outpost win while any shield remains, even if outnumbered in specialists', () => {
    expect(outpost({ attackerDrillers: 0, defenderShield: 2, attackerSpecialists: 3 }).winner).toBe(
      'defender',
    );
  });

  it('lets a specialist-only sub take an empty, unshielded outpost', () => {
    expect(outpost({ attackerSpecialists: 1 }).winner).toBe('attacker');
  });
});

describe('resolveSubCombat', () => {
  it('has no shield phase', () => {
    expect(resolveSubCombat({ drillers: 27, specialists: 0 }, { drillers: 11, specialists: 0 })).toEqual({
      winner: 'a',
      a: 16,
      b: 0,
    });
  });

  it('breaks ties with specialists, otherwise draws', () => {
    expect(resolveSubCombat({ drillers: 5, specialists: 0 }, { drillers: 5, specialists: 1 }).winner).toBe('b');
    expect(resolveSubCombat({ drillers: 5, specialists: 1 }, { drillers: 5, specialists: 1 }).winner).toBe(
      'draw',
    );
  });
});
