import { FIRST_HIRE_AT, HIRE_DECK_COPIES, HIRE_INTERVAL } from './constants.js';
import { SPECIALIST_CATEGORIES, SPECIALISTS, hireableKinds, outpostOfSpec } from './specialists.js';
import type {
  GameEvent,
  GameState,
  GameTime,
  HireOffer,
  HireOrder,
  Hiring,
  OutpostId,
  PlayerId,
  PromoteOrder,
  SpecialistCategory,
  SpecialistKind,
} from './types.js';

/**
 * Hiring (goal.md → Hiring): the Queen hires her first specialist 4 hours
 * into the game and one more every 18 hours. Each offer holds one card per
 * category, drawn from a deck of 3 copies of every hireable specialist in
 * it. Drawn cards leave the deck whether or not they are taken, a new offer
 * replaces one that was ignored, and hiring needs a free Queen standing on
 * one of your own outposts.
 *
 * The decks live in the game state and are built in `generateMap`, so a
 * replay deals the same cards at the same times.
 */

/** A player's hiring, before any offer has appeared. */
export function inertHiring(): Hiring {
  return {
    nextOfferAt: Number.MAX_SAFE_INTEGER,
    deck: { offensive: [], defensive: [], other: [] },
    offer: null,
  };
}

/**
 * FNV-1a over text, so a player's decks come from its own stream: adding
 * hiring can't shift the map generator's draws (map output stays
 * identical), and one player's cards don't depend on another's.
 */
function seedFor(seed: number, player: PlayerId): number {
  let hash = 0x811c9dc5;
  for (const ch of `${seed}:${player}`) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The starting decks for one player: 3 shuffled copies per category. */
export function buildHiring(seed: number, player: PlayerId): Hiring {
  // A tiny xorshift keeps this self-contained: `createRandom` would do, but
  // the seeds here are derived, so one more layer of mixing costs nothing.
  let state = seedFor(seed, player) || 1;
  const rng = {
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const j = state % (i + 1);
        [items[i], items[j]] = [items[j]!, items[i]!];
      }
      return items;
    },
  };
  const deck = {} as Record<SpecialistCategory, SpecialistKind[]>;
  for (const category of SPECIALIST_CATEGORIES) {
    const cards: SpecialistKind[] = [];
    for (const kind of hireableKinds(category)) {
      for (let copy = 0; copy < HIRE_DECK_COPIES; copy++) cards.push(kind);
    }
    deck[category] = rng.shuffle(cards);
  }
  return { nextOfferAt: FIRST_HIRE_AT, deck, offer: null };
}

/**
 * Draws the offer a player is due at or before `time`. Called once per tick,
 * before orders execute, so a hire can be scheduled for the very tick the
 * offer appears. Returns the events to report.
 */
export function refreshOffers(state: GameState, time: GameTime): GameEvent[] {
  const events: GameEvent[] = [];
  for (const player of state.players) {
    if (player.eliminated) continue;
    const hiring = player.hiring;
    while (hiring.nextOfferAt <= time) {
      const kinds: Partial<Record<SpecialistCategory, SpecialistKind>> = {};
      for (const category of SPECIALIST_CATEGORIES) {
        // Drawn cards leave the deck even if the player picks another one.
        const card = hiring.deck[category].shift();
        if (card !== undefined) kinds[category] = card;
      }
      hiring.offer = { at: hiring.nextOfferAt, kinds };
      events.push({ kind: 'specialistOffered', at: time, player: player.id, offer: structuredClone(hiring.offer) });
      hiring.nextOfferAt += HIRE_INTERVAL;
    }
  }
  return events;
}

/** The player's own outpost their Queen is standing on, or null. */
function queenOutpost(state: GameState, player: PlayerId): OutpostId | null {
  const queen = state.specialists.find(
    (s) => s.kind === 'queen' && s.owner === player && s.captiveOf === null && outpostOfSpec(s) !== null,
  );
  const at = queen ? outpostOfSpec(queen) : null;
  if (at === null) return null;
  const outpost = state.outposts.find((o) => o.id === at);
  return outpost && outpost.owner === player ? at : null;
}

/** Why this hire can't happen, or `null` when it can. */
export function validateHire(state: GameState, order: HireOrder): string | null {
  const player = state.players.find((p) => p.id === order.player);
  if (!player) return 'Unknown player.';
  const offer = player.hiring.offer;
  if (!offer) return 'There is no offer to take right now.';
  const category = SPECIALISTS[order.choice]?.category;
  if (!category || offer.kinds[category] !== order.choice) {
    return 'That specialist is not on offer.';
  }
  if (queenOutpost(state, order.player) === null) {
    return 'Your Queen must be at one of your own outposts to hire.';
  }
  return null;
}

/** Why this promotion can't happen, or `null` when it can. */
export function validatePromote(state: GameState, order: PromoteOrder): string | null {
  const spec = state.specialists.find((s) => s.id === order.specialist);
  if (!spec || spec.owner !== order.player || spec.captiveOf !== null) return 'Invalid specialist.';
  const at = outpostOfSpec(spec);
  if (at === null) return 'The specialist must be at an outpost.';
  if (state.outposts.find((o) => o.id === at)?.owner !== order.player) {
    return 'The specialist must be at one of your own outposts.';
  }
  const to = SPECIALISTS[spec.kind].promotesTo;
  if (!to) return `${SPECIALISTS[spec.kind].name} cannot be promoted.`;
  // Promotion is taken *instead of* a hire (goal.md → Hiring), so it uses up
  // the current offer. The Queen doesn't need to be home for it.
  if (!state.players.find((p) => p.id === order.player)?.hiring.offer) return 'There is no offer to take right now.';
  return null;
}

/** Takes the chosen card: `hireSize` copies arrive at the Queen's outpost. */
export function hire(state: GameState, order: HireOrder, events: GameEvent[]): void {
  const player = state.players.find((p) => p.id === order.player)!;
  const at = queenOutpost(state, order.player)!;
  const size = SPECIALISTS[order.choice].hireSize;
  const kinds: SpecialistKind[] = [];
  for (let i = 0; i < size; i++) {
    const id = `spec-${state.nextId++}`;
    state.specialists.push({ id, kind: order.choice, owner: order.player, location: { outpost: at }, captiveOf: null });
    kinds.push(order.choice);
  }
  player.hiring.offer = null;
  events.push({ kind: 'specialistHired', at: state.time, player: order.player, kinds, outpost: at });
}

/**
 * Promotes in place: the specialist keeps her id, outpost and owner. Like a
 * hire, it takes the offer, and the drawn cards are lost.
 */
export function promote(state: GameState, order: PromoteOrder, events: GameEvent[]): void {
  const spec = state.specialists.find((s) => s.id === order.specialist)!;
  const from = spec.kind;
  const to = SPECIALISTS[from].promotesTo!;
  spec.kind = to;
  state.players.find((p) => p.id === order.player)!.hiring.offer = null;
  events.push({
    kind: 'specialistPromoted',
    at: state.time,
    player: order.player,
    specialist: spec.id,
    from,
    to,
    outpost: outpostOfSpec(spec)!,
  });
}

/** Whether this player can be hired from right now (for the client panel). */
export function canHireFrom(state: GameState, player: PlayerId): boolean {
  return queenOutpost(state, player) !== null;
}