import { Component, computed, inject, input } from '@angular/core';
import { DAY, HOUR, TICK } from '@subterfuge/engine';
import { formatDuration, formatGameTime } from './format';
import { TimeMachine } from './time-machine';

/**
 * The time machine's controls under the map: a scrubber from now into the
 * forecast, quick jumps, and play/pause to watch the forecast unfold.
 */
@Component({
  selector: 'sub-time-bar',
  host: { '[class.forecast]': 'tm.active()' },
  template: `
    <div class="row">
      <button type="button" (click)="tm.backToNow()" [disabled]="!tm.active()">Now</button>
      <button type="button" (click)="tm.togglePlay()" [attr.aria-pressed]="tm.playing()">
        {{ tm.playing() ? 'Pause' : 'Play' }}
      </button>
      <button type="button" (click)="tm.step(hour)">+1h</button>
      <button type="button" (click)="tm.step(6 * hour)">+6h</button>
      <button type="button" (click)="tm.step(day)">+1d</button>
      <label class="scrub">
        <span class="visually-hidden">Time machine: game time to show</span>
        <input
          type="range"
          [min]="liveMinute()"
          [max]="tm.horizon()"
          [step]="tick"
          [value]="tm.displayMinute()"
          [attr.aria-valuetext]="label()"
          (input)="onScrub($event)"
        />
      </label>
    </div>
    <p class="status" role="status">
      @if (tm.active()) {
        <strong>Forecast: {{ label() }}</strong> ({{ ahead() }} ahead) · based on what you can see; enemy moves are
        unknown. Orders you give now are scheduled for this time.
      } @else {
        Live. Drag the slider or press Play to see the predicted future.
      }
    </p>
  `,
  styles: `
    :host {
      display: block;
      padding: 8px 12px;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    :host(.forecast) {
      background: color-mix(in srgb, var(--warn) 14%, var(--surface));
      border-top-color: var(--warn);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .row button {
      padding: 4px 10px;
    }
    .scrub {
      flex: 1 1 160px;
      display: flex;
    }
    .scrub input {
      width: 100%;
      padding: 0;
      accent-color: var(--warn);
    }
    .status {
      margin: 6px 0 0;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .status strong {
      color: var(--warn);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class TimeBar {
  protected readonly tm = inject(TimeMachine);

  readonly liveMinute = input.required<number>();

  protected readonly hour = HOUR;
  protected readonly day = DAY;
  protected readonly tick = TICK;
  protected readonly label = computed(() => formatGameTime(this.tm.displayMinute()));
  protected readonly ahead = computed(() => formatDuration(this.tm.displayMinute() - this.liveMinute()));

  protected onScrub(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value <= this.liveMinute()) this.tm.backToNow();
    else this.tm.jumpTo(value);
  }
}
