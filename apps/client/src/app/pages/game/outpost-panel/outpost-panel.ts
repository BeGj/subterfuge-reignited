import { Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { FormField, form, max, min, submit } from '@angular/forms/signals';
import { mineDrillCost, type OrderInput, type OutpostView, type PlayerView } from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { namesFor } from '../describe';
import { formatDuration, formatGameTime, plannedTripLabel } from '../format';
import { travelMinutes } from '../geometry';
import { estimatedLaunchAt } from '../overlays';
import { TimeMachine } from '../time-machine';
import { outcomeFor, outcomeSummary } from '../time-math';

const TYPE_LABELS: Record<string, string> = { factory: 'Factory', generator: 'Generator', mine: 'Mine' };

/**
 * Details of the selected outpost, plus actions when it's yours: launch a
 * sub (target picked on the map), drill a mine, toggle the shield.
 */
@Component({
  selector: 'sub-outpost-panel',
  imports: [FormField],
  templateUrl: './outpost-panel.html',
  styleUrl: './outpost-panel.css',
})
export class OutpostPanel {
  private readonly realtime = inject(Realtime);
  protected readonly tm = inject(TimeMachine);

  readonly gameId = input.required<string>();
  readonly view = input.required<PlayerView>();
  readonly outpost = input.required<OutpostView>();
  /** Current game minute (fractional), for ETAs. */
  readonly minute = input.required<number>();
  /** Target chosen on the map while launching. */
  readonly launchTargetId = input<string | null>(null);
  readonly launching = input(false);

  readonly launchStart = output<void>();
  readonly launchCancel = output<void>();
  /** A sub in the "incoming" list was chosen. */
  readonly selectSub = output<string>();

  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly names = computed(() => namesFor(this.view()));
  protected readonly isMine = computed(() => this.outpost().owner === this.view().you);
  protected readonly typeLabel = computed(() => TYPE_LABELS[this.outpost().type ?? ''] ?? 'Unknown');
  protected readonly ownerLabel = computed(() => {
    const owner = this.outpost().owner;
    if (owner === undefined) return 'Unknown (outside sonar)';
    if (owner === null) return 'Dormant';
    return this.names().player(owner);
  });

  protected readonly specialistsHere = computed(() =>
    this.view().specialists.filter((s) => 'outpost' in s.location && s.location.outpost === this.outpost().id),
  );

  /** Your specialists here that can board a sub. */
  private readonly boardable = computed(() =>
    this.specialistsHere().filter((s) => s.owner === this.view().you && s.captiveOf === null),
  );

  protected readonly drillCost = computed(() => {
    const me = this.view().players.find((p) => p.id === this.view().you);
    return mineDrillCost(me?.minesDrilled ?? 0);
  });
  protected readonly canDrill = computed(() => {
    const o = this.outpost();
    return this.isMine() && o.type !== 'mine' && (o.drillers ?? 0) >= this.drillCost();
  });

  protected readonly target = computed(() => this.view().outposts.find((o) => o.id === this.launchTargetId()));
  /** When a launch sent now would leave: the scrubbed time, or after the launch delay. */
  private readonly launchAt = computed(() => {
    const target = this.target();
    const scheduled = target
      ? this.tm.scheduleFor({ kind: 'launch', from: this.outpost().id, to: target.id, drillers: 0, specialists: [] })
      : undefined;
    return scheduled ?? estimatedLaunchAt(this.minute());
  });
  /** "travel 11h 40m · arrives ~Day 2, 03:40" (see plannedTripLabel). */
  protected readonly travel = computed(() => {
    const target = this.target();
    if (!target) return '';
    const travel = travelMinutes(this.outpost().position, target.position);
    return plannedTripLabel(travel, this.launchAt() + travel);
  });
  /** Shown while scrubbed into the future: orders become scheduled. */
  protected readonly scheduledLabel = computed(() => (this.tm.active() ? formatGameTime(this.launchAt()) : ''));

  /** Live prediction for the launch being composed. */
  protected readonly draft = computed(() => {
    const target = this.target();
    if (!target) return null;
    const { drillers, specialists } = this.launchModel();
    const chosen = specialists.filter((s) => s.selected).map((s) => s.id);
    if (drillers <= 0 && chosen.length === 0) return null;
    const prediction = this.tm.predictDraft(
      { kind: 'launch', from: this.outpost().id, to: target.id, drillers, specialists: chosen },
      this.launchAt(),
    );
    if (!prediction) return null;
    const you = this.view().you;
    return { outcome: outcomeFor(prediction, you), text: outcomeSummary(prediction, you) };
  });

  /** Subs you can see heading here (yours and others'), soonest first. */
  protected readonly incoming = computed(() => {
    const names = this.names();
    return this.view()
      .subs.filter((s) => s.to === this.outpost().id)
      .sort((a, b) => a.arrivesAt - b.arrivesAt)
      .map((s) => ({
        id: s.id,
        text: `${names.player(s.owner)}: ${s.drillers} drillers${s.specialists.length ? ` + ${s.specialists.length} specialist(s)` : ''}`,
        eta: `${formatDuration(s.arrivesAt - this.minute())} · ${formatGameTime(s.arrivesAt)}`,
        mine: s.owner === this.view().you,
      }));
  });

  /** Enemy launches about to leave for this outpost (still cancellable by them). */
  protected readonly enemyLaunches = computed(() => {
    const names = this.names();
    return this.tm
      .imminentLaunches()
      .filter((o) => o.to === this.outpost().id)
      .map((o) => ({
        key: `${o.player}:${o.from}:${o.at}`,
        text: `${names.player(o.player)}: ${o.drillers} drillers from ${names.outpost(o.from)}`,
        when: `launches in ${formatDuration(Math.max(0, o.at - this.minute()))}`,
      }));
  });

  /**
   * Launch form. Resets only when a different outpost is selected or the
   * specialists there change — not on every server update, which would wipe
   * what the player typed. The `max` validator tracks the live driller count.
   */
  protected readonly launchModel = linkedSignal({
    source: () => `${this.outpost().id}|${this.boardable().map((s) => s.id).join(',')}`,
    computation: () => ({
      drillers: untracked(() => this.outpost().drillers ?? 0),
      specialists: untracked(() => this.boardable()).map((s) => ({
        id: s.id,
        label: s.kind === 'queen' ? 'Queen' : s.kind,
        selected: false,
      })),
    }),
  });
  protected readonly launchForm = form(this.launchModel, (path) => {
    min(path.drillers, 0, { message: 'Cannot be negative.' });
    max(path.drillers, () => this.outpost().drillers ?? 0, { message: 'Not that many drillers here.' });
  });

  protected specialistName(kind: string, owner: string): string {
    return `${kind === 'queen' ? 'Queen' : kind} (${this.names().player(owner)})`;
  }

  protected onLaunch(event: Event): void {
    event.preventDefault();
    const target = this.target();
    if (!target) return;
    void submit(this.launchForm, async () => {
      const { drillers, specialists } = this.launchModel();
      const chosen = specialists.filter((s) => s.selected).map((s) => s.id);
      if (drillers === 0 && chosen.length === 0) {
        this.error.set('Send at least one driller or specialist.');
        return;
      }
      const ok = await this.send({ kind: 'launch', from: this.outpost().id, to: target.id, drillers, specialists: chosen });
      if (ok) this.launchCancel.emit();
    });
  }

  protected drill(): Promise<boolean> {
    return this.send({ kind: 'drillMine', outpost: this.outpost().id });
  }

  protected toggleShield(): Promise<boolean> {
    return this.send({ kind: 'setShield', outpost: this.outpost().id, enabled: !(this.outpost().shieldEnabled ?? true) });
  }

  private async send(order: OrderInput): Promise<boolean> {
    this.error.set('');
    // While scrubbed, the order is scheduled for that time; check it against
    // the forecast first (the server only checks scheduled orders when they run).
    const problem = this.tm.validateScheduled(order);
    if (problem) {
      this.error.set(`At that time: ${problem}`);
      return false;
    }
    const at = this.tm.scheduleFor(order);
    this.busy.set(true);
    try {
      await this.realtime.issueOrder({ gameId: this.gameId(), order, ...(at === undefined ? {} : { at }) });
      return true;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Order failed.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
