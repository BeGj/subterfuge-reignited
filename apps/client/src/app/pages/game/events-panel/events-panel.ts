import { Component, computed, input } from '@angular/core';
import type { GameEvent, PlayerView } from '@subterfuge/engine';
import { describeEvent, namesFor } from '../describe';
import { formatGameTime } from '../format';

/** Recent events, newest first. */
@Component({
  selector: 'sub-events-panel',
  template: `
    <section class="card" aria-labelledby="events-title">
      <h2 id="events-title">Events</h2>
      <ol>
        @for (e of items(); track $index) {
          <li>
            <time class="muted">{{ e.time }}</time>
            {{ e.text }}
          </li>
        } @empty {
          <li class="muted">Nothing has happened yet.</li>
        }
      </ol>
    </section>
  `,
  styles: `
    h2 {
      margin: 0 0 8px;
      font-size: 1rem;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 240px;
      overflow-y: auto;
    }
    li {
      padding: 3px 0;
      font-size: 0.9rem;
    }
    time {
      display: block;
      font-size: 0.8rem;
    }
    .muted {
      color: var(--muted);
    }
  `,
})
export class EventsPanel {
  readonly view = input.required<PlayerView>();
  readonly events = input.required<GameEvent[]>();

  protected readonly items = computed(() => {
    const names = namesFor(this.view());
    return [...this.events()].reverse().map((e) => ({ time: formatGameTime(e.at), text: describeEvent(e, names) }));
  });
}
