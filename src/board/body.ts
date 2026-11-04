// Physical behaviour for board items: inertial dragging with a lifted,
// tilting "held" state, throw-and-glide, grid-snapped landings, and springy
// moves to new resting positions (e.g. when a column reflows).
//
// Bodies write straight to the DOM in a rAF loop; React and the store only
// hear about the final resting position. Item-specific behaviour (drop
// targets, commits) is supplied through hooks.

import { camera, type Point } from '../canvas/camera';
import { snap } from './layout';
import { useUi } from './ui';

const FOLLOW = 90; // spring rate toward the pointer while held (1/s)
const HOME = 60; // spring rate toward a new resting position (1/s)
const FRICTION = 22; // glide decay after a throw (1/s)
const MAX_THROW = 1600; // world units/s
const GLIDE_TO_SPRING = 160; // world units/s: below this a glide finishes on the spring
const MIN_THROW = 700; // slower releases just settle where they are
const TILT_PER_PX_S = 0.01; // degrees of tilt per screen px/s
const MAX_TILT = 12; // degrees
const TILT_RESPONSE = 24; // 1/s
const LIFT_RESPONSE = 40; // 1/s
const LIFT_SCALE = 0.015;
const SHRINK_SCALE = 0.55; // how much smaller a dragged item gets over a board it'll drop into
const SHRINK_FADE = 0.3;
const SHRINK_RESPONSE = 18; // 1/s
const DRAG_THRESHOLD = 2; // screen px before a press becomes a drag
const SAMPLE_WINDOW = 80; // ms of pointer history used to measure a throw
const MOUNT_GRACE = 100; // ms after mount during which rest changes jump instead of animate

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const approach = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

/**
 * Shadow layers [x, y, blur, alpha] for a lift amount (0 = resting). At 0
 * they must match the items' CSS shadows so release doesn't pop.
 */
function shadowLayers(lift: number, rx: number, ry: number): [number, number, number, number][] {
  return [
    [-ry * 0.8 * lift, 1 + 14 * lift + rx * 0.5 * lift, 3 + 34 * lift, 0.1 + 0.14 * lift],
    [0, 0.5 + 2 * lift, 1 + 4 * lift, 0.08],
  ];
}

const boxShadow = (layers: [number, number, number, number][]) =>
  layers.map(([x, y, b, a]) => `${x.toFixed(1)}px ${y.toFixed(2)}px ${b.toFixed(1)}px rgb(0 0 0 / ${a.toFixed(3)})`).join(', ');

// drop-shadow follows the element's real outline (e.g. a clip-path); its blur
// is a standard deviation, roughly half a box-shadow blur radius.
const dropShadow = (layers: [number, number, number, number][]) =>
  layers.map(([x, y, b, a]) => `drop-shadow(${x.toFixed(1)}px ${y.toFixed(2)}px ${(b / 2).toFixed(2)}px rgb(0 0 0 / ${a.toFixed(3)}))`).join(' ');

export interface BodyHooks {
  /** Pointer went down on the item. */
  grab?(body: Body): void;
  /** Press turned into a drag. */
  dragStart?(body: Body): void;
  /** Pointer moved while dragging (world coords, plus page coords for UI outside the canvas). */
  dragMove?(body: Body, pointer: Point, client: Point): void;
  /**
   * Item was let go. `landing` is where it will come to rest (already
   * snapped if snapping applies). Commit to the store here. Return the final
   * target, or null to wait for the next setRest() (e.g. a column slot).
   */
  release?(body: Body, landing: Point, moved: boolean): Point | null;
  settle?(body: Body): void;
}

/** A body carried rigidly at an offset from its carrier. */
export interface Follower { body: Body; ox: number; oy: number }

export class Body {
  pos: HTMLElement | null = null;
  vis: HTMLElement | null = null;
  /** Where the lift shadow goes, if not on `vis` (e.g. just a board's icon square). */
  shadowEl: (() => HTMLElement | null) | null = null;
  /** Draw the shadow as a filter so it follows a clipped (non-rectangular) shape. */
  shadowAsFilter: (() => boolean) | null = null;

  x = 0; y = 0; // rendered position
  tx = 0; ty = 0; // where we're heading
  vx = 0; vy = 0;
  rx = 0; ry = 0; lift = 0;
  /** 0..1: shrinks toward the pointer while hovering a board it would move into. */
  shrink = 0;
  restX = 0; restY = 0;
  mode: 'idle' | 'held' | 'glide' | 'home' = 'idle';
  moved = false;
  /** Snap landings to the grid (notes in columns don't). */
  snaps = true;

  /** Dragged as part of a multi-selection (followers are the rest of it). */
  multi = false;

  /** Bodies carried along rigidly (a column's contents, the rest of a selection). */
  followers: Follower[] = [];
  /** The body carrying this one, if any. */
  carrier: Body | null = null;
  private groupWidth = 0;
  private groupHeight = 0;

  private mountedAt = 0;
  private pointerId = -1;
  private offX = 0; private offY = 0;
  private downX = 0; private downY = 0;
  private alt = false;
  private samples: { t: number; x: number; y: number }[] = [];
  private frame = 0;
  private last = 0;

  constructor(public id: string, public hooks: BodyHooks) {}

  get active() { return this.mode !== 'idle'; }

  mount(pos: HTMLElement, vis: HTMLElement, at: Point) {
    this.pos = pos;
    this.vis = vis;
    this.mountedAt = performance.now();
    this.restX = this.x = this.tx = at.x;
    this.restY = this.y = this.ty = at.y;
    this.writePos();
  }

  unmount() {
    cancelAnimationFrame(this.frame);
    this.pos = this.vis = null;
  }

  /** The store/layout says this item should rest at (x, y). */
  setRest(x: number, y: number) {
    this.restX = x;
    this.restY = y;
    if (this.carrier || this.mode === 'held') return;

    if (this.mode === 'glide') {
      // Re-aim the glide so it still lands exactly on the new target.
      this.tx = x; this.ty = y;
      this.vx = (x - this.x) * FRICTION;
      this.vy = (y - this.y) * FRICTION;
      return;
    }
    if (performance.now() - this.mountedAt < MOUNT_GRACE || Math.hypot(x - this.x, y - this.y) < 0.5) {
      if (this.mode === 'idle') { this.x = this.tx = x; this.y = this.ty = y; this.writePos(); return; }
    }
    this.tx = x; this.ty = y;
    this.mode = 'home';
    this.start();
  }

  /**
   * Move the point being held, e.g. when the item changes shape under the
   * pointer. The item springs over so the new grip point meets the cursor.
   */
  regrip(offset: Point) {
    const last = this.samples[this.samples.length - 1];
    if (this.mode !== 'held' || !last) return;
    this.offX = offset.x;
    this.offY = offset.y;
    this.tx = last.x - offset.x;
    this.ty = last.y - offset.y;
  }

  /** Position set by a carrying body. */
  place(x: number, y: number) {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.writePos();
  }

  grab(pointerId: number, clientX: number, clientY: number, offset?: Point) {
    const el = this.pos;
    if (!el) return;
    if (this.carrier) this.carrier.drop(this);
    this.hooks.grab?.(this);

    // Catch an item mid-glide where it is, not where it would have landed.
    const w = camera.clientToWorld(clientX, clientY);
    if (offset) { this.x = this.tx = w.x - offset.x; this.y = this.ty = w.y - offset.y; }
    this.offX = w.x - this.x;
    this.offY = w.y - this.y;
    this.tx = this.x; this.ty = this.y;
    this.downX = clientX; this.downY = clientY;
    this.samples = [{ t: performance.now(), x: w.x, y: w.y }];
    this.moved = !!offset; // spawned items are already being dragged
    if (offset) this.lift = 1; // and already lifted, like the preview they replace
    this.mode = 'held';
    this.pointerId = pointerId;

    el.setPointerCapture(pointerId);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    if (this.moved) this.beginDrag();
    this.start();
  }

  private beginDrag() {
    useUi.getState().set({ dragId: this.id, movingId: this.id });
    this.hooks.dragStart?.(this);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.alt = e.altKey;
    if (!this.moved && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
      this.moved = true;
      this.beginDrag();
    }
    const w = camera.clientToWorld(e.clientX, e.clientY);
    this.tx = w.x - this.offX;
    this.ty = w.y - this.offY;
    const t = performance.now();
    this.samples.push({ t, x: w.x, y: w.y });
    while (this.samples.length > 2 && t - this.samples[0].t > SAMPLE_WINDOW) this.samples.shift();
    if (this.moved) this.hooks.dragMove?.(this, w, { x: e.clientX, y: e.clientY });
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const el = this.pos;
    el?.removeEventListener('pointermove', this.onMove);
    el?.removeEventListener('pointerup', this.onUp);
    el?.removeEventListener('pointercancel', this.onUp);
    this.pointerId = -1;

    // Throw velocity from recent pointer history; a pause before release = no throw.
    let vx = 0, vy = 0;
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    const span = (last.t - first.t) / 1000;
    if (e.type === 'pointerup' && this.moved && span > 0 && performance.now() - last.t < 50) {
      vx = clamp((last.x - first.x) / span, MAX_THROW);
      vy = clamp((last.y - first.y) / span, MAX_THROW);
    }
    const throwing = Math.hypot(vx, vy) > MIN_THROW;

    // Where exponential friction would stop it: x + v / FRICTION.
    let land = throwing
      ? { x: this.x + vx / FRICTION, y: this.y + vy / FRICTION }
      : { x: this.tx, y: this.ty };
    if (this.moved && this.snaps && useUi.getState().snap && !this.alt) {
      land = { x: snap(land.x), y: snap(land.y) };
    }

    const target = this.hooks.release?.(this, land, this.moved) ?? null;
    if (useUi.getState().dragId === this.id) useUi.getState().set({ dragId: null });

    if (!target) {
      this.tx = this.restX; this.ty = this.restY;
      this.mode = 'home';
    } else if (throwing) {
      this.tx = target.x; this.ty = target.y;
      this.vx = (target.x - this.x) * FRICTION;
      this.vy = (target.y - this.y) * FRICTION;
      this.mode = 'glide';
    } else {
      this.tx = target.x; this.ty = target.y;
      this.mode = 'home';
    }
  };

  private start() {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    const dt = Math.min(1 / 30, (now - this.last) / 1000) || 1 / 60;
    this.last = now;

    if (this.mode === 'held' || this.mode === 'home') {
      const rate = this.mode === 'held' ? FOLLOW : HOME;
      const nx = approach(this.x, this.tx, rate, dt);
      const ny = approach(this.y, this.ty, rate, dt);
      this.vx = (nx - this.x) / dt;
      this.vy = (ny - this.y) / dt;
      this.x = nx; this.y = ny;
      if (this.mode === 'home' && Math.hypot(this.tx - this.x, this.ty - this.y) < 0.05) {
        this.x = this.tx; this.y = this.ty;
        this.vx = this.vy = 0;
      }
    } else if (this.mode === 'glide') {
      const decay = Math.exp(-FRICTION * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= decay;
      this.vy *= decay;
      // Hand the slow tail to the spring: it closes the last few pixels
      // crisply instead of creeping, and lands exactly on target.
      if (Math.hypot(this.vx, this.vy) < GLIDE_TO_SPRING) this.mode = 'home';
    }

    // Tilt from on-screen velocity: the leading edge dips away from the viewer.
    const sx = this.vx * camera.z, sy = this.vy * camera.z;
    this.ry = approach(this.ry, clamp(sx * TILT_PER_PX_S, MAX_TILT), TILT_RESPONSE, dt);
    this.rx = approach(this.rx, clamp(-sy * TILT_PER_PX_S, MAX_TILT), TILT_RESPONSE, dt);
    // Only lift once it's actually being dragged, so a plain click doesn't bounce.
    this.lift = approach(this.lift, this.mode === 'held' && this.moved ? 1 : 0, LIFT_RESPONSE, dt);
    // Over a board it would drop into (or a video it would become the new version of): get out of the way so the target shows.
    const ui = useUi.getState();
    const intoBoard = this.mode === 'held' && (ui.boardDrop != null || ui.versionDrop != null);
    this.shrink = approach(this.shrink, intoBoard ? 1 : 0, SHRINK_RESPONSE, dt);
    if (!intoBoard && this.shrink < 0.004) this.shrink = 0;

    this.render();

    const resting =
      this.mode === 'home' && this.vx === 0 && this.vy === 0 &&
      this.lift < 0.004 && this.shrink === 0 && Math.abs(this.rx) < 0.05 && Math.abs(this.ry) < 0.05;
    if (resting) this.settle();
    else this.frame = requestAnimationFrame(this.tick);
  };

  private settle() {
    this.mode = 'idle';
    this.rx = this.ry = this.lift = this.shrink = 0;
    if (this.vis) { this.vis.style.transform = ''; this.vis.style.transformOrigin = ''; this.vis.style.opacity = ''; }
    const sh = this.shadowEl?.() ?? this.vis;
    if (sh) { sh.style.boxShadow = ''; sh.style.filter = ''; }
    for (const f of this.followers) f.body.release();
    this.followers = [];
    if (useUi.getState().movingId === this.id) useUi.getState().set({ movingId: null });
    this.hooks.settle?.(this);
  }

  /** Stop being carried; drift to the resting position if it changed meanwhile. */
  release() {
    this.carrier = null;
    if (this.vis) { this.vis.style.transform = ''; this.vis.style.transformOrigin = ''; this.vis.style.opacity = ''; }
    this.setRest(this.restX, this.restY);
  }

  /** Start carrying bodies rigidly at their current offsets. */
  carry(bodies: Body[], groupWidth: number, groupHeight: number) {
    this.followers = bodies.map((b) => {
      cancelAnimationFrame(b.frame);
      b.frame = 0;
      b.mode = 'idle';
      b.carrier = this;
      return { body: b, ox: b.x - this.x, oy: b.y - this.y };
    });
    this.groupWidth = groupWidth;
    this.groupHeight = groupHeight;
  }

  /** Let go of one carried body (e.g. it was grabbed out of the group). */
  drop(b: Body) {
    this.followers = this.followers.filter((f) => f.body !== b);
    b.release();
  }

  private writePos() {
    if (this.pos) this.pos.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
  }

  private render() {
    this.writePos();
    if (!this.vis) return;
    const scale = (1 + LIFT_SCALE * this.lift) * (1 - SHRINK_SCALE * this.shrink);
    const tf =
      `perspective(900px) rotateX(${this.rx.toFixed(2)}deg) rotateY(${this.ry.toFixed(2)}deg) ` +
      `scale(${scale.toFixed(4)})`;
    // Shrinking pivots on the grip so the item stays under the cursor.
    const shrinking = this.shrink > 0;
    const opacity = shrinking ? String(1 - SHRINK_FADE * this.shrink) : '';
    this.vis.style.transformOrigin = shrinking ? `${this.offX}px ${this.offY}px` : '';
    this.vis.style.transform = tf;
    this.vis.style.opacity = opacity;
    const sh = this.shadowEl?.() ?? this.vis;
    const layers = shadowLayers(this.lift, this.rx, this.ry);
    if (this.shadowAsFilter?.()) sh.style.filter = dropShadow(layers);
    else sh.style.boxShadow = boxShadow(layers);

    // Carried bodies share our transform about our centre, so the whole
    // group tilts and lifts as one rigid object.
    for (const f of this.followers) {
      f.body.place(this.x + f.ox, this.y + f.oy);
      if (!f.body.vis) continue;
      f.body.vis.style.transformOrigin = shrinking
        ? `${this.offX - f.ox}px ${this.offY - f.oy}px`
        : `${this.groupWidth / 2 - f.ox}px ${this.groupHeight / 2 - f.oy}px`;
      f.body.vis.style.transform = tf;
      f.body.vis.style.opacity = opacity;
    }
  }
}

/** Live bodies by item id, so items can find and drive each other. */
export const bodies = new Map<string, Body>();
