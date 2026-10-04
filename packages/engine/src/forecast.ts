import { NEPTUNIUM_UNIT, SUB_SPEED, TICK } from './constants.js';
import { distance } from './geometry.js';
import { progressForCharge } from './shield.js';
import { advance } from './simulation.js';
import type {
  CombatDetails,
  GameEvent,
  GameState,
  GameTime,
  Order,
  OutpostId,
  PlayerId,
  PlayerView,
  SubId,
} from './types.js';

/*
 * The time machine's "simulated future" (goal.md → Time machine): run the
 * engine forward from what ONE player can see, plus that player's own pending
 * orders. Like the original game, it only knows what you know: enemy plans,
 * subs outside your sonar and the contents of hidden outposts are unknown, so
 * a forecast is a best guess, not a promise.
 *
 * Hidden outposts are owned by a placeholder player (`UNKNOWN_PLAYER`) with no
 * drillers or shield, so they never produce, mine or win. Predictions that
 * involve them are reported as `unknown` instead of a win/loss.
 */

export const UNKNOWN_PLAYER: PlayerId = '?';

/** Id counter for forecast-only subs, far above anything a real game reaches. */
const FORECAST_ID_BASE = 1_000_000_000;

/**
 * Builds a simulatable state from a player's view. Approximations: shield
 * charge is whole units (fractional progress isn't sent to clients), and
 * hidden outposts are empty placeholders.
 */
export function stateFromView(view: PlayerView): GameState {
  const hidden = new Set<OutpostId>();
  const outposts = view.outposts.map((o) => {
    if (!o.visible) hidden.add(o.id);
    return {
      id: o.id,
      name: o.name,
      // Mines are public; unknown types are treated as generators (they
      // produce nothing and only matter through the electrical cap of their
      // unknown owner).
      type: o.type ?? 'generator',
      position: { ...o.position },
      owner: o.visible ? (o.owner ?? null) : UNKNOWN_PLAYER,
      drillers: o.visible ? (o.drillers ?? 0) : 0,
      shieldMax: o.shieldMax ?? 0,
      shieldProgress: progressForCharge(o.visible ? (o.shieldCharge ?? 0) : 0),
      shieldEnabled: o.shieldEnabled ?? true,
    };
  });

  const players = view.players.map((p) => ({
    id: p.id,
    name: p.name,
    neptunium: p.neptunium,
    minesDrilled: p.minesDrilled,
    eliminated: p.eliminated,
  }));
  // Marked eliminated so the placeholder never mines, wins or blocks a win;
  // its outposts still defend themselves in combat.
  players.push({ id: UNKNOWN_PLAYER, name: 'Unknown', neptunium: 0, minesDrilled: 0, eliminated: true });

  return {
    time: view.time,
    seed: 0,
    width: view.width,
    height: view.height,
    players,
    outposts,
    subs: structuredClone(view.subs),
    specialists: structuredClone(view.specialists),
    nextId: FORECAST_ID_BASE,
    winner: view.winner,
    endedAt: view.endedAt,
    endVotes: [...(view.endVotes ?? [])],
  };
}

/** Simulates a player's view forward to `until` with their pending orders. */
export function forecast(view: PlayerView, orders: readonly Order[], until: GameTime) {
  return advance(stateFromView(view), orders, Math.max(view.time, until));
}

export type PredictedOutcome =
  /** Combat we expect to win (outpost captured or held, or enemy sub beaten). */
  | 'win'
  /** Combat we expect to lose. */
  | 'lose'
  /** Arrives at our own outpost or a dormant one: no fight. */
  | 'safe'
  /** The target's contents are hidden, so we can't tell. */
  | 'unknown';

export interface ArrivalPrediction {
  /** Real sub id, or `undefined` for a launch that hasn't happened yet. */
  sub?: SubId;
  /** Index into the `orders` passed in, for pending launches. */
  order?: number;
  owner: PlayerId;
  from: OutpostId;
  to: OutpostId;
  /** Game minute of the fight (or the arrival, if there's no fight). */
  at: GameTime;
  /** When the sub leaves (or left) its origin. */
  departsAt: GameTime;
  /** When it would reach its target, fight or not. */
  arrivesAt: GameTime;
  outcome: PredictedOutcome;
  /** Present when a combat is predicted. */
  combat?: { at: GameTime; outpost?: OutpostId; winner: PlayerId | null; details: CombatDetails };
}

/**
 * Predicts what happens to every sub in the view and every pending launch:
 * when it arrives and, if it fights, whether it wins. Simulates once, far
 * enough for everything to arrive. From `player`'s perspective.
 */
export function predictArrivals(view: PlayerView, orders: readonly Order[]): ArrivalPrediction[] {
  const state = stateFromView(view);
  const position = new Map(state.outposts.map((o) => [o.id, o.position]));
  const travel = (from: OutpostId, to: OutpostId) =>
    Math.max(TICK, Math.ceil(distance(position.get(from)!, position.get(to)!) / SUB_SPEED / TICK) * TICK);

  const launches = orders
    .map((order, index) => ({ order, index }))
    .filter((x): x is { order: Extract<Order, { kind: 'launch' }>; index: number } => x.order.kind === 'launch');
  let horizon = view.time;
  for (const s of view.subs) horizon = Math.max(horizon, s.arrivesAt);
  for (const { order } of launches) {
    if (position.has(order.from) && position.has(order.to)) horizon = Math.max(horizon, order.at + travel(order.from, order.to));
  }
  const { events } = advance(state, orders, horizon);

  // Map pending launches to the sub ids the forecast gave them.
  const subForOrder = new Map<number, SubId>();
  const used = new Set<SubId>();
  for (const { order, index } of launches) {
    const launched = events.find(
      (e): e is Extract<GameEvent, { kind: 'subLaunched' }> =>
        e.kind === 'subLaunched' && e.at === order.at && e.from === order.from && e.to === order.to && e.owner === order.player && !used.has(e.sub),
    );
    if (launched) {
      used.add(launched.sub);
      subForOrder.set(index, launched.sub);
    }
  }

  const predict = (subId: SubId, owner: PlayerId, from: OutpostId, to: OutpostId, departsAt: GameTime, arrivesAt: GameTime) => {
    const combat = events.find((e): e is Extract<GameEvent, { kind: 'combat' }> => e.kind === 'combat' && e.subs.includes(subId));
    const target = view.outposts.find((o) => o.id === to);
    let outcome: PredictedOutcome;
    if (combat) {
      const involvesUnknown = combat.players.includes(UNKNOWN_PLAYER);
      outcome = involvesUnknown ? 'unknown' : combat.winner === owner ? 'win' : 'lose';
    } else {
      outcome = target && !target.visible ? 'unknown' : 'safe';
    }
    return {
      owner,
      from,
      to,
      at: combat?.at ?? arrivesAt,
      departsAt,
      arrivesAt,
      outcome,
      ...(combat ? { combat: { at: combat.at, outpost: combat.outpost, winner: combat.winner, details: combat.details } } : {}),
    } satisfies Omit<ArrivalPrediction, 'sub' | 'order'>;
  };

  const out: ArrivalPrediction[] = view.subs.map((s) => ({
    sub: s.id,
    ...predict(s.id, s.owner, s.from, s.to, s.launchedAt, s.arrivesAt),
  }));
  for (const { order, index } of launches) {
    const subId = subForOrder.get(index);
    if (!subId) continue; // the launch would be rejected (e.g. not enough drillers)
    out.push({
      order: index,
      ...predict(subId, order.player, order.from, order.to, order.at, order.at + travel(order.from, order.to)),
    });
  }
  return out;
}

/** Neptunium in kg from stored units (for forecast summaries). */
export function neptuniumKg(units: number): number {
  return units / NEPTUNIUM_UNIT;
}
