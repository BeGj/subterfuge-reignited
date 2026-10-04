import { SONAR_RANGE, type OutpostView, type PlayerView, type Point, type Sub } from '@subterfuge/engine';
import { toScreen, type Camera, type Viewport } from './camera';
import { DORMANT_COLOR, UNKNOWN_COLOR, playerColor } from './colors';
import { formatDuration, formatGameTime, plannedTripLabel } from './format';
import { subPositionAt, travelMinutes } from './geometry';
import { effectiveShieldMax, shieldRingFill } from './shield-rings';
import { badgeCenter, estimatedLaunchAt, type OrderMarker } from './overlays';
import { isSelected, type Selection } from './selection';

/** Everything needed to draw one frame. Pure data; no Angular here. */
export interface Scene {
  view: PlayerView;
  camera: Camera;
  viewport: Viewport;
  /** Fractional game minute, for smooth sub movement. */
  minute: number;
  selection: Selection | null;
  hover: Selection | null;
  /** Outpost a launch is being planned from (target-picking mode). */
  launchFromId: string | null;
  launchTargetId: string | null;
  /**
   * When a launch planned now would leave. Defaults to "after the launch
   * delay"; the time machine passes the scheduled time instead.
   */
  launchAt?: number;
  /**
   * Enemy launches about to happen (still cancellable by their owner),
   * drawn as warning routes.
   */
  imminent?: readonly ImminentLaunch[];
  /** Your pending orders, as map markers (ghost routes and badges). */
  markers: OrderMarker[];
}

export interface ImminentLaunch {
  from: Point;
  to: Point;
  color: string;
  /** Badge text, e.g. "⚠ 40 · 6m". */
  text: string;
}

const BG = '#07131f';
const TEXT = '#e3eef6';
const MUTED = '#9bb6c9';
const ACCENT = '#4fd1c5';
const SHIELD = '#7fb8ff';
/** Distance between shield rings, in pixels. */
const RING_GAP = 3.5;
const OUTPOST_RADIUS = 9;

/** Where each visible sub is this frame (map coordinates). */
export function subPositions(view: PlayerView, minute: number): Map<string, Point> {
  const byId = new Map(view.outposts.map((o) => [o.id, o.position]));
  const out = new Map<string, Point>();
  for (const sub of view.subs) {
    const from = byId.get(sub.from);
    const to = byId.get(sub.to);
    if (from && to) out.set(sub.id, subPositionAt(sub, from, to, minute));
  }
  return out;
}

/** Draws a frame. Returns true if something is still moving (keep animating). */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): boolean {
  const { view, camera, viewport } = scene;
  const byId = new Map(view.outposts.map((o) => [o.id, o]));
  const screen = (p: Point) => toScreen(camera, viewport, p);

  // Transparent: the ambient sea background is CSS behind the canvas.
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  drawSonar(ctx, scene);
  drawSelectedSonar(ctx, scene, byId);

  // Ghost routes for pending launches, under everything else.
  for (const marker of scene.markers) {
    if (marker.kind !== 'launch' || !marker.target) continue;
    const selected = isSelected(scene.selection, 'order', marker.orderId);
    const hovered = isSelected(scene.hover, 'order', marker.orderId);
    dashedLine(ctx, screen(marker.anchor), screen(marker.target), withAlpha(ACCENT, selected ? 0.9 : hovered ? 0.6 : 0.35), selected ? 2 : 1.5, [2, 5]);
  }

  // Enemy launches about to happen: a warning route in their colour with a
  // badge at the origin.
  for (const launch of scene.imminent ?? []) {
    const from = screen(launch.from);
    dashedLine(ctx, from, screen(launch.to), withAlpha(launch.color, 0.8), 2, [10, 4]);
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    const w = ctx.measureText(launch.text).width + 10;
    const x = from.x - w / 2;
    const y = from.y - 34;
    ctx.fillStyle = withAlpha(BG, 0.9);
    ctx.strokeStyle = launch.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 18, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'middle';
    ctx.fillText(launch.text, x + 5, y + 9);
    ctx.restore();
  }

  // Planned launch preview.
  const launchFrom = scene.launchFromId ? byId.get(scene.launchFromId) : undefined;
  const hoverOutpost = scene.hover?.kind === 'outpost' ? scene.hover.id : null;
  const launchTo = launchFrom ? byId.get(scene.launchTargetId ?? hoverOutpost ?? '') : undefined;
  if (launchFrom && launchTo && launchTo !== launchFrom) {
    dashedLine(ctx, screen(launchFrom.position), screen(launchTo.position), ACCENT, 2, [8, 6]);
  }

  // Sub lanes, then outposts, then subs on top.
  let moving = false;
  const subs: { sub: Sub; at: Point; target: Point }[] = [];
  const positions = subPositions(view, scene.minute);
  const sonarClip = sonarArea(scene);
  for (const sub of view.subs) {
    const at = positions.get(sub.id);
    const to = byId.get(sub.to);
    if (!at || !to) continue;
    if (scene.minute < sub.arrivesAt) moving = true;
    const selected = isSelected(scene.selection, 'sub', sub.id);
    const color = playerColor(view, sub.owner);
    // The way it came: fainter, and only inside your sonar (you can't have
    // seen it travel through waters you don't watch).
    const origin = byId.get(sub.from);
    if (origin && sonarClip) {
      ctx.save();
      ctx.clip(sonarClip);
      dashedLine(ctx, screen(origin.position), screen(at), withAlpha(color, selected ? 0.5 : 0.2), selected ? 2 : 1.5, [4, 6]);
      ctx.restore();
    }
    // The way ahead.
    dashedLine(ctx, screen(at), screen(to.position), withAlpha(color, selected ? 0.95 : 0.45), selected ? 2.5 : 1.5, [4, 6]);
    subs.push({ sub, at, target: to.position });
  }

  const queens = new Set(
    view.specialists
      .filter((s) => s.kind === 'queen' && s.captiveOf === null && 'outpost' in s.location)
      .map((s) => (s.location as { outpost: string }).outpost),
  );
  const showNames = camera.scale >= 0.3;
  for (const outpost of view.outposts) {
    const selected = isSelected(scene.selection, 'outpost', outpost.id);
    drawOutpost(ctx, scene, outpost, screen(outpost.position), {
      queen: queens.has(outpost.id),
      selected,
      showName: showNames || selected || outpost.id === hoverOutpost,
    });
  }

  for (const { sub, at, target } of subs) {
    drawSub(ctx, view, sub, screen(at), screen(target), {
      selected: isSelected(scene.selection, 'sub', sub.id),
      hovered: isSelected(scene.hover, 'sub', sub.id),
    });
  }

  drawOrderBadges(ctx, scene);

  if (launchFrom && launchTo && launchTo !== launchFrom) {
    const launchAt = scene.launchAt ?? estimatedLaunchAt(scene.minute);
    const travel = travelMinutes(launchFrom.position, launchTo.position);
    const p = screen(launchTo.position);
    tag(ctx, plannedTripLabel(travel, launchAt + travel), { x: p.x + 16, y: p.y + 22 }, ACCENT, 'left');
  }

  return moving;
}

/**
 * Your combined sonar coverage as one shape: a single uniform fill (a path of
 * all circles filled once, so overlaps don't darken) and one outline around
 * the outer boundary (stroke every circle, then erase the inside of every
 * circle, which removes the inner arcs). The canvas is transparent at this
 * point, so erasing only removes our own strokes.
 */
/** Your combined sonar coverage as a clip path (screen space), or null if you have none. */
function sonarArea({ view, camera, viewport }: Scene): Path2D | null {
  const owned = view.outposts.filter((o) => o.owner === view.you);
  if (owned.length === 0) return null;
  const radius = SONAR_RANGE * camera.scale;
  const path = new Path2D();
  for (const o of owned) {
    const c = toScreen(camera, viewport, o.position);
    path.moveTo(c.x + radius, c.y);
    path.arc(c.x, c.y, radius, 0, Math.PI * 2);
  }
  return path;
}

function drawSonar(ctx: CanvasRenderingContext2D, { view, camera, viewport }: Scene): void {
  const radius = SONAR_RANGE * camera.scale;
  const centres = view.outposts.filter((o) => o.owner === view.you).map((o) => toScreen(camera, viewport, o.position));
  if (centres.length === 0) return;
  const circles = (r: number) => {
    const path = new Path2D();
    for (const c of centres) {
      path.moveTo(c.x + r, c.y);
      path.arc(c.x, c.y, r, 0, Math.PI * 2);
    }
    return path;
  };
  const lineWidth = 1.5;
  ctx.save();
  ctx.strokeStyle = withAlpha(ACCENT, 0.35);
  ctx.lineWidth = lineWidth;
  ctx.stroke(circles(radius));
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.fill(circles(radius - lineWidth / 2));
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = withAlpha(ACCENT, 0.05);
  ctx.fill(circles(radius), 'nonzero');
  ctx.restore();
}

/** The selected outpost's own sonar circle, in its owner's colour. */
function drawSelectedSonar(ctx: CanvasRenderingContext2D, scene: Scene, byId: Map<string, OutpostView>): void {
  if (scene.selection?.kind !== 'outpost') return;
  const outpost = byId.get(scene.selection.id);
  // Dormant (null) or unknown (undefined) owners have no sonar to show.
  if (!outpost?.owner) return;
  const color = playerColor(scene.view, outpost.owner);
  const p = toScreen(scene.camera, scene.viewport, outpost.position);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, SONAR_RANGE * scene.camera.scale, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(color, 0.07);
  ctx.fill();
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = withAlpha(color, 0.85);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawOrderBadges(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const perOutpost = new Map<string, number>();
  for (const marker of scene.markers) {
    const key = `${marker.kind}:${marker.anchor.x},${marker.anchor.y}`;
    const index = perOutpost.get(key) ?? 0;
    perOutpost.set(key, index + 1);
    const c = badgeCenter(marker, scene.camera, scene.viewport, index);
    const selected = isSelected(scene.selection, 'order', marker.orderId);
    const hovered = isSelected(scene.hover, 'order', marker.orderId);
    tag(ctx, `⏱ ${marker.text}`, c, selected ? ACCENT : hovered ? TEXT : MUTED, 'center', selected);
  }
}

/** A small rounded label with a dark backing, for badges and ETAs. */
function tag(ctx: CanvasRenderingContext2D, text: string, p: Point, color: string, align: 'left' | 'center', strong = false): void {
  ctx.save();
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  const h = 18;
  const x = align === 'center' ? p.x - w / 2 : p.x;
  ctx.beginPath();
  ctx.roundRect(x, p.y - h / 2, w, h, 6);
  ctx.fillStyle = withAlpha(BG, 0.88);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = strong ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, p.y + 0.5);
  ctx.restore();
}

function drawOutpost(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  outpost: OutpostView,
  p: Point,
  opts: { queen: boolean; showName: boolean; selected: boolean },
): void {
  const { view } = scene;
  const r = OUTPOST_RADIUS;
  const color = outpost.owner === undefined ? UNKNOWN_COLOR : outpost.owner === null ? DORMANT_COLOR : playerColor(view, outpost.owner);
  const mine = outpost.owner === view.you;

  // Shield: one ring per 10 charge (10 → 1 ring, 20 → 2, more with the
  // Queen), each a dim track with a bright arc, filling inner to outer.
  let outer = r + 4;
  const max = effectiveShieldMax(scene.view, outpost);
  if (max !== undefined && outpost.shieldCharge !== undefined) {
    const fills = shieldRingFill(outpost.shieldEnabled === false ? 0 : outpost.shieldCharge, max);
    fills.forEach((fill, i) => {
      const radius = r + 4 + i * RING_GAP;
      ring(ctx, p, radius, withAlpha(SHIELD, 0.18), 2);
      if (fill > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
        ctx.strokeStyle = SHIELD;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      outer = radius;
    });
  }

  // Selection / hover / target rings, outside the shield rings.
  if (opts.selected || outpost.id === scene.launchTargetId) {
    ring(ctx, p, outer + 5, ACCENT, 2);
  } else if (isSelected(scene.hover, 'outpost', outpost.id)) {
    ring(ctx, p, outer + 5, withAlpha(TEXT, 0.5), 1.5);
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

function drawSub(
  ctx: CanvasRenderingContext2D,
  view: PlayerView,
  sub: Sub,
  p: Point,
  target: Point,
  state: { selected: boolean; hovered: boolean },
): void {
  if (state.selected) ring(ctx, p, 13, ACCENT, 2);
  else if (state.hovered) ring(ctx, p, 13, withAlpha(TEXT, 0.5), 1.5);
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
