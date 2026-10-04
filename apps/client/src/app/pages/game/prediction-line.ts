import { Component, computed, inject, input } from '@angular/core';
import { formatGameTime } from './format';
import { outcomeSummary } from './time-math';
import { TimeMachine } from './time-machine';

/**
 * Predicted outcome of a sub or pending launch (green/red/grey), with a
 * "Jump to arrival" button that scrubs the time machine there.
 */
@Component({
  selector: 'sub-prediction-line',
  template: `
    @if (prediction(); as p) {
      <p class="line" [class]="'line ' + p.yours" role="status">
        <span class="dot" aria-hidden="true"></span>
        <span>{{ text() }} <span class="muted">({{ when() }})</span></span>
      </p>
      <button type="button" (click)="tm.jumpTo(p.at)">Jump to arrival</button>
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 8px 0;
    }
    .line {
      display: flex;
      gap: 6px;
      align-items: baseline;
      margin: 0 0 6px;
    }
    .dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--muted);
    }
    .win .dot {
      background: var(--ok);
    }
    .lose .dot {
      background: var(--danger);
    }
    .muted {
      color: var(--muted);
    }
  `,
})
export class PredictionLine {
  protected readonly tm = inject(TimeMachine);

  /** Prediction key: `sub:<id>` or `order:<pendingOrderId>`. */
  readonly key = input.required<string>();
  readonly you = input.required<string>();

  protected readonly prediction = computed(() => this.tm.prediction(this.key()));
  protected readonly text = computed(() => {
    const p = this.prediction();
    return p ? outcomeSummary(p, this.you()) : '';
  });
  protected readonly when = computed(() => {
    const p = this.prediction();
    return p ? formatGameTime(p.at) : '';
  });
}
