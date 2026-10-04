import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, form, max, min, submit } from '@angular/forms/signals';
import type { LaunchOrder, OrderInput, PendingOrder, PlayerView } from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { describeOrder, namesFor } from '../describe';
import { formatDuration, formatGameTime } from '../format';
import { travelMinutes } from '../geometry';
import { PredictionLine } from '../prediction-line';

/**
 * One of your pending orders: when it runs, Cancel, and (for launches) Edit.
 * The server has no "edit", so editing cancels the order and issues a new one
 * at the same time; if that time is no longer allowed, it's sent for the
 * earliest possible time instead and the player is told.
 */
@Component({
  selector: 'sub-order-panel',
  imports: [FormField, PredictionLine],
  styleUrl: '../panel.css',
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    form p {
      margin: 0 0 8px;
    }
  `,
  template: `
    <section class="card" aria-labelledby="order-title">
      <h2 id="order-title">Pending order</h2>
      <p>{{ text() }}</p>
      <dl>
        <dt>Runs</dt>
        <dd>{{ wait() > 0 ? 'in ' + waitText() + ' · ' : '' }}{{ atText() }}</dd>
        @if (launch(); as l) {
          <dt>Arrives</dt>
          <dd>{{ arrivalText() }}</dd>
        }
      </dl>
      @if (launch()) {
        <sub-prediction-line [key]="'order:' + pending().id" [you]="view().you" />
      }

      @if (editing() && launch(); as l) {
        <form (submit)="save($event)" novalidate>
          <p>
            To <strong>{{ names().outpost(targetId()) }}</strong>
            @if (retargeting()) {
              <span class="muted">· click a new target on the map</span>
            }
          </p>
          <div class="actions">
            @if (retargeting()) {
              <button type="button" (click)="retargetCancel.emit()">Keep target</button>
            } @else {
              <button type="button" (click)="retarget.emit(l.from)">Change target…</button>
            }
          </div>
          <label for="edit-drillers">Drillers (max {{ available() }})</label>
          <input
            id="edit-drillers"
            type="number"
            inputmode="numeric"
            [formField]="editForm.drillers"
            [attr.aria-invalid]="editForm.drillers().invalid()"
            aria-describedby="edit-drillers-error"
          />
          <p id="edit-drillers-error" class="error">{{ editForm.drillers().errors()[0]?.message }}</p>
          <div class="actions">
            <button type="submit" class="primary" [disabled]="busy()">Save</button>
            <button type="button" (click)="stopEditing()">Discard</button>
          </div>
        </form>
      } @else {
        <div class="actions">
          @if (launch()) {
            <button type="button" [disabled]="busy()" (click)="editing.set(true)">Edit…</button>
          }
          <button type="button" [disabled]="busy()" (click)="cancel()">Cancel order</button>
        </div>
      }
      <p class="note" role="status">{{ info() }}</p>
      <p class="error" role="alert">{{ error() }}</p>
    </section>
  `,
})
export class OrderPanel {
  private readonly realtime = inject(Realtime);

  readonly gameId = input.required<string>();
  readonly view = input.required<PlayerView>();
  readonly pending = input.required<PendingOrder>();
  readonly minute = input.required<number>();
  /** True while the parent is waiting for a new target click on the map. */
  readonly retargeting = input(false);
  readonly newTargetId = input<string | null>(null);

  /** Ask the parent to let the player pick a new target from this origin. */
  readonly retarget = output<string>();
  readonly retargetCancel = output<void>();
  /** The order was re-issued under a new id. */
  readonly replaced = output<string>();
  readonly cancelled = output<void>();

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');

  protected readonly names = computed(() => namesFor(this.view()));
  protected readonly text = computed(() => describeOrder(this.pending().order, this.names()));
  protected readonly wait = computed(() => this.pending().order.at - this.minute());
  protected readonly waitText = computed(() => formatDuration(this.wait()));
  protected readonly atText = computed(() => formatGameTime(this.pending().order.at));
  protected readonly launch = computed(() => {
    const o = this.pending().order;
    return o.kind === 'launch' ? o : undefined;
  });
  protected readonly targetId = computed(() => this.newTargetId() ?? this.launch()?.to ?? '');
  protected readonly arrivalText = computed(() => {
    const l = this.launch();
    const from = this.view().outposts.find((o) => o.id === l?.from);
    const to = this.view().outposts.find((o) => o.id === this.targetId());
    if (!l || !from || !to) return '';
    return formatGameTime(l.at + travelMinutes(from.position, to.position));
  });
  protected readonly available = computed(
    () => this.view().outposts.find((o) => o.id === this.launch()?.from)?.drillers ?? 0,
  );

  /** Edit model; reset whenever a different order is selected. */
  protected readonly editModel = linkedSignal({
    source: () => this.pending().id,
    computation: () => ({ drillers: this.launch()?.drillers ?? 0 }),
  });
  protected readonly editForm = form(this.editModel, (path) => {
    min(path.drillers, 0, { message: 'Cannot be negative.' });
    max(path.drillers, () => Math.max(this.available(), this.launch()?.drillers ?? 0), {
      message: 'Not that many drillers there.',
    });
  });

  protected stopEditing(): void {
    this.editing.set(false);
    this.retargetCancel.emit();
  }

  protected async cancel(): Promise<void> {
    await this.run(async () => {
      await this.realtime.cancelOrder(this.gameId(), this.pending().id);
      this.cancelled.emit();
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    const old = this.launch();
    if (!old) return;
    void submit(this.editForm, async () => {
      const order = launchInput(old, this.targetId(), this.editModel().drillers);
      await this.run(async () => {
        await this.realtime.cancelOrder(this.gameId(), this.pending().id);
        let issued;
        try {
          issued = await this.realtime.issueOrder({ gameId: this.gameId(), order, at: old.at });
        } catch {
          // The original time may have passed or be too soon now.
          try {
            issued = await this.realtime.issueOrder({ gameId: this.gameId(), order });
            this.info.set(`The original launch time had passed; it now launches at ${formatGameTime(issued.order.at)}.`);
          } catch (err) {
            throw new Error(`The old order was cancelled, but the new one was refused: ${messageOf(err)}`);
          }
        }
        this.editing.set(false);
        this.replaced.emit(issued.id);
      });
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.error.set(messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }
}

/** The edited launch as an order input (no `at`/`player`; the server sets those). */
function launchInput(order: LaunchOrder, to: string, drillers: number): OrderInput {
  return {
    kind: 'launch',
    from: order.from,
    to,
    drillers,
    specialists: order.specialists,
    ...(order.isGift ? { isGift: true } : {}),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
