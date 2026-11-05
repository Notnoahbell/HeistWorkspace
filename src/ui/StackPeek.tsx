// A look inside a video's version stack: hold Alt while hovering a stacked
// card and its versions fan out in a small folder-like panel beside it. Click
// versions to pick several; drag one (or the picked ones) out onto the board to
// unstack them into cards of their own.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Layers } from 'lucide-react';
import { useBoard, type Media } from '../board/store';
import { useUi } from '../board/ui';
import { subscribeBoard } from '../board/nav';
import { snap } from '../board/layout';
import { isVideo, statusInfo, unstackVersions, versionList, type VersionInfo } from '../board/versions';
import { camera } from '../canvas/camera';
import { StatusDot } from './StatusPicker';

const PANEL_GAP = 10;
/** How far the pointer may stray from the card and panel before it closes. */
const SLACK = 14;
const DRAG_START = 4;

/** The stacked video card under a screen point, if any. */
function stackAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-media-id]');
  const id = el?.dataset.mediaId;
  const it = id ? useBoard.getState().items[id] : undefined;
  return isVideo(it) && it.versions?.length ? it.id : null;
}

const cardEl = (id: string) => document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(id)}"] .media`);
const inside = (r: DOMRect, x: number, y: number, pad: number) =>
  x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

export function StackPeek() {
  const [peekId, setPeekId] = useState<string | null>(null);
  const pointer = useRef({ x: -1, y: -1 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** Alt opened the peek during this press (so its release doesn't focus the browser menu). */
  const usedAlt = useRef(false);

  useEffect(() => {
    const tryOpen = () => {
      const ui = useUi.getState();
      if (ui.dragId || ui.viewer || ui.wall) return false;
      const id = stackAt(pointer.current.x, pointer.current.y);
      if (id) setPeekId(id);
      return !!id;
    };
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (dragging.current) return;
      if (e.altKey && !e.buttons && tryOpen()) return;
      // Strayed away from both the card and the panel: close.
      setPeekId((id) => {
        if (!id) return id;
        const card = cardEl(id)?.getBoundingClientRect();
        const panel = panelRef.current?.getBoundingClientRect();
        const near = (card && inside(card, e.clientX, e.clientY, SLACK)) || (panel && inside(panel, e.clientX, e.clientY, SLACK));
        return near ? id : null;
      });
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.repeat && tryOpen()) { e.preventDefault(); usedAlt.current = true; }
      if (e.key === 'Escape') setPeekId(null);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && usedAlt.current) { e.preventDefault(); usedAlt.current = false; }
    };
    const close = () => { if (!dragging.current) setPeekId(null); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('wheel', close, { passive: true, capture: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    const offBoard = subscribeBoard(() => setPeekId(null));
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      offBoard();
    };
  }, []);

  const media = useBoard((s) => (peekId ? s.items[peekId] : undefined));
  // Unstacked down to one (or gone, or picked up): nothing left to show.
  const dragId = useUi((s) => s.dragId);
  const live = isVideo(media) && !!media.versions?.length && !dragId;
  useEffect(() => { if (peekId && !live) setPeekId(null); }, [peekId, live]);
  if (!peekId || !live) return null;
  return <Panel key={peekId} media={media as Media} panelRef={panelRef} dragging={dragging} />;
}

interface Drag { ns: number[]; v: VersionInfo; x: number; y: number }

function Panel({ media, panelRef, dragging }: {
  media: Media;
  panelRef: React.RefObject<HTMLDivElement | null>;
  dragging: React.MutableRefObject<boolean>;
}) {
  const versions = versionList(media);
  const [picked, setPicked] = useState<number[]>([]);
  const [at, setAt] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Beside the card: under it, or above when there's no room.
  useLayoutEffect(() => {
    const card = cardEl(media.id)?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!card || !panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const below = card.bottom + PANEL_GAP + h + 8 < window.innerHeight || card.top - PANEL_GAP - h < 8;
    setAt({
      left: Math.max(8, Math.min(card.left, window.innerWidth - w - 8)),
      top: below ? card.bottom + PANEL_GAP : card.top - PANEL_GAP - h,
      below,
    });
  }, [media.id, versions.length, panelRef]);

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
      dragging.current = true;
      setDrag({ ns, v, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      dragging.current = false;
      setDrag(null);
      if (!moved) {
        setPicked((p) => (p.includes(v.n) ? p.filter((n) => n !== v.n) : [...p, v.n]));
        return;
      }
      if (ev.type === 'pointercancel') return;
      // Let go over the panel (or the card itself): nothing happens.
      const panel = panelRef.current?.getBoundingClientRect();
      const card = cardEl(media.id)?.getBoundingClientRect();
      if ((panel && inside(panel, ev.clientX, ev.clientY, 0)) || (card && inside(card, ev.clientX, ev.clientY, 0))) return;
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

  const all = versions.length;
  const pulling = drag ? Math.min(drag.ns.length, all - 1) : 0;

  return createPortal(
    <>
      <div
        ref={panelRef}
        className="stack-peek"
        data-below={at?.below || undefined}
        role="dialog"
        aria-label={`Versions of ${media.name}`}
        style={at ? { left: at.left, top: at.top } : { visibility: 'hidden', left: 0, top: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="stack-peek-head">
          <Layers size={14} strokeWidth={2} aria-hidden="true" />
          <span className="stack-peek-title">{all} versions</span>
          <span className="stack-peek-hint">
            {picked.length ? `${picked.length} picked · drag out to unstack` : 'Click to pick · drag out to unstack'}
          </span>
        </div>
        <div className="stack-peek-grid">
          {versions.map((v) => (
            <button
              key={v.n}
              className="stack-peek-tile"
              data-picked={picked.includes(v.n) || undefined}
              data-pulling={drag?.ns.includes(v.n) || undefined}
              aria-pressed={picked.includes(v.n)}
              title={`${v.label || v.name}${v.current ? '\nCurrent version' : ''}`}
              onPointerDown={(e) => startDrag(e, v)}
            >
              <span className="stack-peek-thumb">
                <Thumb v={v} />
                <span className="stack-peek-n">v{v.n}</span>
                {statusInfo(v.status) && <span className="stack-peek-status"><StatusDot value={v.status} /></span>}
              </span>
              <span className="stack-peek-name">{v.label || v.name}</span>
              {v.current && <span className="stack-peek-cur">Current</span>}
            </button>
          ))}
        </div>
      </div>
      {drag && (
        <div className="stack-peek-ghost" style={{ left: drag.x, top: drag.y } as CSSProperties} aria-hidden="true">
          <span className="stack-peek-thumb"><Thumb v={drag.v} /></span>
          {pulling > 1 && <span className="stack-peek-count">{pulling}</span>}
        </div>
      )}
    </>,
    document.body,
  );
}

function Thumb({ v }: { v: VersionInfo }) {
  if (v.meta.poster) return <img src={v.meta.poster} alt="" draggable={false} />;
  return <video src={`${v.src}#t=0.1`} preload="metadata" muted playsInline />;
}
