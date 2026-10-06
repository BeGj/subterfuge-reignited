import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GameSnapshot } from '@subterfuge/engine';
import { Realtime } from '../../core/realtime';
import { apiErrorMessage } from '../../core/auth';
import { gameMinuteAt, syncClock, type ClockSync } from './clock';
import { formatGameTime, formatSpeed } from './format';
import { EventsPanel } from './events-panel/events-panel';
import { GameMap } from './game-map/game-map';
import { HirePanel } from './hire-panel/hire-panel';
import { OrdersPanel } from './orders-panel/orders-panel';
import { OutpostPanel } from './outpost-panel/outpost-panel';
import { StatusPanel } from './status-panel/status-panel';
import { SubPanel } from './sub-panel/sub-panel';
import { OrderPanel } from './order-panel/order-panel';
import type { Selection } from './selection';
import { BattlePanel } from './battle-panel';
import { battleIcons } from './battle-icons';
import { playerColor } from './colors';
import { formatDuration } from './format';
import type { ImminentLaunch } from './map-renderer';
import { TimeBar } from './time-bar';
import { TimeMachine } from './time-machine';

/** The in-game screen: live map plus panels for the selection, orders and status. */
@Component({
  selector: 'sub-game',
  imports: [RouterLink, GameMap, OutpostPanel, SubPanel, OrderPanel, BattlePanel, StatusPanel, OrdersPanel, EventsPanel, TimeBar, HirePanel],
  templateUrl: './game.html',
  styleUrl: './game.css',
  providers: [TimeMachine],
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class Game {
  protected readonly realtime = inject(Realtime);
  protected readonly tm = inject(TimeMachine);

  /** Game id from the route (`/games/:id`). */
  readonly id = input.required<string>();

  protected readonly snapshot = signal<GameSnapshot | null>(null);
  protected readonly clock = signal<ClockSync | null>(null);
  protected readonly error = signal('');

  protected readonly selection = signal<Selection | null>(null);
  protected readonly launchFromId = signal<string | null>(null);
  /** The planned launch's speed (its cargo), reported by the outpost panel. */
  protected readonly launchSpeed = signal(1);
  protected readonly launchTargetId = signal<string | null>(null);
  /** Set while a pending launch's target is being re-picked on the map. */
  protected readonly editingOrderId = signal<string | null>(null);
  /** Set while a sub's new destination is being picked on the map. */
  protected readonly redirectSubId = signal<string | null>(null);
  protected readonly redirectError = signal('');

  /** Wall clock, ticking once a second for text displays. */
  private readonly now = signal(Date.now());

  /** Live game minute (fractional). */
  protected readonly liveMinute = computed(() => {
    const clock = this.clock();
    return clock ? gameMinuteAt(clock, this.now()) : 0;
  });
  /** What everything shows: the live view, or the time machine's forecast. */
  protected readonly view = computed(() => this.tm.view() ?? undefined);
  /** Game minute being shown (live or scrubbed), for ETAs and countdowns. */
  protected readonly minute = computed(() => this.tm.displayMinute());
  protected readonly timeLabel = computed(() => {
    const view = this.snapshot()?.view;
    if (view?.endedAt != null) return formatGameTime(view.endedAt);
    return formatGameTime(this.liveMinute());
  });
  /** Enemy launches about to happen, as warning routes (live view only). */
  protected readonly imminent = computed<ImminentLaunch[]>(() => {
    const snap = this.snapshot();
    if (!snap || this.tm.active()) return [];
    const pos = new Map(snap.view.outposts.map((o) => [o.id, o.position]));
    const minute = this.liveMinute();
    return snap.imminentLaunches.flatMap((o) => {
      const from = pos.get(o.from);
      const to = pos.get(o.to);
      if (!from || !to) return [];
      const wait = Math.max(0, o.at - minute);
      return [{ from, to, color: playerColor(snap.view, o.player), text: `⚠ ${o.drillers} · ${formatDuration(wait)}` }];
    });
  });
  /** Predicted fights still ahead of the displayed time, as map icons. */
  protected readonly battles = computed(() => {
    const view = this.snapshot()?.view;
    if (!view) return [];
    const shown = this.tm.displayMinute();
    return battleIcons(view, this.tm.predictions().filter((p) => p.at >= shown));
  });
  /** Scheduled launch time while scrubbed (undefined = after the launch delay). */
  protected readonly plannedLaunchAt = computed(() =>
    this.tm.scheduleFor({ kind: 'launch', from: '', to: '', drillers: 0, specialists: [] }),
  );
  protected readonly selectedBattle = computed(() => {
    const s = this.selection();
    return s?.kind === 'battle' ? this.tm.prediction(s.id) : undefined;
  });
  protected readonly speedLabel = computed(() => formatSpeed(this.clock()?.speed ?? 1));
  protected readonly selectedOutpostId = computed(() => {
    const s = this.selection();
    return s?.kind === 'outpost' ? s.id : null;
  });
  protected readonly selected = computed(() => this.view()?.outposts.find((o) => o.id === this.selectedOutpostId()));
  protected readonly selectedSub = computed(() => {
    const s = this.selection();
    return s?.kind === 'sub' ? this.view()?.subs.find((x) => x.id === s.id) : undefined;
  });
  protected readonly selectedOrder = computed(() => {
    const s = this.selection();
    return s?.kind === 'order' ? this.tm.pending().find((p) => p.id === s.id) : undefined;
  });
  /** A selection that no longer exists (sub arrived, order executed). */
  protected readonly selectionGone = computed(() => {
    const s = this.selection();
    if (!s) return false;
    switch (s.kind) {
      case 'outpost':
        return !this.selected();
      case 'sub':
        return !this.selectedSub();
      case 'order':
        return !this.selectedOrder();
      case 'battle':
        return !this.selectedBattle();
    }
  });
  protected readonly winnerText = computed(() => {
    const view = this.view();
    if (view?.endedAt == null) return '';
    if (!view.winner) return 'The game ended in a draw.';
    if (view.winner === view.you) return 'You won!';
    return `${view.players.find((p) => p.id === view.winner)?.name ?? 'Someone'} won the game.`;
  });

  /** Whether you can still act: game running and you're not eliminated. */
  protected readonly canResign = computed(() => {
    const view = this.view();
    const me = view?.players.find((p) => p.id === view.you);
    return !!view && view.endedAt == null && !!me && !me.eliminated;
  });
  /** Players still in the game, and who of them agrees to end it. */
  protected readonly endVote = computed(() => {
    const view = this.snapshot()?.view;
    if (!view || view.endedAt != null) return null;
    const alive = view.players.filter((p) => !p.eliminated);
    const agreed = alive.filter((p) => view.endVotes.includes(p.id));
    const youAgree = view.endVotes.includes(view.you);
    const pending = this.snapshot()!.pendingOrders.find((p) => p.order.kind === 'voteEnd');
    return {
      youAgree,
      /** A vote order you sent that hasn't taken effect yet. */
      pending: !!pending,
      text:
        agreed.length === 0
          ? 'Nobody has proposed ending the game.'
          : `${agreed.map((p) => (p.id === view.you ? 'You' : p.name)).join(', ')} ${agreed.length === 1 && !youAgree ? 'wants' : 'want'} to end it (${agreed.length} of ${alive.length}).`,
    };
  });
  protected readonly voteError = signal('');
  protected readonly confirmingResign = signal(false);
  protected readonly resignError = signal('');

  constructor() {
    this.tm.bind(this.snapshot, this.liveMinute);
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    effect((onCleanup) => {
      const gameId = this.id();
      let unsubscribe: (() => void) | undefined;
      let cancelled = false;
      this.error.set('');
      this.realtime
        .watchGame(gameId, (snapshot) => {
          this.snapshot.set(snapshot);
          this.clock.set(syncClock(snapshot.clock, Date.now()));
        })
        .then(
          (unsub) => (cancelled ? unsub() : (unsubscribe = unsub)),
          (err: unknown) => this.error.set(err instanceof Error ? err.message : 'Could not open this game.'),
        );
      onCleanup(() => {
        cancelled = true;
        unsubscribe?.();
      });
    });
  }

  protected onMapPick(target: Selection | null): void {
    const redirecting = this.redirectSubId();
    if (redirecting) {
      if (target?.kind === 'outpost') void this.redirectSub(redirecting, target.id);
      return;
    }
    const from = this.launchFromId();
    if (from) {
      // Picking a launch target (new launch, or re-targeting a pending one).
      if (target?.kind === 'outpost' && target.id !== from) this.launchTargetId.set(target.id);
      return;
    }
    this.selection.set(target);
  }

  /** A Navigator's sub is being re-routed: the player picks the new target. */
  protected startRedirect(sub: string): void {
    this.cancelLaunch();
    this.selection.set({ kind: 'sub', id: sub });
    this.redirectSubId.set(sub);
    this.redirectError.set('');
  }

  protected async redirectSub(sub: string, to: string): Promise<void> {
    this.redirectError.set('');
    try {
      await this.realtime.issueOrder({ gameId: this.id(), order: { kind: 'redirect', sub, to } });
      // Done picking: the next map click selects again.
      this.cancelRedirect();
    } catch (err) {
      this.redirectError.set(err instanceof Error ? err.message : apiErrorMessage(err));
    }
  }

  protected select(target: Selection): void {
    this.cancelLaunch();
    this.selection.set(target);
  }

  protected startLaunch(): void {
    this.launchFromId.set(this.selectedOutpostId());
    this.launchTargetId.set(null);
  }

  /** Re-pick the target of a pending launch on the map. */
  protected startRetarget(from: string): void {
    this.launchSpeed.set(1); // the order's own cargo isn't in a launch form
    this.editingOrderId.set(this.selection()?.id ?? null);
    this.launchFromId.set(from);
    this.launchTargetId.set(null);
  }

  /** After an edit the order has a new id (it was cancelled and re-issued). */
  protected orderReplaced(orderId: string): void {
    this.cancelLaunch();
    this.selection.set({ kind: 'order', id: orderId });
  }

  /** Propose ending the game with no winner, or withdraw the proposal. */
  protected async voteEnd(agree: boolean): Promise<void> {
    this.voteError.set('');
    try {
      await this.realtime.issueOrder({ gameId: this.id(), order: { kind: 'voteEnd', agree } });
    } catch (err) {
      this.voteError.set(err instanceof Error ? err.message : apiErrorMessage(err));
    }
  }

  protected async resign(): Promise<void> {
    this.resignError.set('');
    try {
      await this.realtime.issueOrder({ gameId: this.id(), order: { kind: 'resign' } });
      this.confirmingResign.set(false);
    } catch (err) {
      this.resignError.set(err instanceof Error ? err.message : apiErrorMessage(err));
    }
  }

  /** Esc: leave redirect mode, then launch mode, then the forecast. */
  protected onEscape(): void {
    if (this.redirectSubId()) this.cancelRedirect();
    else if (this.launchFromId()) this.cancelLaunch();
    else if (this.tm.active()) this.tm.backToNow();
  }

  protected cancelRedirect(): void {
    this.redirectSubId.set(null);
  }

  protected cancelLaunch(): void {
    this.launchSpeed.set(1);
    this.launchFromId.set(null);
    this.launchTargetId.set(null);
    this.editingOrderId.set(null);
  }
}
