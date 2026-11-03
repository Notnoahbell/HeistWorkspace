// Camera: maps world space <-> screen space.
//   screen = world * z + (x, y)
// x/y are the screen-space position of the world origin, z is the zoom.
// The camera is deliberately outside React: it changes every frame while
// panning, and only a handful of things (world transform, grid, HUD) need it.

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export interface Point { x: number; y: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * How far past the content the view may wander, as a fraction of half the
 * viewport: 0.6 keeps at least ~20% of the screen over content.
 */
const SLACK = 0.6;
export interface CameraState { x: number; y: number; z: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Listener = () => void;

class Camera implements CameraState {
  x = 0;
  y = 0;
  z = 1;
  /** Bumped on every change; lets React subscribe via useSyncExternalStore. */
  version = 0;
  /** Viewport element offset on the page and its size, set by the canvas. */
  origin: Point = { x: 0, y: 0 };
  width = 0;
  height = 0;

  /** World-space content bounds the view is kept near; null = unbounded. */
  limit: (() => Rect | null) | null = null;

  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private changed() {
    this.constrain();
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Keep the view centre within the content bounds plus some slack. */
  private constrain() {
    const b = this.limit?.();
    if (!b || !this.width || !this.height) return;
    const halfW = this.width / 2 / this.z;
    const halfH = this.height / 2 / this.z;
    const cx = clamp((this.width / 2 - this.x) / this.z, b.x0 - halfW * SLACK, b.x1 + halfW * SLACK);
    const cy = clamp((this.height / 2 - this.y) / this.z, b.y0 - halfH * SLACK, b.y1 + halfH * SLACK);
    this.x = this.width / 2 - cx * this.z;
    this.y = this.height / 2 - cy * this.z;
  }

  /** Re-apply the bounds (e.g. after the content changed). */
  refresh() { this.changed(); }

  screenToWorld(sx: number, sy: number): Point {
    return { x: (sx - this.x) / this.z, y: (sy - this.y) / this.z };
  }

  worldToScreen(wx: number, wy: number): Point {
    return { x: wx * this.z + this.x, y: wy * this.z + this.y };
  }

  /** Page (clientX/Y) coordinates -> world coordinates. */
  clientToWorld(cx: number, cy: number): Point {
    return this.screenToWorld(cx - this.origin.x, cy - this.origin.y);
  }

  panBy(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    this.changed();
  }

  /** Zoom so the world point under (sx, sy) stays under (sx, sy). */
  zoomAt(sx: number, sy: number, nextZ: number) {
    nextZ = clamp(nextZ, MIN_ZOOM, MAX_ZOOM);
    if (nextZ === this.z) return;
    const w = this.screenToWorld(sx, sy);
    this.z = nextZ;
    this.x = sx - w.x * nextZ;
    this.y = sy - w.y * nextZ;
    this.changed();
  }

  /** Centre world point (wx, wy) in a viewport of the given size. */
  centerOn(wx: number, wy: number, z: number, width: number, height: number) {
    this.z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.x = width / 2 - wx * this.z;
    this.y = height / 2 - wy * this.z;
    this.changed();
  }

  set(state: CameraState) {
    this.x = state.x;
    this.y = state.y;
    this.z = clamp(state.z, MIN_ZOOM, MAX_ZOOM);
    this.changed();
  }
}

export const camera = new Camera();
