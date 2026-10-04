import { SONAR_RANGE, type OutpostView, type PlayerView, type Point, type Sub } from '@subterfuge/engine';
import { toScreen, type Camera, type Viewport } from './camera';
import { DORMANT_COLOR, UNKNOWN_COLOR, playerColor } from './colors';
import { subPositionAt } from './geometry';

/** Everything needed to draw one frame. Pure data; no Angular here. */
export interface Scene {
  view: PlayerView;
  camera: Camera;
  viewport: Viewport;
  /** Fractional game minute, for smooth sub movement. */
  minute: number;
  selectedId: string | null;
  hoverId: string | null;
  /** Outpost a launch is being planned from (target-picking mode). */
  launchFromId: string | null;
  launchTargetId: string | null;
}

const BG = '#07131f';
const TEXT = '#e3eef6';
const MUTED = '#9bb6c9';
const ACCENT = '#4fd1c5';
const SHIELD = '#7fb8ff';
const OUTPOST_RADIUS = 9;

/** Draws a frame. Returns true if something is still moving (keep animating). */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): boolean {
  const { view, camera, viewport } = scene;
  const byId = new Map(view.outposts.map((o) => [o.id, o]));
  const screen = (p: Point) => toScreen(camera, viewport, p);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawSonar(ctx, scene);

  // Planned launch preview.
  const launchFrom = scene.launchFromId ? byId.get(scene.launchFromId) : undefined;
  const launchTo = byId.get(scene.launchTargetId ?? scene.hoverId ?? '');
  if (launchFrom && launchTo && launchTo !== launchFrom) {
    dashedLine(ctx, screen(launchFrom.position), screen(launchTo.position), ACCENT, 2, [8, 6]);
  }

  // Sub lanes, then outposts, then subs on top.
  let moving = false;
  const subs: { sub: Sub; at: Point; target: Point }[] = [];
  for (const sub of view.subs) {
    const from = byId.get(sub.from);
    const to = byId.get(sub.to);
    if (!from || !to) continue;
    const at = subPositionAt(sub, from.position, to.position, scene.minute);
    if (scene.minute < sub.arrivesAt) moving = true;
    dashedLine(ctx, screen(at), screen(to.position), withAlpha(playerColor(view, sub.owner), 0.45), 1.5, [4, 6]);
    subs.push({ sub, at, target: to.position });
  }

  const queens = new Set(
    view.specialists
      .filter((s) => s.kind === 'queen' && s.captiveOf === null && 'outpost' in s.location)
      .map((s) => (s.location as { outpost: string }).outpost),
  );
  const showNames = camera.scale >= 0.3;
  for (const outpost of view.outposts) {
    drawOutpost(ctx, scene, outpost, screen(outpost.position), {
      queen: queens.has(outpost.id),
      showName: showNames || outpost.id === scene.selectedId || outpost.id === scene.hoverId,
    });
  }

  for (const { sub, at, target } of subs) drawSub(ctx, view, sub, screen(at), screen(target));

  return moving;
}

function drawSonar(ctx: CanvasRenderingContext2D, { view, camera, viewport }: Scene): void {
  const radius = SONAR_RANGE * camera.scale;
  ctx.save();
  ctx.fillStyle = withAlpha(ACCENT, 0.035);
  ctx.strokeStyle = withAlpha(ACCENT, 0.12);
  ctx.lineWidth = 1;
  for (const outpost of view.outposts) {
    if (outpost.owner !== view.you) continue;
    const p = toScreen(camera, viewport, outpost.position);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawOutpost(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  outpost: OutpostView,
  p: Point,
  opts: { queen: boolean; showName: boolean },
): void {
  const { view } = scene;
  const r = OUTPOST_RADIUS;
  const color = outpost.owner === undefined ? UNKNOWN_COLOR : outpost.owner === null ? DORMANT_COLOR : playerColor(view, outpost.owner);
  const mine = outpost.owner === view.you;

  // Selection / hover / target rings.
  if (outpost.id === scene.selectedId || outpost.id === scene.launchTargetId) {
    ring(ctx, p, r + 9, ACCENT, 2);
  } else if (outpost.id === scene.hoverId) {
    ring(ctx, p, r + 9, withAlpha(TEXT, 0.5), 1.5);
  }

  // Shield arc: dim full ring, bright arc for the current charge.
  if (outpost.shieldMax !== undefined && outpost.shieldCharge !== undefined) {
    ring(ctx, p, r + 4, withAlpha(SHIELD, 0.18), 2);
    const fraction = outpost.shieldMax > 0 ? outpost.shieldCharge / outpost.shieldMax : 0;
    if (fraction > 0 && outpost.shieldEnabled !== false) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
      ctx.strokeStyle = SHIELD;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.fillStyle = outpost.owner === null ? withAlpha(color, 0.35) : color;
  ctx.strokeStyle = mine ? TEXT : withAlpha(BG, 0.9);
  ctx.lineWidth = mine ? 1.5 : 1;
  ctx.beginPath();
  switch (outpost.type) {
    case 'factory':
      ctx.rect(p.x - r * 0.85, p.y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'generator':
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      break;
    case 'mine':
      ctx.moveTo(p.x, p.y - r * 1.15);
      ctx.lineTo(p.x + r * 1.15, p.y);
      ctx.lineTo(p.x, p.y + r * 1.15);
      ctx.lineTo(p.x - r * 1.15, p.y);
      ctx.closePath();
      break;
    default:
      ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      label(ctx, opts.showName ? outpost.name : '', p, r);
      return;
  }
  ctx.fill();
  ctx.stroke();
  if (outpost.type === 'generator') bolt(ctx, p, r, BG);
  ctx.restore();

  if (opts.queen) crown(ctx, { x: p.x, y: p.y - r - 12 }, color);
  if (outpost.drillers !== undefined) {
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TEXT;
    ctx.fillText(String(outpost.drillers), p.x, p.y + r + 7);
  }
  label(ctx, opts.showName ? outpost.name : '', p, r + (opts.queen ? 12 : 0));
}

function drawSub(ctx: CanvasRenderingContext2D, view: PlayerView, sub: Sub, p: Point, target: Point): void {
  const angle = Math.atan2(target.y - p.y, target.x - p.x);
  const size = 7;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.8, size * 0.7);
  ctx.lineTo(-size * 0.8, -size * 0.7);
  ctx.closePath();
  ctx.fillStyle = playerColor(view, sub.owner);
  ctx.strokeStyle = BG;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT;
  const extra = sub.specialists.length ? ` +${sub.specialists.length}★` : '';
  ctx.fillText(`${sub.drillers}${extra}`, p.x + 9, p.y - 8);
}

function label(ctx: CanvasRenderingContext2D, text: string, p: Point, offset: number): void {
  if (!text) return;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = MUTED;
  ctx.fillText(text, p.x, p.y - offset - 7);
}

function ring(ctx: CanvasRenderingContext2D, p: Point, r: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function dashedLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number, dash: number[]): void {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function bolt(ctx: CanvasRenderingContext2D, p: Point, r: number, color: string): void {
  const s = r * 0.6;
  ctx.beginPath();
  ctx.moveTo(p.x + s * 0.2, p.y - s);
  ctx.lineTo(p.x - s * 0.5, p.y + s * 0.1);
  ctx.lineTo(p.x, p.y + s * 0.1);
  ctx.lineTo(p.x - s * 0.2, p.y + s);
  ctx.lineTo(p.x + s * 0.5, p.y - s * 0.1);
  ctx.lineTo(p.x, p.y - s * 0.1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function crown(ctx: CanvasRenderingContext2D, p: Point, color: string): void {
  const w = 12;
  const h = 8;
  ctx.beginPath();
  ctx.moveTo(p.x - w / 2, p.y + h / 2);
  ctx.lineTo(p.x - w / 2, p.y - h / 2);
  ctx.lineTo(p.x - w / 4, p.y);
  ctx.lineTo(p.x, p.y - h / 2);
  ctx.lineTo(p.x + w / 4, p.y);
  ctx.lineTo(p.x + w / 2, p.y - h / 2);
  ctx.lineTo(p.x + w / 2, p.y + h / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = BG;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
}

/** `#rrggbb` + alpha → `rgba(...)`. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
