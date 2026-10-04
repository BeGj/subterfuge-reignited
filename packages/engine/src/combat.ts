/**
 * Combat resolution (goal.md → Combat). Combat has 4 phases:
 *
 *   1. Specialist phase — abilities in combat-priority order (not yet implemented;
 *      specialists currently only act as the tie-breaker).
 *   2. Shield phase     — outposts only: the shield destroys attackers 1-for-1.
 *   3. Driller phase    — the larger side wins and keeps the difference.
 *   4. Capture phase    — the loser's surviving specialists are captured
 *                         (handled by the caller, which knows where they go).
 */

export interface OutpostCombatInput {
  attackerDrillers: number;
  /** Attacking specialists still alive after the specialist phase. */
  attackerSpecialists: number;
  defenderDrillers: number;
  /** Whole shield charge (0 when the shield is disabled). */
  defenderShield: number;
  defenderSpecialists: number;
}

export interface OutpostCombatResult {
  winner: 'attacker' | 'defender';
  attackerDrillers: number;
  defenderDrillers: number;
  defenderShield: number;
}

export function resolveOutpostCombat(input: OutpostCombatInput): OutpostCombatResult {
  // Shield phase.
  const absorbed = Math.min(input.defenderShield, input.attackerDrillers);
  const attackers = input.attackerDrillers - absorbed;
  const shield = input.defenderShield - absorbed;
  const defenders = input.defenderDrillers;

  // Driller phase.
  if (attackers > defenders) {
    return { winner: 'attacker', attackerDrillers: attackers - defenders, defenderDrillers: 0, defenderShield: shield };
  }
  if (defenders > attackers) {
    return { winner: 'defender', attackerDrillers: 0, defenderDrillers: defenders - attackers, defenderShield: shield };
  }

  // Tie: both sides are wiped out. Remaining shield, then surviving
  // specialists break the tie; a full tie goes to the defender.
  const attackerWins = shield === 0 && input.attackerSpecialists > input.defenderSpecialists;
  return {
    winner: attackerWins ? 'attacker' : 'defender',
    attackerDrillers: 0,
    defenderDrillers: 0,
    defenderShield: shield,
  };
}

export interface SubCombatSide {
  drillers: number;
  /** Specialists still alive after the specialist phase. */
  specialists: number;
}

export interface SubCombatResult {
  winner: 'a' | 'b' | 'draw';
  a: number;
  b: number;
}

/**
 * Sub-to-sub combat has no shield phase. A full tie (same drillers, same
 * specialists) is a draw: both sides' specialists go home.
 */
export function resolveSubCombat(a: SubCombatSide, b: SubCombatSide): SubCombatResult {
  if (a.drillers > b.drillers) return { winner: 'a', a: a.drillers - b.drillers, b: 0 };
  if (b.drillers > a.drillers) return { winner: 'b', a: 0, b: b.drillers - a.drillers };
  if (a.specialists > b.specialists) return { winner: 'a', a: 0, b: 0 };
  if (b.specialists > a.specialists) return { winner: 'b', a: 0, b: 0 };
  return { winner: 'draw', a: 0, b: 0 };
}
