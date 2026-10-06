import { Component, computed, input, output } from '@angular/core';
import {
  NEPTUNIUM_TO_WIN,
  electricalOutput,
  outpostOfSpec,
  specialistName,
  type PlayerView,
} from '@subterfuge/engine';
import { minutesToNextProduction } from '../clock';
import { playerColor } from '../colors';
import { namesFor } from '../describe';
import { formatDuration, formatNeptunium } from '../format';
import { isSelected, type Selection } from '../selection';

/** Players' standings, your economy, and keyboard-friendly lists of your outposts and subs. */
@Component({
  selector: 'sub-status-panel',
  templateUrl: './status-panel.html',
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
    .players li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 2px 0;
    }
    .swatch {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .out {
      text-decoration: line-through;
      color: var(--muted);
    }
    .stats {
      margin: 12px 0;
    }
    .stats p {
      margin: 2px 0;
    }
    .subs {
      margin-top: 4px;
    }
    .outposts,
    .subs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .specialists {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 12px;
    }
    .specialists li {
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }
    .outposts button,
    .subs button {
      padding: 4px 10px;
    }
    .outposts button[aria-pressed='true'],
    .subs button[aria-pressed='true'] {
      border-color: var(--accent);
    }
    .muted {
      color: var(--muted);
    }
  `,
})
export class StatusPanel {
  readonly view = input.required<PlayerView>();
  /** Current game minute (fractional). */
  readonly minute = input.required<number>();
  readonly selection = input<Selection | null>(null);
  readonly select = output<Selection>();

  protected readonly goal = NEPTUNIUM_TO_WIN;

  protected readonly players = computed(() =>
    this.view().players.map((p) => ({
      ...p,
      color: playerColor(this.view(), p.id),
      kg: formatNeptunium(p.neptunium),
      isYou: p.id === this.view().you,
    })),
  );

  protected readonly myOutposts = computed(() =>
    this.view()
      .outposts.filter((o) => o.owner === this.view().you)
      .map((o) => ({ ...o, selected: isSelected(this.selection(), 'outpost', o.id) })),
  );

  /** Your specialists and where they are: an outpost, a sub, or a prison. */
  protected readonly mySpecialists = computed(() => {
    const view = this.view();
    const names = namesFor(view);
    return view.specialists
      .filter((s) => s.owner === view.you)
      .map((s) => {
        const at = outpostOfSpec(s);
        let where: string;
        if (s.captiveOf !== null) {
          where = at === null ? 'a prisoner' : `prisoner at ${names.outpost(at)}`;
        } else {
          where = at === null ? 'at sea' : names.outpost(at);
        }
        return { id: s.id, name: specialistName(s.kind), where };
      });
  });

  /** Your subs in flight, soonest arrival first. */
  protected readonly mySubs = computed(() => {
    const view = this.view();
    const names = namesFor(view);
    return view.subs
      .filter((s) => s.owner === view.you)
      .sort((a, b) => a.arrivesAt - b.arrivesAt)
      .map((s) => ({
        id: s.id,
        text: `${s.drillers} → ${names.outpost(s.to)} · ${formatDuration(s.arrivesAt - this.minute())}`,
        selected: isSelected(this.selection(), 'sub', s.id),
      }));
  });

  protected readonly totals = computed(() => {
    const view = this.view();
    const drillers =
      this.myOutposts().reduce((sum, o) => sum + (o.drillers ?? 0), 0) +
      view.subs.filter((s) => s.owner === view.you).reduce((sum, s) => sum + s.drillers, 0);
    const generators = this.myOutposts().filter((o) => o.type === 'generator').length;
    return { drillers, cap: electricalOutput({ generators }) };
  });

  protected readonly nextProduction = computed(() => formatDuration(minutesToNextProduction(this.minute())));
}
