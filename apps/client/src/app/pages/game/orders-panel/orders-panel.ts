import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { PendingOrder, PlayerView } from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { describePending, namesFor } from '../describe';
import { isSelected, type Selection } from '../selection';

/** Your orders that haven't executed yet: select one to see or edit it on the map, or cancel it. */
@Component({
  selector: 'sub-orders-panel',
  template: `
    <section class="card" aria-labelledby="orders-title">
      <h2 id="orders-title">Pending orders</h2>
      <ul>
        @for (p of items(); track p.id) {
          <li>
            <button type="button" class="item" [attr.aria-pressed]="p.selected" (click)="select.emit(p.id)">
              {{ p.text }}
            </button>
            <button type="button" [disabled]="busy()" (click)="cancel(p.id)" [attr.aria-label]="'Cancel: ' + p.text">
              Cancel
            </button>
          </li>
        } @empty {
          <li class="muted">No pending orders.</li>
        }
      </ul>
      <p class="error" role="alert">{{ error() }}</p>
    </section>
  `,
  styles: `
    h2 {
      margin: 0 0 8px;
      font-size: 1rem;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }
    li button {
      flex: none;
      padding: 4px 10px;
    }
    li button.item {
      flex: 1;
      text-align: left;
      background: none;
      border-color: transparent;
    }
    li button.item[aria-pressed='true'] {
      border-color: var(--accent);
    }
    .muted {
      color: var(--muted);
    }
    .error {
      min-height: 1.2em;
      margin: 4px 0 0;
      color: var(--danger);
    }
  `,
})
export class OrdersPanel {
  private readonly realtime = inject(Realtime);

  readonly gameId = input.required<string>();
  readonly view = input.required<PlayerView>();
  readonly pending = input.required<PendingOrder[]>();
  readonly minute = input.required<number>();
  readonly selection = input<Selection | null>(null);
  /** An order was chosen (its id). */
  readonly select = output<string>();

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly items = computed(() => {
    const names = namesFor(this.view());
    return this.pending().map((p) => ({
      id: p.id,
      text: describePending(p, names, this.minute()),
      selected: isSelected(this.selection(), 'order', p.id),
    }));
  });

  protected async cancel(orderId: string): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.realtime.cancelOrder(this.gameId(), orderId);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      this.busy.set(false);
    }
  }
}
