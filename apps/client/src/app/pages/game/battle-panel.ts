import { Component, computed, inject, input } from '@angular/core';
import type { PlayerView } from '@subterfuge/engine';
import { namesFor } from './describe';
import { formatDuration, formatGameTime } from './format';
import { outcomeSummary } from './time-math';
import { TimeMachine, type Prediction } from './time-machine';

const HEADINGS = { win: 'Predicted win', lose: 'Predicted loss', unknown: 'Outcome unknown', none: 'Predicted arrival' };

/** Battle summary for a predicted fight (opened from a map icon or a panel). */
@Component({
  selector: 'sub-battle-panel',
  styleUrl: './panel.css',
  template: `
    <section class="card" aria-labelledby="battle-title">
      <h2 id="battle-title" [class]="'outcome ' + prediction().yours">{{ heading() }}</h2>
      <p>{{ summary() }}</p>
      <dl>
        <dt>Where</dt>
        <dd>{{ where() }}</dd>
        <dt>When</dt>
        <dd>{{ when() }}</dd>
        @for (side of sides(); track side.player) {
          <dt>{{ side.name }}</dt>
          <dd>
            {{ side.drillersBefore }} → {{ side.drillersAfter }} drillers
            @if (side.specialists) {
              · {{ side.specialists }} specialist(s)
            }
          </dd>
        }
        @if (shield(); as s) {
          <dt>Shield</dt>
          <dd>{{ s }}</dd>
        }
        @if (effects().length) {
          <dt>Specialists</dt>
          <dd>
            @for (effect of effects(); track $index) {
              <div>{{ effect }}</div>
            }
          </dd>
        }
      </dl>
      <div class="actions">
        <button type="button" (click)="tm.travelTo(prediction().at)">Jump to arrival</button>
      </div>
      <p class="note">Based on what you can see now. Enemy moves and anything outside your sonar can change this.</p>
    </section>
  `,
  styles: `
    .outcome.win {
      color: var(--ok);
    }
    .outcome.lose {
      color: var(--danger);
    }
    .outcome.unknown {
      color: var(--muted);
    }
  `,
})
export class BattlePanel {
  protected readonly tm = inject(TimeMachine);

  readonly view = input.required<PlayerView>();
  readonly prediction = input.required<Prediction>();
  /** Live game minute, for "in 3h". */
  readonly minute = input.required<number>();

  private readonly names = computed(() => namesFor(this.view()));
  protected readonly heading = computed(() => HEADINGS[this.prediction().yours]);
  protected readonly summary = computed(() => outcomeSummary(this.prediction(), this.view().you));
  protected readonly where = computed(() => {
    const p = this.prediction();
    const route = p.origin
      ? `redirected → ${this.names().outpost(p.to)}`
      : `${this.names().outpost(p.from)} → ${this.names().outpost(p.to)}`;
    return p.combat && !p.combat.outpost ? `Between subs, on ${route}` : `${this.names().outpost(p.to)} (${route})`;
  });
  protected readonly when = computed(() => {
    const at = this.prediction().at;
    return `${formatGameTime(at)} · in ${formatDuration(Math.max(0, at - this.minute()))}`;
  });
  /** What the specialists did before the drillers fought ("Thief stole 6 drillers"). */
  protected readonly effects = computed(() => this.prediction().combat?.details.effects ?? []);
  protected readonly sides = computed(() =>
    (this.prediction().combat?.details.sides ?? []).map((s) => ({
      ...s,
      name: s.player === '?' ? 'Unknown' : this.names().player(s.player),
    })),
  );
  protected readonly shield = computed(() => {
    const d = this.prediction().combat?.details;
    return d?.shieldBefore === undefined ? null : `${d.shieldBefore} → ${d.shieldAfter ?? 0}`;
  });
}
