import { Component, computed, input, output } from '@angular/core';
import { NAVIGATOR_COOLDOWN, specialistName, type PlayerView, type Sub } from '@subterfuge/engine';
import { namesFor } from '../describe';
import { formatDuration, formatGameTime } from '../format';
import { PredictionLine } from '../prediction-line';

/**
 * Details of a sub in flight. A sub can't be recalled or cancelled, but a
 * Navigator aboard may change its destination once every 8 hours, which the
 * player picks on the map.
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
        @if (sub().origin) {
          <dd>Redirected → {{ names().outpost(sub().to) }} (was heading for {{ names().outpost(sub().from) }})</dd>
        } @else {
          <dd>{{ names().outpost(sub().from) }} → {{ names().outpost(sub().to) }}</dd>
        }
        <dt>Drillers</dt>
        <dd>{{ sub().drillers }}</dd>
        @if (sub().speed > 1) {
          <dt>Speed</dt>
          <dd>{{ sub().speed }}× (a specialist aboard)</dd>
        }
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
        @if (redirecting()) {
          <p class="note">Pick the new destination on the map.</p>
          <div class="actions">
            <button type="button" (click)="redirectCancel.emit()">Keep {{ names().outpost(sub().to) }}</button>
          </div>
        } @else {
          <div class="actions">
            <button type="button" [disabled]="!canRedirect()" (click)="redirectStart.emit()">Redirect…</button>
          </div>
          @if (redirectWhy(); as why) {
            <p class="note">{{ why }}</p>
          }
        }
      }
    </section>
  `,
})
export class SubPanel {
  readonly view = input.required<PlayerView>();
  readonly sub = input.required<Sub>();
  readonly minute = input.required<number>();
  /** True while the player is picking a new destination on the map. */
  readonly redirecting = input(false);

  readonly redirectStart = output<void>();
  readonly redirectCancel = output<void>();

  protected readonly names = computed(() => namesFor(this.view()));
  protected readonly isMine = computed(() => this.sub().owner === this.view().you);
  protected readonly remaining = computed(() => this.sub().arrivesAt - this.minute());
  protected readonly eta = computed(() => formatDuration(this.remaining()));
  protected readonly arrival = computed(() => formatGameTime(this.sub().arrivesAt));
  protected readonly aboard = computed(() =>
    this.view()
      .specialists.filter((s) => 'sub' in s.location && s.location.sub === this.sub().id)
      .map((s) => specialistName(s.kind)),
  );

  /** Whether this sub's Navigator may redirect right now. */
  protected readonly canRedirect = computed(() => !this.redirectWhy());
  protected readonly redirectWhy = computed(() => {
    if (!this.isMine()) return 'Only your own sub can be redirected.';
    const navigator = this.view().specialists.some(
      (s) =>
        s.kind === 'navigator' &&
        s.owner === this.view().you &&
        s.captiveOf === null &&
        'sub' in s.location &&
        s.location.sub === this.sub().id,
    );
    if (!navigator) return 'Needs a Navigator on board.';
    const last = this.sub().lastRedirectAt;
    if (last !== null && this.minute() - last < NAVIGATOR_COOLDOWN) {
      return `The Navigator needs ${formatDuration(NAVIGATOR_COOLDOWN)} between redirects.`;
    }
    return null;
  });
}
