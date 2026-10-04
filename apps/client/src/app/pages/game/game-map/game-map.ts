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
import type { PlayerView, Point } from '@subterfuge/engine';
import { fitPoints, pan, toMap, zoomAt, type Camera, type Viewport } from '../camera';
import { gameMinuteAt, type ClockSync } from '../clock';
import { hitTestOutpost } from '../geometry';
import { drawScene } from '../map-renderer';

/** Pixels the pointer may move before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;
/** Click tolerance around an outpost, in screen pixels. */
const HIT_RADIUS_PX = 16;

/**
 * Canvas map of the game. Draws `view` (outposts, sonar, subs moving in real
 * time), supports drag-to-pan and wheel/button zoom, and reports clicks on
 * outposts. Redraws only when something changed or subs are moving.
 */
@Component({
  selector: 'sub-game-map',
  template: `
    <canvas
      #canvas
      role="img"
      [attr.aria-label]="summary()"
      [style.cursor]="hoverId() ? 'pointer' : dragging() ? 'grabbing' : 'grab'"
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
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      min-height: 320px;
      touch-action: none;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    .controls {
      position: absolute;
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
      left: 50%;
      bottom: 12px;
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
  readonly selectedId = input<string | null>(null);
  readonly launchFromId = input<string | null>(null);
  readonly launchTargetId = input<string | null>(null);

  /** An outpost was clicked (or `null` for empty water). */
  readonly outpostClick = output<string | null>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly hoverId = signal<string | null>(null);
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
      this.selectedId();
      this.launchFromId();
      this.launchTargetId();
      this.hoverId();
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
      const moving = drawScene(ctx, {
        view: this.view(),
        camera,
        viewport: this.viewport(),
        minute: gameMinuteAt(this.clock(), Date.now()),
        selectedId: this.selectedId(),
        hoverId: this.hoverId(),
        launchFromId: this.launchFromId(),
        launchTargetId: this.launchTargetId(),
      });
      // Keep animating while subs are travelling.
      if (moving) this.requestDraw();
    });
  }

  private localPoint(e: MouseEvent): Point {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private outpostAt(screenPoint: Point): string | null {
    const camera = this.camera();
    if (!camera) return null;
    const mapPoint = toMap(camera, this.viewport(), screenPoint);
    return hitTestOutpost(this.view().outposts, mapPoint, HIT_RADIUS_PX / camera.scale)?.id ?? null;
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
      this.hoverId.set(this.outpostAt(p));
    });
    const end = (e: PointerEvent, click: boolean) => {
      if (click && start && !moved) this.outpostClick.emit(this.outpostAt(this.localPoint(e)));
      start = last = null;
      moved = false;
      this.dragging.set(false);
    };
    canvas.addEventListener('pointerup', (e) => end(e, true));
    canvas.addEventListener('pointercancel', (e) => end(e, false));
    canvas.addEventListener('pointerleave', () => {
      if (!start) this.hoverId.set(null);
    });
  }
}
