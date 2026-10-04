import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { PendingOrder, PlayerView, Point } from '@subterfuge/engine';
import { fitPoints, pan, toScreen, zoomAt, type Camera, type Viewport } from '../camera';
import { gameMinuteAt, type ClockSync } from '../clock';
import { pick, type Hittable } from '../geometry';
import { drawScene, subPositions, type ImminentLaunch } from '../map-renderer';
import { badgeCenter, orderMarkers } from '../overlays';
import { ICON_RADIUS, drawBattleIcons, iconCenter, type BattleIcon } from '../battle-icons';
import { sameSelection, type Selection } from '../selection';

/** Pixels the pointer may move before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;
/** Click tolerance around targets, in screen pixels. */
const HIT_RADIUS_PX = 16;
/** Ghost routes are thin, so they need a tighter tolerance than points. */
const ROUTE_HIT_PX = 6;

/**
 * Canvas map of the game. Draws `view` (outposts, sonar, subs moving in real
 * time, your pending orders), supports drag-to-pan and wheel/button zoom, and
 * reports what was clicked. Redraws only when something changed or subs are
 * moving.
 *
 * Click priority when targets overlap: battle icons, order badges, then subs,
 * then outposts, then ghost routes. Subs sit on top of outposts while leaving or
 * arriving, and outposts stay reachable from the sidebar list, so the
 * smaller, moving target wins.
 */
@Component({
  selector: 'sub-game-map',
  template: `
    <canvas
      #canvas
      role="img"
      [attr.aria-label]="summary()"
      [style.cursor]="hover() ? 'pointer' : dragging() ? 'grabbing' : 'grab'"
    ></canvas>
    <div class="controls">
      <button type="button" (click)="zoomBy(1.4)" aria-label="Zoom in">+</button>
      <button type="button" (click)="zoomBy(1 / 1.4)" aria-label="Zoom out">−</button>
      <button type="button" (click)="fit()" aria-label="Fit map to screen">⤢</button>
    </div>
    @if (launchFromId()) {
      <p class="hint" role="status">Click a target outpost · Esc to cancel</p>
    }
  `,
  styles: `
    /* Deep-sea ambience behind the transparent canvas: layered glows plus
       slowly drifting caustic light. CSS only, so it never forces a canvas
       redraw; frozen for prefers-reduced-motion. */
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      min-height: 320px;
      touch-action: none;
      background:
        radial-gradient(ellipse 70% 55% at 20% 15%, rgb(31 94 120 / 0.35), transparent 70%),
        radial-gradient(ellipse 60% 50% at 85% 80%, rgb(20 60 110 / 0.35), transparent 70%),
        radial-gradient(ellipse 90% 70% at 50% 110%, rgb(2 8 16 / 0.9), transparent 70%),
        linear-gradient(180deg, #0a1d2c 0%, #061220 60%, #040c16 100%);
    }
    :host::before,
    :host::after {
      content: '';
      position: absolute;
      inset: -20%;
      pointer-events: none;
      background:
        radial-gradient(circle at 30% 40%, rgb(120 220 230 / 0.05) 0 8%, transparent 9%),
        radial-gradient(circle at 70% 30%, rgb(120 220 230 / 0.04) 0 6%, transparent 7%),
        radial-gradient(circle at 55% 75%, rgb(120 220 230 / 0.05) 0 10%, transparent 11%);
      background-size: 420px 380px;
      filter: blur(18px);
      animation: drift 60s linear infinite alternate;
    }
    :host::after {
      background-size: 300px 340px;
      animation-duration: 85s;
      animation-direction: alternate-reverse;
      opacity: 0.8;
    }
    @keyframes drift {
      from { transform: translate3d(0, 0, 0); }
      to { transform: translate3d(6%, 4%, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      :host::before,
      :host::after {
        animation: none;
      }
    }
    canvas {
      position: absolute;
      z-index: 1;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    .controls {
      position: absolute;
      z-index: 2;
      right: 12px;
      top: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .controls button {
      width: 36px;
      height: 36px;
      padding: 0;
      font-size: 1.1rem;
    }
    .hint {
      position: absolute;
      z-index: 2;
      left: 50%;
      /* Top, not bottom: the bottom edge is where you aim at targets near the time bar. */
      top: 12px;
      pointer-events: none;
      transform: translateX(-50%);
      margin: 0;
      padding: 6px 12px;
      border-radius: var(--radius);
      background: var(--surface-2);
      border: 1px solid var(--accent);
      white-space: nowrap;
    }
  `,
})
export class GameMap {
  readonly view = input.required<PlayerView>();
  readonly clock = input.required<ClockSync>();
  readonly selection = input<Selection | null>(null);
  readonly pending = input<readonly PendingOrder[]>([]);
  readonly launchFromId = input<string | null>(null);
  readonly launchTargetId = input<string | null>(null);
  /** Enemy launches about to happen. */
  readonly imminent = input<readonly ImminentLaunch[]>([]);
  /** Predicted fights to mark on the map. */
  readonly battles = input<readonly BattleIcon[]>([]);
  /** Show this game minute instead of the live clock (time machine). */
  readonly fixedMinute = input<number | null>(null);
  /** When a planned launch would leave, if not "after the launch delay". */
  readonly launchAt = input<number | undefined>(undefined);

  /** Something was clicked (or `null` for empty water). */
  readonly pick = output<Selection | null>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly hover = signal<Selection | null>(null, { equal: sameSelection });
  protected readonly dragging = signal(false);
  private readonly camera = signal<Camera | null>(null);
  private readonly viewport = signal<Viewport>({ width: 0, height: 0 });

  protected readonly summary = computed(() => {
    const view = this.view();
    const mine = view.outposts.filter((o) => o.owner === view.you).length;
    const yourSubs = view.subs.filter((s) => s.owner === view.you).length;
    return `Game map: ${view.outposts.length} outposts, ${mine} yours, ${view.subs.length} subs visible (${yourSubs} yours). Use the outpost list to select outposts with the keyboard.`;
  });

  private frame = 0;
  private dpr = 1;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const resize = new ResizeObserver(() => this.onResize());
      resize.observe(this.host.nativeElement);
      this.onResize();

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), this.localPoint(e));
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      this.attachPointer(canvas);

      destroyRef.onDestroy(() => {
        resize.disconnect();
        canvas.removeEventListener('wheel', onWheel);
        cancelAnimationFrame(this.frame);
      });
    });

    // Fit once, when we first know both the map and the viewport size.
    effect(() => {
      const viewport = this.viewport();
      if (viewport.width === 0 || untracked(() => this.camera())) return;
      this.camera.set(this.initialCamera(this.view(), viewport));
    });

    // Redraw whenever any input or interaction state changes.
    effect(() => {
      this.view();
      this.clock();
      this.camera();
      this.viewport();
      this.selection();
      this.pending();
      this.launchFromId();
      this.launchTargetId();
      this.battles();
      this.imminent();
      this.fixedMinute();
      this.launchAt();
      this.hover();
      this.requestDraw();
    });
  }

  protected zoomBy(factor: number, anchor?: Point): void {
    const camera = this.camera();
    if (!camera) return;
    const viewport = this.viewport();
    this.camera.set(zoomAt(camera, viewport, anchor ?? { x: viewport.width / 2, y: viewport.height / 2 }, factor));
  }

  protected fit(): void {
    this.camera.set(fitPoints(this.view().outposts.map((o) => o.position), this.viewport()));
  }

  private initialCamera(view: PlayerView, viewport: Viewport): Camera {
    const fitted = fitPoints(view.outposts.map((o) => o.position), viewport);
    const mine = view.outposts.filter((o) => o.owner === view.you);
    if (mine.length === 0) return fitted;
    const center = {
      x: mine.reduce((sum, o) => sum + o.position.x, 0) / mine.length,
      y: mine.reduce((sum, o) => sum + o.position.y, 0) / mine.length,
    };
    return { center, scale: fitted.scale * 1.3 };
  }

  private onResize(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas().nativeElement;
    canvas.width = Math.round(rect.width * this.dpr);
    canvas.height = Math.round(rect.height * this.dpr);
    this.viewport.set({ width: rect.width, height: rect.height });
  }

  private requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const camera = this.camera();
      const ctx = this.canvas().nativeElement.getContext('2d');
      if (!camera || !ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const fixed = this.fixedMinute();
      const minute = fixed ?? gameMinuteAt(this.clock(), Date.now());
      const moving = drawScene(ctx, {
        view: this.view(),
        camera,
        viewport: this.viewport(),
        minute,
        selection: this.selection(),
        hover: this.hover(),
        launchFromId: this.launchFromId(),
        launchTargetId: this.launchTargetId(),
        launchAt: this.launchAt(),
        imminent: this.imminent(),
        markers: orderMarkers(this.view(), this.pending(), minute),
      });
      const selection = this.selection();
      drawBattleIcons(ctx, this.battles(), camera, this.viewport(), selection?.kind === 'battle' ? selection.id : null);
      // Keep animating while subs are travelling (the time machine drives
      // its own redraws through `fixedMinute`).
      if (moving && fixed === null) this.requestDraw();
    });
  }

  private localPoint(e: MouseEvent): Point {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** What's under a screen point, in click-priority order (see class doc). */
  private targetAt(screenPoint: Point): Selection | null {
    const camera = this.camera();
    if (!camera) return null;
    const viewport = this.viewport();
    const view = this.view();
    const screen = (p: Point) => toScreen(camera, viewport, p);
    const outposts: Hittable<Selection>[] = view.outposts.map((o) => ({ value: { kind: 'outpost', id: o.id }, at: screen(o.position) }));
    // While picking a launch target only outposts matter.
    if (this.launchFromId()) return pick([outposts], screenPoint, HIT_RADIUS_PX) ?? null;

    const minute = this.fixedMinute() ?? gameMinuteAt(this.clock(), Date.now());
    const markers = orderMarkers(view, this.pending(), minute);
    const battles: Hittable<Selection>[] = this.battles().map((b) => ({
      value: { kind: 'battle', id: b.key },
      at: iconCenter(b, camera, viewport),
    }));
    const stacked = new Map<string, number>();
    const badges: Hittable<Selection>[] = markers.map((m) => {
      const key = `${m.kind}:${m.anchor.x},${m.anchor.y}`;
      const index = stacked.get(key) ?? 0;
      stacked.set(key, index + 1);
      return { value: { kind: 'order', id: m.orderId }, at: badgeCenter(m, camera, viewport, index) };
    });
    const subs: Hittable<Selection>[] = [...subPositions(view, minute)].map(([id, at]) => ({
      value: { kind: 'sub', id },
      at: screen(at),
    }));
    const routes: Hittable<Selection>[] = markers
      .filter((m) => m.target)
      .map((m) => ({ value: { kind: 'order', id: m.orderId }, from: screen(m.anchor), to: screen(m.target!) }));
    return (
      pick([battles], screenPoint, ICON_RADIUS + 4) ??
      pick([badges, subs, outposts], screenPoint, HIT_RADIUS_PX) ??
      pick([routes], screenPoint, ROUTE_HIT_PX) ??
      null
    );
  }

  private attachPointer(canvas: HTMLCanvasElement): void {
    let start: Point | null = null;
    let last: Point | null = null;
    let moved = false;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      start = last = this.localPoint(e);
      moved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      if (start && last) {
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_THRESHOLD) {
          moved = true;
          this.dragging.set(true);
        }
        if (moved) {
          const camera = this.camera();
          if (camera) this.camera.set(pan(camera, p.x - last.x, p.y - last.y));
        }
        last = p;
        return;
      }
      this.hover.set(this.targetAt(p));
    });
    const end = (e: PointerEvent, click: boolean) => {
      if (click && start && !moved) this.pick.emit(this.targetAt(this.localPoint(e)));
      start = last = null;
      moved = false;
      this.dragging.set(false);
    };
    canvas.addEventListener('pointerup', (e) => end(e, true));
    canvas.addEventListener('pointercancel', (e) => end(e, false));
    canvas.addEventListener('pointerleave', () => {
      if (!start) this.hover.set(null);
    });
  }
}
