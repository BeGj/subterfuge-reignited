import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GameSnapshot } from '@subterfuge/engine';
import { Realtime } from '../../core/realtime';
import { apiErrorMessage } from '../../core/auth';
import { gameMinuteAt, syncClock, type ClockSync } from './clock';
import { formatGameTime, formatSpeed } from './format';
import { EventsPanel } from './events-panel/events-panel';
import { GameMap } from './game-map/game-map';
import { OrdersPanel } from './orders-panel/orders-panel';
import { OutpostPanel } from './outpost-panel/outpost-panel';
import { StatusPanel } from './status-panel/status-panel';

/** The in-game screen: live map plus panels for the selection, orders and status. */
@Component({
  selector: 'sub-game',
  imports: [RouterLink, GameMap, OutpostPanel, StatusPanel, OrdersPanel, EventsPanel],
  templateUrl: './game.html',
  styleUrl: './game.css',
  host: { '(document:keydown.escape)': 'cancelLaunch()' },
})
export class Game {
  protected readonly realtime = inject(Realtime);

  /** Game id from the route (`/games/:id`). */
  readonly id = input.required<string>();

  protected readonly snapshot = signal<GameSnapshot | null>(null);
  protected readonly clock = signal<ClockSync | null>(null);
  protected readonly error = signal('');

  protected readonly selectedId = signal<string | null>(null);
  protected readonly launchFromId = signal<string | null>(null);
  protected readonly launchTargetId = signal<string | null>(null);

  /** Wall clock, ticking once a second for text displays. */
  private readonly now = signal(Date.now());

  protected readonly view = computed(() => this.snapshot()?.view);
  protected readonly minute = computed(() => {
    const clock = this.clock();
    return clock ? gameMinuteAt(clock, this.now()) : 0;
  });
  protected readonly timeLabel = computed(() => {
    const view = this.view();
    return formatGameTime(view?.endedAt != null ? view.endedAt : this.minute());
  });
  protected readonly speedLabel = computed(() => formatSpeed(this.clock()?.speed ?? 1));
  protected readonly selected = computed(() => this.view()?.outposts.find((o) => o.id === this.selectedId()));
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
  protected readonly confirmingResign = signal(false);
  protected readonly resignError = signal('');

  constructor() {
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

  protected onMapClick(outpostId: string | null): void {
    const from = this.launchFromId();
    if (from) {
      if (outpostId && outpostId !== from) this.launchTargetId.set(outpostId);
      return;
    }
    this.selectedId.set(outpostId);
  }

  protected selectOutpost(outpostId: string): void {
    this.cancelLaunch();
    this.selectedId.set(outpostId);
  }

  protected startLaunch(): void {
    this.launchFromId.set(this.selectedId());
    this.launchTargetId.set(null);
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

  protected cancelLaunch(): void {
    this.launchFromId.set(null);
    this.launchTargetId.set(null);
  }
}
