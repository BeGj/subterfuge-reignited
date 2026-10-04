import type { Point } from '@subterfuge/engine';

/** Map → screen transform: screen = (map − centre) × scale + viewport centre. */
export interface Camera {
  /** Map point shown at the centre of the viewport. */
  center: Point;
  /** Screen pixels per map unit. */
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 2;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toScreen(camera: Camera, viewport: Viewport, p: Point): Point {
  return {
    x: (p.x - camera.center.x) * camera.scale + viewport.width / 2,
    y: (p.y - camera.center.y) * camera.scale + viewport.height / 2,
  };
}

export function toMap(camera: Camera, viewport: Viewport, p: Point): Point {
  return {
    x: (p.x - viewport.width / 2) / camera.scale + camera.center.x,
    y: (p.y - viewport.height / 2) / camera.scale + camera.center.y,
  };
}

/** Camera that shows all `points` with `padding` screen pixels around them. */
export function fitPoints(points: readonly Point[], viewport: Viewport, padding = 48): Camera {
  if (points.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { center: { x: 0, y: 0 }, scale: 0.1 };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    scale: clampScale(Math.min(availW / w, availH / h)),
  };
}

/** Zooms by `factor` keeping the map point under `anchor` (screen) fixed. */
export function zoomAt(camera: Camera, viewport: Viewport, anchor: Point, factor: number): Camera {
  const scale = clampScale(camera.scale * factor);
  const before = toMap(camera, viewport, anchor);
  const next = { center: camera.center, scale };
  const after = toMap(next, viewport, anchor);
  return {
    scale,
    center: { x: camera.center.x + before.x - after.x, y: camera.center.y + before.y - after.y },
  };
}

/** Moves the camera so content follows a drag of (dx, dy) screen pixels. */
export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, center: { x: camera.center.x - dx / camera.scale, y: camera.center.y - dy / camera.scale } };
}
