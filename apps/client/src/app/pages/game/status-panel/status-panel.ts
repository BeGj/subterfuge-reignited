import { Component, computed, input, output } from '@angular/core';
import { NEPTUNIUM_TO_WIN, electricalOutput, type PlayerView } from '@subterfuge/engine';
import { minutesToNextProduction } from '../clock';
import { playerColor } from '../colors';
import { formatDuration, formatNeptunium } from '../format';

/** Players' standings, your economy, and a keyboard-friendly list of your outposts. */
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
    .outposts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .outposts button {
      padding: 4px 10px;
    }
    .outposts button[aria-pressed='true'] {
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
  readonly selectedId = input<string | null>(null);
  readonly select = output<string>();

  protected readonly goal = NEPTUNIUM_TO_WIN;

  protected readonly players = computed(() =>
    this.view().players.map((p) => ({
      ...p,
      color: playerColor(this.view(), p.id),
      kg: formatNeptunium(p.neptunium),
      isYou: p.id === this.view().you,
    })),
  );

  protected readonly myOutposts = computed(() => this.view().outposts.filter((o) => o.owner === this.view().you));

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
