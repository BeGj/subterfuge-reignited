import { Component, computed, inject, input, signal } from '@angular/core';
import {
  HIRE_INTERVAL,
  SPECIALIST_CATEGORIES,
  SPECIALISTS,
  outpostOfSpec,
  specialistName,
  type OrderInput,
  type PendingOrder,
  type PlayerView,
  type SpecialistCategory,
  type SpecialistKind,
} from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { apiErrorMessage } from '../../../core/auth';
import { namesFor } from '../describe';
import { formatDuration, formatGameTime } from '../format';
import { TimeMachine } from '../time-machine';

const CATEGORY_LABELS: Record<SpecialistCategory, string> = {
  offensive: 'Offensive',
  defensive: 'Defensive',
  other: 'Other',
};

/**
 * Hiring and promotion (goal.md → Hiring): the current offer as one card per
 * category, and the specialists of yours that can be promoted where they
 * stand. Offers are private to you, so this panel only reads your own hiring.
 */
@Component({
  selector: 'sub-hire-panel',
  styleUrl: '../panel.css',
  styles: `
    ul.cards {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 8px 0;
      padding: 0;
    }
    ul.cards li {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
    }
    .category {
      color: var(--muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    h3 {
      margin: 0;
      font-size: 0.95rem;
    }
    p.blurb {
      margin: 4px 0 8px;
      font-size: 0.9rem;
    }
    ul.promotions {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    ul.promotions li {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }
    .muted {
      color: var(--muted);
    }
  `,
  template: `
    <section class="card" aria-labelledby="hire-title">
      <h2 id="hire-title">Your staff</h2>

      @if (canHire()) {
        <p class="muted">Your Queen is at {{ queenLocation() }}.</p>
      } @else {
        <p class="muted">Your Queen must be at one of your own outposts to hire.</p>
      }

      @if (offer().length) {
        <ul class="cards">
          @for (card of offer(); track card.kind) {
            <li>
              <span class="category">{{ categoryLabel(card.category) }}</span>
              <h3>{{ card.name }}</h3>
              <p class="blurb">{{ card.blurb }}</p>
              <button type="button" class="primary" [disabled]="busy() || !canHire()" (click)="hire(card.kind)">
                Hire
              </button>
            </li>
          }
        </ul>
      } @else if (hasOffer()) {
        <p>The decks are empty: this offer can only be used to promote.</p>
      } @else {
        <p>No offer right now. The next one arrives at {{ formatTime(nextOfferAt()) }}.</p>
      }
      <p class="muted">One offer every {{ formatDuration(interval) }}.</p>

      @if (promotable().length) {
        <h3>Ready to promote</h3>
        <p class="muted">
          @if (hasOffer()) {
            Promoting takes this offer instead of a hire.
          } @else {
            Promoting takes an offer instead of a hire; wait for the next one.
          }
        </p>
        <ul class="promotions">
          @for (p of promotable(); track p.id) {
            <li>
              <span>
                {{ p.name }}
                <span class="muted">at {{ p.where }}</span>
              </span>
              <button type="button" [disabled]="busy() || !hasOffer()" (click)="promote(p.id, p.to)">
                Promote to {{ p.toName }}
              </button>
            </li>
          }
        </ul>
      }

      @if (waiting()) {
        <p class="muted">Still waiting: {{ waiting() }}.</p>
      }
      <p class="note" role="status">{{ info() }}</p>
      <p class="error" role="alert">{{ error() }}</p>
    </section>
  `,
})
export class HirePanel {
  private readonly realtime = inject(Realtime);
  protected readonly tm = inject(TimeMachine);

  readonly gameId = input.required<string>();
  readonly view = input.required<PlayerView>();
  /** Your pending orders, so it can show what is already booked. */
  readonly pending = input.required<readonly PendingOrder[]>();

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');

  protected readonly formatDuration = formatDuration;
  protected readonly formatTime = formatGameTime;
  protected readonly interval = HIRE_INTERVAL;

  private readonly names = computed(() => namesFor(this.view()));

  /** The offer, as one card per category that has a specialist left. */
  protected readonly offer = computed(() => {
    const kinds = this.view().hiring.offer?.kinds ?? {};
    return SPECIALIST_CATEGORIES.filter((c): c is SpecialistCategory => kinds[c] !== undefined).map((category) => {
      const kind = kinds[category]!;
      return { category, kind, name: specialistName(kind), blurb: SPECIALISTS[kind].blurb };
    });
  });

  /**
   * Whether there is an offer to take. Once the decks run dry an offer can
   * hold no cards at all, but it still allows a promotion.
   */
  protected readonly hasOffer = computed(() => this.view().hiring.offer !== null);

  protected readonly nextOfferAt = computed(() => this.view().hiring.nextOfferAt);

  /** Where the Queen is: an outpost id, 'sea', or '' when she is a prisoner. */
  private readonly queenAt = computed(() => {
    const view = this.view();
    const queen = view.specialists.find((s) => s.kind === 'queen' && s.owner === view.you && s.captiveOf === null);
    if (!queen) return '';
    return outpostOfSpec(queen) ?? 'sea';
  });

  /** Whether the Queen is standing on one of your own outposts. */
  protected readonly canHire = computed(() => {
    const at = this.queenAt();
    return at !== '' && this.view().outposts.some((o) => o.id === at && o.owner === this.view().you);
  });

  protected readonly queenLocation = computed(() => {
    const at = this.queenAt();
    if (at === '') return '';
    if (at === 'sea') return 'sea';
    const outpost = this.view().outposts.find((o) => o.id === at);
    return outpost ? this.names().outpost(outpost.id) : '';
  });

  /** Your specialists standing on your own outposts that can be promoted. */
  protected readonly promotable = computed(() => {
    const view = this.view();
    return view.specialists
      .filter((s) => s.owner === view.you && s.captiveOf === null)
      .flatMap((s) => {
        const to = SPECIALISTS[s.kind].promotesTo;
        const at = outpostOfSpec(s);
        if (!to || at === null) return [];
        // Promotion happens where the specialist stands, so it has to be yours.
        const outpost = view.outposts.find((o) => o.id === at);
        if (!outpost || outpost.owner !== view.you) return [];
        return [{ id: s.id, to, name: specialistName(s.kind), toName: specialistName(to), where: this.names().outpost(at) }];
      });
  });

  /** Your hires and promotions that haven't run yet. */
  protected readonly waiting = computed(() =>
    this.pending()
      .map((p) => (p.order.kind === 'hire' ? `hiring a ${specialistName(p.order.choice)}` : 'a promotion'))
      .join(', '),
  );

  protected categoryLabel(category: SpecialistCategory): string {
    return CATEGORY_LABELS[category];
  }

  protected hire(kind: SpecialistKind): Promise<void> {
    return this.send({ kind: 'hire', choice: kind }, `Hired a ${specialistName(kind)}.`);
  }

  protected promote(specialist: string, to: SpecialistKind): Promise<void> {
    return this.send({ kind: 'promote', specialist }, `Promoted to ${specialistName(to)}.`);
  }

  private async send(order: OrderInput, done: string): Promise<void> {
    this.error.set('');
    this.info.set('');
    // While scrubbed, the order is scheduled for that time and checked against
    // the forecast first (the server only checks scheduled orders when they run).
    const problem = this.tm.validateScheduled(order);
    if (problem) {
      this.error.set(`At that time: ${problem}`);
      return;
    }
    const at = this.tm.scheduleFor(order);
    this.busy.set(true);
    try {
      await this.realtime.issueOrder({ gameId: this.gameId(), order, ...(at === undefined ? {} : { at }) });
      this.info.set(`${done} It takes effect on the tick it is due.`);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}