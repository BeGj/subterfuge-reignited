import { Component, computed, input } from '@angular/core';
import type { PlayerView, Sub } from '@subterfuge/engine';
import { namesFor } from '../describe';
import { formatDuration, formatGameTime } from '../format';
import { PredictionLine } from '../prediction-line';

/**
 * Details of a sub in flight. Launched subs can't be recalled or redirected
 * in Subterfuge unless a Navigator is aboard (not built yet), so the only
 * action is a disabled Redirect explaining why.
 */
@Component({
  selector: 'sub-sub-panel',
  imports: [PredictionLine],
  styleUrl: '../panel.css',
  template: `
    <section class="card" aria-labelledby="sub-title">
      <h2 id="sub-title">{{ isMine() ? 'Your sub' : names().player(sub().owner) + "'s sub" }}</h2>
      <dl>
        <dt>Route</dt>
        <dd>{{ names().outpost(sub().from) }} → {{ names().outpost(sub().to) }}</dd>
        <dt>Drillers</dt>
        <dd>{{ sub().drillers }}</dd>
        @if (aboard().length) {
          <dt>Specialists</dt>
          <dd>{{ aboard().join(', ') }}</dd>
        }
        <dt>ETA</dt>
        <dd>
          @if (remaining() > 0) {
            in {{ eta() }} · {{ arrival() }}
          } @else {
            arriving now
          }
        </dd>
        @if (sub().isGift) {
          <dt>Gift</dt>
          <dd>Yes: cargo goes to the target's owner</dd>
        }
      </dl>
      <sub-prediction-line [key]="'sub:' + sub().id" [you]="view().you" />
      @if (isMine()) {
        <div class="actions">
          <button type="button" disabled aria-describedby="redirect-why">Redirect</button>
        </div>
        <p id="redirect-why" class="note">
          Needs a Navigator on board. Launched subs can't be recalled or cancelled.
        </p>
      }
    </section>
  `,
})
export class SubPanel {
  readonly view = input.required<PlayerView>();
  readonly sub = input.required<Sub>();
  readonly minute = input.required<number>();

  protected readonly names = computed(() => namesFor(this.view()));
  protected readonly isMine = computed(() => this.sub().owner === this.view().you);
  protected readonly remaining = computed(() => this.sub().arrivesAt - this.minute());
  protected readonly eta = computed(() => formatDuration(this.remaining()));
  protected readonly arrival = computed(() => formatGameTime(this.sub().arrivesAt));
  protected readonly aboard = computed(() =>
    this.view()
      .specialists.filter((s) => 'sub' in s.location && s.location.sub === this.sub().id)
      .map((s) => (s.kind === 'queen' ? 'Queen' : s.kind)),
  );
}
