import {
  useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { camera, type CameraState, type Point, type Rect } from './camera';
import { createGrid } from './grid';
import { attachNavigation } from './input';
import { useUi } from '../board/ui';

const viewKey = (id: string) => `heist:view:${id}`;

function loadView(id: string): CameraState | null {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(id)) ?? 'null');
    if (v && [v.x, v.y, v.z].every(Number.isFinite)) return v;
  } catch {}
  return null;
}

function saveView(id: string) {
  try {
    localStorage.setItem(viewKey(id), JSON.stringify({ x: camera.x, y: camera.y, z: camera.z }));
  } catch {}
}

interface Props {
  children: ReactNode;
  /** Each view (board) remembers its own camera position. */
  viewId: string;
  /** Content bounds the camera stays near. */
  limit: () => Rect | null;
  /** Called on a first visit to a view, to frame its content. */
  frame: () => void;
  onPointerWorld?: (p: Point) => void;
  /** Left press on empty canvas (mouse/pen; touch pans). */
  onBackgroundPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Right-click on empty canvas. */
  onBackgroundContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export function Canvas({ children, viewId, limit, frame, onPointerWorld, onBackgroundPointerDown, onBackgroundContextMenu }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewIdRef = useRef(viewId);
  viewIdRef.current = viewId;
  const spaceDown = useUi((s) => s.spaceDown);
  const panning = useUi((s) => s.panning);

  // Camera -> DOM, batched to one write per frame, never through React.
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const world = worldRef.current!;
    const grid = createGrid(gridRef.current!);

    let raf = 0;
    let saveTimer = 0;
    const render = () => {
      raf = 0;
      world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})`;
      grid.render(camera);
      clearTimeout(saveTimer);
      const id = viewIdRef.current;
      saveTimer = window.setTimeout(() => saveView(id), 250);
    };
    const unsubscribe = camera.subscribe(() => { if (!raf) raf = requestAnimationFrame(render); });

    const syncOrigin = () => {
      const r = viewport.getBoundingClientRect();
      camera.origin = { x: r.left, y: r.top };
      camera.width = r.width;
      camera.height = r.height;
    };
    syncOrigin();
    window.addEventListener('resize', syncOrigin);

    // The app is a fixed full-window layout; the page itself must never scroll.
    const pinPage = () => {
      const root = document.getElementById('root');
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      if (root && (root.scrollTop || root.scrollLeft)) root.scrollTop = root.scrollLeft = 0;
    };
    document.addEventListener('scroll', pinPage, true);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      clearTimeout(saveTimer);
      window.removeEventListener('resize', syncOrigin);
      document.removeEventListener('scroll', pinPage, true);
      grid.dispose();
    };
  }, []);

  useLayoutEffect(() => {
    camera.limit = limit;
    return () => { camera.limit = null; };
  }, [limit]);

  // Switching views: restore that view's camera (or frame its content) and
  // fade the new content in. Children's layout effects have already run, so
  // items are mounted and measured by now.
  useLayoutEffect(() => {
    const saved = loadView(viewId);
    if (saved) camera.set(saved);
    else frame();
    worldRef.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    return () => saveView(viewId);
  }, [viewId]);

  useEffect(() => attachNavigation(viewportRef.current!, onPointerWorld), [onPointerWorld]);

  // Only the bare canvas counts as "background", not cards or their children.
  const isBackground = (t: EventTarget) =>
    t === viewportRef.current || t === gridRef.current || t === worldRef.current;

  return (
    <div
      ref={viewportRef}
      className="viewport"
      data-space={spaceDown}
      data-panning={panning}
      // It's overflow:hidden, but browsers still scroll it to reveal focused
      // or selected content, which shifts the whole canvas. Undo that.
      onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; }}
      onPointerDown={(e) => {
        if (e.button !== 0 || !isBackground(e.target) || spaceDown || e.pointerType === 'touch') return;
        onBackgroundPointerDown?.(e);
      }}
      onContextMenu={(e) => {
        if (isBackground(e.target)) onBackgroundContextMenu?.(e);
      }}
    >
      <div ref={gridRef} className="grid" aria-hidden="true" />
      <div ref={worldRef} className="world">{children}</div>
    </div>
  );
}
