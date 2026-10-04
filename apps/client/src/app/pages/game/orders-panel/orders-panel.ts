import { Component, computed, inject, input, signal } from '@angular/core';
import type { PendingOrder, PlayerView } from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { describePending, namesFor } from '../describe';

/** Your orders that haven't executed yet, with cancel buttons. */
@Component({
  selector: 'sub-orders-panel',
  template: `
    <section class="card" aria-labelledby="orders-title">
      <h2 id="orders-title">Pending orders</h2>
      <ul>
        @for (p of items(); track p.id) {
          <li>
            <span>{{ p.text }}</span>
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

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly items = computed(() => {
    const names = namesFor(this.view());
    return this.pending().map((p) => ({ id: p.id, text: describePending(p, names, this.minute()) }));
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
