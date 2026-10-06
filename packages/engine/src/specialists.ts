import {
  ADMIRAL_GLOBAL_SPEED,
  ENGINEER_REPAIR_SHARE,
  FOREMAN_DRILLERS_PER_CYCLE,
  FOREMAN_RADIUS_SHARE,
  GENERAL_DRILLERS_DESTROYED,
  HELMSMAN_SPEED,
  INTEL_OFFICER_SONAR_MULTIPLIER,
  KING_DRILLERS_PER_ENEMY_DESTROYED,
  KING_SHIELD_DELTA,
  LIEUTENANT_DRILLERS_DESTROYED,
  OFFICER_SPEED,
  PRINCESS_SONAR_MULTIPLIER,
  QUEEN_SHIELD_BONUS,
  SECURITY_CHIEF_SHIELD_BONUS,
  SONAR_RANGE,
  THIEF_DRILLER_SHARE,
} from './constants.js';
import { distance } from './geometry.js';
import type {
  GameState,
  Outpost,
  OutpostId,
  PlayerId,
  Point,
  Specialist,
  SpecialistCategory,
  SpecialistKind,
  Sub,
  SubId,
} from './types.js';

/**
 * The specialist catalogue and every question we ask about specialist
 * effects. Nothing else in the engine should switch on `kind`: add the kind
 * here and the mechanics, the decks, the hire cards and the panels all
 * follow. Rules are in goal.md → Specialists; the plan is
 * docs/specialists.md.
 */

export interface SpecialistDef {
  /** Display name. Ids stay terse so they read well in state and events. */
  name: string;
  category: SpecialistCategory;
  /** One line for the hire card and the panels. */
  blurb: string;
  /**
   * Combat priority: specialists act lowest first, and specialists with the
   * same priority act together. Undefined = no combat-phase effect.
   */
  priority?: number;
  /** In the hire decks. Promoted kinds are never hired. */
  hireable: boolean;
  /** Copies granted per hire. Assassin and Saboteur (batch 2) are 2. */
  hireSize: number;
  /** What promoting this kind gives you, if anything. */
  promotesTo?: SpecialistKind;
  /** Set on promoted kinds: the kind they come from. */
  promotedFrom?: SpecialistKind;
}

export const SPECIALIST_CATEGORIES: readonly SpecialistCategory[] = ['offensive', 'defensive', 'other'];

export const SPECIALISTS: Record<SpecialistKind, SpecialistDef> = {
  queen: {
    name: 'Queen',
    category: 'other',
    blurb: '+20 max shield at her outpost. Lose her and you are out — unless a Princess takes over.',
    hireable: false,
    hireSize: 1,
  },
  princess: {
    name: 'Princess',
    category: 'other',
    blurb: '+50% sonar at her outpost. The nearest Princess becomes Queen if you lose yours.',
    hireable: true,
    hireSize: 1,
  },
  helmsman: {
    name: 'Helmsman',
    category: 'other',
    blurb: 'His sub travels at 2× speed.',
    hireable: true,
    hireSize: 1,
  },
  lieutenant: {
    name: 'Lieutenant',
    category: 'offensive',
    blurb: 'Destroys 5 enemy drillers in combat. Travels at 1.5× speed.',
    priority: 8,
    hireable: true,
    hireSize: 1,
    promotesTo: 'general',
  },
  general: {
    name: 'General',
    category: 'offensive',
    blurb: 'Destroys 10 enemy drillers in any combat where you have a specialist. Travels at 1.5× speed.',
    hireable: false,
    hireSize: 1,
    promotedFrom: 'lieutenant',
  },
  thief: {
    name: 'Thief',
    category: 'offensive',
    blurb: 'When attacking an outpost or fighting another sub, converts 15% (rounded up) of the enemy drillers to your side.',
    priority: 4,
    hireable: true,
    hireSize: 1,
  },
  navigator: {
    name: 'Navigator',
    category: 'other',
    blurb: 'His sub may change destination once every 8 hours.',
    hireable: true,
    hireSize: 1,
    promotesTo: 'admiral',
  },
  admiral: {
    name: 'Admiral',
    category: 'other',
    blurb: '+50% speed to all your subs carrying no specialist. Travels at 1.5× speed.',
    hireable: false,
    hireSize: 1,
    promotedFrom: 'navigator',
  },
  foreman: {
    name: 'Foreman',
    category: 'other',
    blurb: '+4 drillers per cycle at your factories within half a sonar of her outpost.',
    hireable: true,
    hireSize: 1,
    promotesTo: 'engineer',
  },
  engineer: {
    name: 'Engineer',
    category: 'other',
    blurb: 'After every combat you win, 25% (rounded up) of your lost drillers are repaired.',
    hireable: false,
    hireSize: 1,
    promotedFrom: 'foreman',
  },
  inspector: {
    name: 'Inspector',
    category: 'defensive',
    blurb: 'Fully recharges her outpost’s shield on arrival, and again after every combat she is in.',
    hireable: true,
    hireSize: 1,
    promotesTo: 'securityChief',
  },
  securityChief: {
    name: 'Security Chief',
    category: 'defensive',
    blurb: '+10 max shield on all your outposts, +10 more at her own.',
    hireable: false,
    hireSize: 1,
    promotedFrom: 'inspector',
  },
  intelOfficer: {
    name: 'Intelligence Officer',
    category: 'other',
    blurb: '+25% sonar for all your outposts, and every outpost’s type is known.',
    hireable: true,
    hireSize: 1,
  },
  hypnotist: {
    name: 'Hypnotist',
    category: 'other',
    blurb: 'Takes control of every captured specialist held at his outpost. Converts a Queen to a Princess.',
    hireable: true,
    hireSize: 1,
    promotesTo: 'king',
  },
  king: {
    name: 'King',
    category: 'other',
    blurb:
      'Destroys 1 enemy driller per 4 of yours in every combat. Your outposts get −20 max shield, except his, which gets +20.',
    hireable: false,
    hireSize: 1,
    promotedFrom: 'hypnotist',
  },
} as const;

/** Display name of a kind; also used in battle summaries. */
export function specialistName(kind: SpecialistKind): string {
  return SPECIALISTS[kind].name;
}

/** Kinds that can be hired, in category order (what the decks are built from). */
export function hireableKinds(category?: SpecialistCategory): SpecialistKind[] {
  return SPECIALIST_CATEGORIES.filter((c) => !category || c === category).flatMap((c) =>
    (Object.keys(SPECIALISTS) as SpecialistKind[]).filter(
      (kind) => SPECIALISTS[kind].category === c && SPECIALISTS[kind].hireable,
    ),
  );
}

// --- Small helpers --------------------------------------------------------

/** Not held prisoner. Only free specialists do anything. */
export function isFree(spec: Specialist): boolean {
  return spec.captiveOf === null;
}

/** The outpost a specialist is standing at, if any. */
export function outpostOfSpec(spec: Specialist): string | null {
  return 'outpost' in spec.location ? spec.location.outpost : null;
}

function owns(spec: Specialist, owner: PlayerId, kind: SpecialistKind): boolean {
  return spec.owner === owner && spec.kind === kind && isFree(spec);
}

// --- Movement -------------------------------------------------------------

/**
 * Travel speed of a sub carrying `kinds`. Several specialists: the **fastest**
 * one wins rather than the bonuses multiplying (goal.md → Specialists).
 */
export function cargoSpeed(
  kinds: readonly SpecialistKind[],
  opts: { toOwnOutpost?: boolean; ownerHasAdmiral?: boolean } = {},
): number {
  let speed = 1;
  for (const kind of kinds) {
    if (kind === 'helmsman') speed = Math.max(speed, HELMSMAN_SPEED);
    else if (kind === 'lieutenant' || kind === 'general' || kind === 'admiral') {
      speed = Math.max(speed, OFFICER_SPEED);
    }
  }
  // The Admiral speeds up subs carrying no specialist at all.
  if (kinds.length === 0 && opts.ownerHasAdmiral) speed = Math.max(speed, ADMIRAL_GLOBAL_SPEED);
  return speed;
}

/** The speed a sub in flight is travelling at. */
export function speedOf(state: GameState, sub: Sub): number {
  return speedFor(state, {
    owner: sub.owner,
    cargo: state.specialists.filter((s) => sub.specialists.includes(s.id)),
    to: sub.to,
  });
}

/** The speed of a trip about to be made, given its cargo and destination. */
export function speedFor(state: GameState, opts: { owner: PlayerId; cargo: readonly Specialist[]; to: string }): number {
  const kinds = opts.cargo.filter(isFree).map((s) => s.kind);
  const target = state.outposts.find((o) => o.id === opts.to);
  const admiral = state.specialists.some((s) => owns(s, opts.owner, 'admiral'));
  return cargoSpeed(kinds, { toOwnOutpost: target?.owner === opts.owner, ownerHasAdmiral: admiral });
}

// --- Shields --------------------------------------------------------------

/**
 * The maximum shield an outpost reaches: its own max plus the specialists
 * standing there and those affecting their owner everywhere. Bonuses add up;
 * the King is the exception — he takes 20 off everywhere but adds it back at
 * his own outpost, and only one of him exists. Never below 0.
 */
export function shieldMaxAt(state: GameState, outpost: Outpost): number {
  const here = (spec: Specialist) => outpostOfSpec(spec) === outpost.id;
  let max = outpost.shieldMax;
  if (state.specialists.some((s) => owns(s, outpost.owner!, 'queen') && here(s))) max += QUEEN_SHIELD_BONUS;
  if (state.specialists.some((s) => owns(s, outpost.owner!, 'securityChief'))) {
    max += SECURITY_CHIEF_SHIELD_BONUS + (state.specialists.some((s) => owns(s, outpost.owner!, 'securityChief') && here(s)) ? SECURITY_CHIEF_SHIELD_BONUS : 0);
  }
  // Several Kings can exist (3 Hypnotists per deck): the shield is off
  // everywhere except where one of them stands.
  const kings = state.specialists.filter((s) => owns(s, outpost.owner!, 'king'));
  if (kings.length > 0) max += kings.some(here) ? -KING_SHIELD_DELTA : KING_SHIELD_DELTA;
  return Math.max(0, max);
}

// --- Sonar ----------------------------------------------------------------

/**
 * Sonar range in map units around one outpost. The Princess adds 50% where
 * she is, the Intelligence Officer 25% everywhere; the two multiply.
 */
export function sonarRangeAt(state: GameState, outpost: Outpost): number {
  let range = SONAR_RANGE;
  if (outpost.owner === null) return range;
  if (state.specialists.some((s) => owns(s, outpost.owner!, 'princess') && outpostOfSpec(s) === outpost.id)) {
    range *= PRINCESS_SONAR_MULTIPLIER;
  }
  if (state.specialists.some((s) => owns(s, outpost.owner!, 'intelOfficer'))) {
    range *= INTEL_OFFICER_SONAR_MULTIPLIER;
  }
  return range;
}

/** Whether an Intelligence Officer anywhere makes every outpost's type known. */
export function revealsOutpostTypes(state: GameState, player: PlayerId): boolean {
  return state.specialists.some((s) => owns(s, player, 'intelOfficer'));
}

// --- Production -----------------------------------------------------------

/**
 * Extra drillers one factory makes per cycle. A Foreman adds hers to every
 * factory within half a sonar of her own outpost.
 */
export function productionBonusAt(state: GameState, outpost: Outpost): number {
  if (outpost.owner === null) return 0;
  const foremen = state.specialists.filter(
    (s) => owns(s, outpost.owner!, 'foreman') && outpostOfSpec(s) !== null,
  );
  if (foremen.length === 0) return 0;
  const radius = SONAR_RANGE * FOREMAN_RADIUS_SHARE;
  return foremen.some((s) => {
    const home = state.outposts.find((o) => o.id === outpostOfSpec(s));
    return home !== undefined && distance(home.position, outpost.position) <= radius;
  })
    ? FOREMAN_DRILLERS_PER_CYCLE
    : 0;
}

// --- Combat ---------------------------------------------------------------

/** One side of a fight, with the specialists that take part in it. */
export interface CombatFighter {
  owner: PlayerId;
  drillers: number;
  /** Free specialists at the location (not yet removed by the phase). */
  specialists: Specialist[];
}

export interface SpecialistPhaseResult {
  /** One line per effect, for the battle summary. */
  notes: string[];
}

/**
 * The specialist phase of combat: every free specialist with a priority acts
 * in priority order, lowest first (goal.md → Combat). Equal priorities act
 * together: a tier reads the numbers as they were when it started, then all
 * of its effects apply at once. Returns the notes to show; mutates the two
 * sides.
 *
 * `atOutpost`: the defender is an outpost. A Thief only steals when
 * attacking an outpost or in sub-vs-sub combat, so a defending one is idle.
 *
 * Later batches extend this with effects that reach outside the two sides
 * (Assassin, Saboteur, Martyr); the arithmetic core in `combat.ts` is
 * unchanged.
 */
export function runSpecialistPhase(
  attacker: CombatFighter,
  defender: CombatFighter,
  opts: { atOutpost: boolean },
): SpecialistPhaseResult {
  const notes: string[] = [];
  const tiers = new Map<number, Specialist[]>();
  for (const spec of [...attacker.specialists, ...defender.specialists]) {
    if (!isFree(spec)) continue;
    const priority = SPECIALISTS[spec.kind].priority;
    if (priority === undefined) continue;
    const tier = tiers.get(priority) ?? [];
    tier.push(spec);
    tiers.set(priority, tier);
  }
  for (const priority of [...tiers.keys()].sort((a, b) => a - b)) {
    // Gains and losses per side, all read from the numbers at the tier start.
    const start = new Map([
      [attacker, attacker.drillers],
      [defender, defender.drillers],
    ]);
    const lost = new Map([
      [attacker, 0],
      [defender, 0],
    ]);
    const gained = new Map([
      [attacker, 0],
      [defender, 0],
    ]);
    for (const spec of tiers.get(priority)!) {
      const side = attacker.specialists.includes(spec) ? attacker : defender;
      const enemy = side === attacker ? defender : attacker;
      switch (spec.kind) {
        case 'thief': {
          if (opts.atOutpost && side === defender) break;
          const stolen = Math.ceil(start.get(enemy)! * THIEF_DRILLER_SHARE);
          if (stolen > 0) {
            lost.set(enemy, lost.get(enemy)! + stolen);
            gained.set(side, gained.get(side)! + stolen);
            notes.push(`${specialistName(spec.kind)} stole ${stolen} drillers`);
          }
          break;
        }
        case 'lieutenant': {
          const destroyed = Math.min(start.get(enemy)!, LIEUTENANT_DRILLERS_DESTROYED);
          if (destroyed > 0) {
            lost.set(enemy, lost.get(enemy)! + destroyed);
            notes.push(`${specialistName(spec.kind)} destroyed ${destroyed} drillers`);
          }
          break;
        }
        default:
          // No other kind acts in the specialist phase yet.
          break;
      }
    }
    for (const side of [attacker, defender]) {
      side.drillers = Math.max(0, start.get(side)! - lost.get(side)!) + gained.get(side)!;
    }
  }
  return { notes };
}

/**
 * Enemy drillers destroyed by global specialists *after* the specialist
 * phase (goal.md → General, King).
 *
 * The King destroys 1 for every 4 drillers the side has left in every combat
 * he is in. The General needs no presence, but the rules say "every combat
 * where you have a specialist present", so his side must still have one
 * standing in this fight. Neither effect stacks with itself, and there is
 * only one of each anyway.
 */
export function drillerDestroyedInCombat(state: GameState, fighter: CombatFighter): { drillers: number; notes: string[] } {
  const notes: string[] = [];
  let drillers = 0;
  const standing = fighter.specialists.some(isFree);
  if (standing && state.specialists.some((s) => owns(s, fighter.owner, 'general'))) {
    drillers += GENERAL_DRILLERS_DESTROYED;
    notes.push(`${specialistName('general')} destroyed ${GENERAL_DRILLERS_DESTROYED} drillers`);
  }
  if (state.specialists.some((s) => owns(s, fighter.owner, 'king'))) {
    const royal = Math.floor(fighter.drillers / KING_DRILLERS_PER_ENEMY_DESTROYED);
    if (royal > 0) {
      drillers += royal;
      notes.push(`${specialistName('king')} destroyed ${royal} drillers`);
    }
  }
  return { drillers, notes };
}

/**
 * Drillers an Engineer repairs after a win: a quarter of what you lost in the
 * whole fight (specialist phase included), rounded up, and another quarter
 * where an Engineer was present. `where` is the outpost fought over and/or
 * the winning side's sub (an attacking Engineer rides in it). The caller
 * puts the drillers back.
 */
export function engineerRepair(
  state: GameState,
  player: PlayerId,
  lost: number,
  where: { outpost?: OutpostId; sub?: SubId },
): number {
  if (lost <= 0) return 0;
  const at = (spec: Specialist) =>
    (where.outpost !== undefined && outpostOfSpec(spec) === where.outpost) ||
    (where.sub !== undefined && 'sub' in spec.location && spec.location.sub === where.sub);
  const engineers = state.specialists.filter((s) => owns(s, player, 'engineer'));
  if (engineers.length === 0) return 0;
  const repaired = Math.ceil(lost * ENGINEER_REPAIR_SHARE);
  // Two rounded-up quarters can exceed a tiny loss: never repair more than was lost.
  return Math.min(lost, engineers.some(at) ? 2 * repaired : repaired);
}