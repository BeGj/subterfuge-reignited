import {
  BASE_ELECTRICAL_OUTPUT,
  FACTORY_DRILLERS_PER_CYCLE,
  FUNDING_DRILLERS_PER_CYCLE,
  FUNDING_ELECTRICAL_BONUS,
  GENERATOR_ELECTRICAL_OUTPUT,
} from './constants.js';

export interface ElectricalOutputInput {
  generators: number;
  funded?: boolean;
}

/** Max total drillers a player's factories will produce up to. */
export function electricalOutput({ generators, funded = false }: ElectricalOutputInput): number {
  return (
    BASE_ELECTRICAL_OUTPUT +
    generators * GENERATOR_ELECTRICAL_OUTPUT +
    (funded ? FUNDING_ELECTRICAL_BONUS : 0)
  );
}

export interface FactoryCycleInput {
  /** Drillers the player owns right now, everywhere (outposts and subs). */
  totalDrillers: number;
  electricalOutput: number;
  funded?: boolean;
}

/**
 * Drillers one factory adds in a production cycle. Production stops at the
 * electrical output cap; drillers already above the cap are never removed.
 */
export function factoryCycleOutput({
  totalDrillers,
  electricalOutput,
  funded = false,
}: FactoryCycleInput): number {
  const perCycle = FACTORY_DRILLERS_PER_CYCLE + (funded ? FUNDING_DRILLERS_PER_CYCLE : 0);
  const room = electricalOutput - totalDrillers;
  return Math.max(0, Math.min(perCycle, room));
}

/**
 * Drillers needed to drill the next mine: 50, 100, 200, 300, 400, ...
 * Only mines the player drilled themselves count; captured mines don't.
 */
export function mineDrillCost(minesAlreadyDrilled: number): number {
  return minesAlreadyDrilled === 0 ? 50 : minesAlreadyDrilled * 100;
}

/** Each mine yields 1 kg per day for every outpost the player owns. */
export function neptuniumPerDay(mines: number, outpostsOwned: number): number {
  return mines * outpostsOwned;
}
