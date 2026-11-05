// A look inside a video's version stack: while Alt is held over a stacked
// card (and only then), its picture shrinks back to show every version as a tile, right in
// the card. Click tiles to pick several; drag one (or the picked ones) out onto
// the board to unstack them into cards of their own.
//
// StackPeek (mounted once) decides which card is peeking; the card draws
// CardStack inside its own frame, so it zooms and moves with the card.

import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Layers } from 'lucide-react';
import { useBoard, type Media } from '../board/store';
import { useUi } from '../board/ui';
import { subscribeBoard } from '../board/nav';
import { snap } from '../board/layout';
import { isVideo, statusInfo, unstackVersions, versionList, type VersionInfo } from '../board/versions';
import { camera } from '../canvas/camera';
import { StatusDot } from './StatusPicker';

/** The card showing its stack, if any. */
export const usePeek = create<{ id: string | null }>()(() => ({ id: null }));
const setPeek = (id: string | null) => { if (usePeek.getState().id !== id) usePeek.setState({ id }); };

/** How far the pointer may stray from the card before it closes. */
const SLACK = 14;
const DRAG_START = 4;
/** A tile is being dragged out (the peek stays put meanwhile). */
let dragging = false;
/** Alt is held: the peek shows only while it is. */
let altHeld = false;
/** A drag out ended: close too if Alt was let go during it. */
const dragEnded = () => { dragging = false; if (!altHeld) setPeek(null); };

/** The stacked video card under a screen point, if any. */
function stackAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-media-id]');
  const id = el?.dataset.mediaId;
  const it = id ? useBoard.getState().items[id] : undefined;
  return isVideo(it) && it.versions?.length ? it.id : null;
}

const cardRect = (id: string) =>
  document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(id)}"] .media`)?.getBoundingClientRect();
const inside = (r: DOMRect | undefined, x: number, y: number, pad: number) =>
  !!r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

/** Opens and closes the peek: Alt over a stacked card, until the pointer leaves it. */
export function StackPeek() {
  useEffect(() => {
    let px = -1, py = -1;
    /** Alt opened the peek during this press (so its release doesn't focus the browser menu). */
    let usedAlt = false;
    const tryOpen = () => {
      const ui = useUi.getState();
      if (ui.dragId || ui.viewer || ui.wall) return false;
      const id = stackAt(px, py);
      if (id) setPeek(id);
      return !!id;
    };
    const move = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY;
      if (dragging) return;
      altHeld = e.altKey;
      if (!e.altKey) { setPeek(null); return; }
      if (!e.buttons && tryOpen()) return;
      const id = usePeek.getState().id;
      if (id && !inside(cardRect(id), px, py, SLACK)) setPeek(null);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') altHeld = true;
      if (e.key === 'Alt' && !e.repeat && tryOpen()) { e.preventDefault(); usedAlt = true; }
      if (e.key === 'Escape' && !dragging) setPeek(null);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      altHeld = false;
      if (usedAlt) { e.preventDefault(); usedAlt = false; }
      if (!dragging) setPeek(null);
    };
    const close = () => { altHeld = false; if (!dragging) setPeek(null); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', close);
    const offBoard = subscribeBoard(close);
    // Unstacked down to one, gone, or picked up and dragged: nothing left to show.
    const offItems = useBoard.subscribe((s) => {
      const id = usePeek.getState().id;
      const it = id ? s.items[id] : undefined;
      if (id && !(isVideo(it) && it.versions?.length)) setPeek(null);
    });
    const offUi = useUi.subscribe((s) => { if (s.dragId) setPeek(null); });
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', close);
      offBoard(); offItems(); offUi();
    };
  }, []);
  return null;
}

interface Drag { ns: number[]; v: VersionInfo; x: number; y: number }

/** The versions, drawn over the card's (shrunk) picture. */
export function CardStack({ media }: { media: Media }) {
  const versions = versionList(media);
  const [picked, setPicked] = useState<number[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Drop the picks of versions that have gone.
  useEffect(() => { setPicked((p) => p.filter((n) => n <= versions.length)); }, [versions.length]);

  const startDrag = (e: React.PointerEvent, v: VersionInfo) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ns = picked.includes(v.n) ? picked : [v.n];
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START) return;
      moved = true;
      dragging = true;
      setDrag({ ns, v, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      setDrag(null);
      if (moved) dragEnded(); else dragging = false;
      if (!moved) {
        setPicked((p) => (p.includes(v.n) ? p.filter((n) => n !== v.n) : [...p, v.n]));
        return;
      }
      // Let go over the card itself (or cancelled): nothing happens.
      if (ev.type === 'pointercancel' || inside(cardRect(media.id), ev.clientX, ev.clientY, 0)) return;
      const w = camera.clientToWorld(ev.clientX, ev.clientY);
      const ui = useUi.getState();
      let p = { x: w.x - media.w / 2, y: w.y - 24 };
      if (ui.snap) p = { x: snap(p.x), y: snap(p.y) };
      const ids = unstackVersions(media.id, ns, p);
      if (!ids.length) return;
      setPicked([]);
      ui.set({
        selectedIds: ids, editingId: null,
        toast: { text: ids.length === 1 ? 'Unstacked 1 version' : `Unstacked ${ids.length} versions`, at: Date.now() },
      });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };

  const pulling = drag ? Math.min(drag.ns.length, versions.length - 1) : 0;
  // Its own presses and clicks don't drag, select or open the card underneath.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="card-stack"
      role="group"
      aria-label={`Versions of ${media.name}`}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="card-stack-head">
        <Layers size={11} strokeWidth={2.4} aria-hidden="true" />
        <span>{versions.length} versions</span>
        <span className="card-stack-hint">{picked.length ? `${picked.length} picked · drag out` : 'Drag out to unstack'}</span>
      </div>
      <div className="card-stack-grid">
        {versions.map((v, i) => (
          <div
            key={v.n}
            role="button"
            tabIndex={-1}
            className="card-stack-tile"
            data-picked={picked.includes(v.n) || undefined}
            data-pulling={drag?.ns.includes(v.n) || undefined}
            aria-pressed={picked.includes(v.n)}
            title={`${v.label || v.name}${v.current ? '\nCurrent version' : ''}`}
            style={{ '--i': i } as CSSProperties}
            onPointerDown={(e) => startDrag(e, v)}
          >
            <span className="card-stack-thumb">
              <Thumb v={v} />
              <span className="card-stack-n">v{v.n}</span>
              {statusInfo(v.status) && <span className="card-stack-status"><StatusDot value={v.status} /></span>}
            </span>
            <span className="card-stack-name">{v.label || v.name}</span>
          </div>
        ))}
      </div>
      {drag && createPortal(
        <div className="stack-peek-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="card-stack-thumb"><Thumb v={drag.v} /></span>
          {pulling > 1 && <span className="stack-peek-count">{pulling}</span>}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Thumb({ v }: { v: VersionInfo }) {
  if (v.meta.poster) return <img src={v.meta.poster} alt="" draggable={false} />;
  return <video src={`${v.src}#t=0.1`} preload="metadata" muted playsInline />;
}
