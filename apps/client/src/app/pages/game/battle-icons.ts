import type { PlayerView, Point } from '@subterfuge/engine';
import { toScreen, type Camera, type Viewport } from './camera';
import type { Prediction } from './time-machine';

/** A predicted fight drawn on the map. */
export interface BattleIcon {
  /** Prediction key; also the selection id. */
  key: string;
  outcome: 'win' | 'lose' | 'unknown';
  /** Map position of the fight. */
  at: Point;
}

/** Screen offset of the icon from the fight location, so it doesn't hide the outpost. */
export const ICON_OFFSET = { x: 14, y: -14 };
export const ICON_RADIUS = 8;

const COLORS = { win: '#3fb950', lose: '#f85149', unknown: '#8b949e' } as const;
const GLYPHS = { win: '✓', lose: '✕', unknown: '?' } as const;

/**
 * Icons for every predicted fight you're part of. Fights at an outpost sit on
 * the outpost; sub-vs-sub fights sit where the subs meet along the route.
 */
export function battleIcons(view: PlayerView, predictions: readonly Prediction[]): BattleIcon[] {
  const pos = new Map(view.outposts.map((o) => [o.id, o.position]));
  const icons: BattleIcon[] = [];
  // A sub-vs-sub fight appears in both subs' predictions; draw it once,
  // preferring your own sub's prediction (its summary is about your sub).
  const ordered = [...predictions].sort((a, b) => Number(b.owner === view.you) - Number(a.owner === view.you));
  const seen = new Set<string>();
  for (const p of ordered) {
    if (p.yours === 'none') continue;
    if (p.combat) {
      const id = `${p.combat.at}|${p.combat.outpost ?? [p.from, p.to].sort().join('-')}`;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    // A redirected sub's leg starts where it turned.
    const from = p.origin ?? pos.get(p.from);
    const to = pos.get(p.to);
    if (!from || !to) continue;
    let at: Point = to;
    if (p.combat && !p.combat.outpost) {
      // Sub-vs-sub: interpolate along the route to the meeting time.
      const span = p.arrivesAt - p.departsAt;
      const f = span > 0 ? Math.min(1, Math.max(0, (p.combat.at - p.departsAt) / span)) : 1;
      at = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    icons.push({ key: p.key, outcome: p.yours, at });
  }
  return icons;
}

export function iconCenter(icon: BattleIcon, camera: Camera, viewport: Viewport): Point {
  const s = toScreen(camera, viewport, icon.at);
  return { x: s.x + ICON_OFFSET.x, y: s.y + ICON_OFFSET.y };
}

export function drawBattleIcons(
  ctx: CanvasRenderingContext2D,
  icons: readonly BattleIcon[],
  camera: Camera,
  viewport: Viewport,
  selectedKey: string | null,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px system-ui, sans-serif';
  for (const icon of icons) {
    const c = iconCenter(icon, camera, viewport);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ICON_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[icon.outcome];
    ctx.fill();
    ctx.lineWidth = icon.key === selectedKey ? 3 : 1.5;
    ctx.strokeStyle = icon.key === selectedKey ? '#ffffff' : '#07131f';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(GLYPHS[icon.outcome], c.x, c.y + 0.5);
  }
  ctx.restore();
}
