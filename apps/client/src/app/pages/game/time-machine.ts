import { DestroyRef, Service, computed, inject, signal, type Signal } from '@angular/core';
import {
  advance,
  predictArrivals,
  stateFromView,
  UNKNOWN_PLAYER,
  validateOrder,
  viewFor,
  type ArrivalPrediction,
  type GameSnapshot,
  type GameState,
  type Order,
  type OrderInput,
  type PendingOrder,
  type PlayerView,
} from '@subterfuge/engine';
import { PLAY_RATE, outcomeFor, scheduledAt, scrubHorizon, tickOf, type YourOutcome } from './time-math';

/** A predicted fight (or arrival) and which sub/order it belongs to. */
export interface Prediction extends ArrivalPrediction {
  /** Selection id: `sub:<id>` or `order:<pendingOrderId>`. */
  key: string;
  /** Pending order id, for predictions of launches that haven't happened. */
  pendingId?: string;
  yours: YourOutcome;
}

/**
 * The time machine (goal.md → Time machine), one per game screen: scrub into
 * a simulated future built only from what you can see, watch it play out,
 * schedule orders at that time, and see predicted fights.
 *
 * The forecast is advanced incrementally from the last computed tick while
 * scrubbing forward (cheap), and rebuilt from the live view when the view or
 * your orders change, or when scrubbing backwards.
 */
@Service({ autoProvided: false })
export class TimeMachine {
  private snapshot: Signal<GameSnapshot | null> = signal(null);
  private liveMinute: Signal<number> = signal(0);

  /** Scrubbed game minute (fractional), or `null` when showing "now". */
  readonly scrub = signal<number | null>(null);
  readonly playing = signal(false);
  readonly active = computed(() => this.scrub() !== null);

  /** The minute the map should show: scrubbed, or live. */
  readonly displayMinute = computed(() => this.scrub() ?? this.liveMinute());

  private readonly orders = computed<Order[]>(() => this.snapshot()?.pendingOrders.map((p) => p.order) ?? []);

  /** Forecast state at the scrubbed tick, or `null` when live. */
  readonly forecastState = computed<GameState | null>(() => {
    const snap = this.snapshot();
    const scrub = this.scrub();
    if (!snap || scrub === null) return null;
    return this.stateAt(snap, this.orders(), Math.max(snap.view.time, tickOf(scrub)));
  });

  /** What the map and panels show: the live view, or the forecast seen by you. */
  readonly view = computed<PlayerView | null>(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    const state = this.forecastState();
    return state ? maskUnknown(viewFor(state, snap.view.you)) : snap.view;
  });

  /** Your pending orders that haven't executed by the displayed time. */
  readonly pending = computed<PendingOrder[]>(() => {
    const snap = this.snapshot();
    if (!snap) return [];
    const scrub = this.scrub();
    if (scrub === null) return snap.pendingOrders;
    const t = tickOf(scrub);
    return snap.pendingOrders.filter((p) => p.order.at > t);
  });

  /** Predicted fights and arrivals for every visible sub and pending launch. */
  readonly predictions = computed<Prediction[]>(() => {
    const snap = this.snapshot();
    if (!snap) return [];
    const you = snap.view.you;
    return predictArrivals(snap.view, this.orders()).map((p) => {
      const pendingId = p.order === undefined ? undefined : snap.pendingOrders[p.order]?.id;
      const key = p.sub !== undefined ? `sub:${p.sub}` : `order:${pendingId}`;
      return { ...p, key, ...(pendingId ? { pendingId } : {}), yours: outcomeFor(p, you) };
    });
  });

  readonly horizon = computed(() => scrubHorizon(this.liveMinute(), this.predictions()));

  private cache: { snapshot: GameSnapshot; orders: Order[]; time: number; state: GameState } | null = null;
  private frame = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  /** Called once by the game page with its live data. */
  bind(snapshot: Signal<GameSnapshot | null>, liveMinute: Signal<number>): void {
    this.snapshot = snapshot;
    this.liveMinute = liveMinute;
  }

  prediction(key: string): Prediction | undefined {
    return this.predictions().find((p) => p.key === key);
  }

  jumpTo(minute: number): void {
    this.pause();
    this.scrub.set(Math.min(Math.max(minute, this.liveMinute()), this.horizon()));
  }

  step(minutes: number): void {
    this.jumpTo((this.scrub() ?? this.liveMinute()) + minutes);
  }

  backToNow(): void {
    this.pause();
    this.scrub.set(null);
  }

  togglePlay(): void {
    if (this.playing()) return this.pause();
    if (this.scrub() === null || this.scrub()! >= this.horizon()) this.scrub.set(this.liveMinute());
    this.playing.set(true);
    let last = performance.now();
    const tick = (now: number) => {
      const next = (this.scrub() ?? this.liveMinute()) + ((now - last) / 1000) * PLAY_RATE;
      last = now;
      if (next >= this.horizon()) {
        this.scrub.set(this.horizon());
        this.playing.set(false);
        return;
      }
      this.scrub.set(next);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  pause(): void {
    cancelAnimationFrame(this.frame);
    this.playing.set(false);
  }

  /** `at` for an order issued now: the scrubbed time, or undefined for "as soon as possible". */
  scheduleFor(order: OrderInput): number | undefined {
    const scrub = this.scrub();
    if (scrub === null) return undefined;
    return scheduledAt(scrub, this.liveMinute(), order.kind === 'launch');
  }

  /**
   * Checks an order against the forecast at the time it would run, so you see
   * problems before scheduling it. `null` when fine or when live (the server
   * checks immediate orders itself).
   */
  validateScheduled(order: OrderInput): string | null {
    const snap = this.snapshot();
    const at = this.scheduleFor(order);
    if (!snap || at === undefined) return null;
    // The state the order will run on: the end of the tick before it, which
    // is the state on screen (see scheduledAt).
    const state = this.stateAt(snap, this.orders(), Math.max(snap.view.time, at - 10));
    return validateOrder(state, { ...order, at, player: snap.view.you } as Order);
  }

  /** Prediction for a launch being composed (not yet sent). */
  predictDraft(order: OrderInput & { kind: 'launch' }, at: number): ArrivalPrediction | undefined {
    const snap = this.snapshot();
    if (!snap) return undefined;
    const draft = { ...order, at, player: snap.view.you } as Order;
    const orders = [...this.orders(), draft];
    return predictArrivals(snap.view, orders).find((p) => p.order === orders.length - 1);
  }

  private stateAt(snapshot: GameSnapshot, orders: Order[], time: number): GameState {
    const c = this.cache;
    if (c && c.snapshot === snapshot && c.orders === orders && c.time <= time) {
      if (c.time === time) return c.state;
      const state = advance(c.state, orders, time).state;
      this.cache = { snapshot, orders, time, state };
      return state;
    }
    const state = advance(stateFromView(snapshot.view), orders, time).state;
    this.cache = { snapshot, orders, time, state };
    return state;
  }
}

/**
 * Forecasts own hidden outposts through a placeholder player; show those as
 * plain hidden outposts again and drop the placeholder from the player list.
 */
export function maskUnknown(view: PlayerView): PlayerView {
  return {
    ...view,
    players: view.players.filter((p) => p.id !== UNKNOWN_PLAYER),
    outposts: view.outposts.map((o) => {
      if (o.owner !== UNKNOWN_PLAYER) return o;
      // Hidden then and hidden in the forecast: position, name and (for mines) type only.
      return { id: o.id, name: o.name, position: o.position, visible: false, ...(o.type === 'mine' ? { type: o.type } : {}) };
    }),
  };
}
