import { memo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useBoard } from './store';
import { useUi } from './ui';
import { useBody, useLiftedZ } from './useBody';
import { itemHooks } from './actions';
import { snap } from './layout';
import { camera } from '../canvas/camera';
import { isLight } from '../lib/color';

const MIN_W = 160;
const MIN_H = 96;

/**
 * A frame: a titled, tinted box behind things that groups them loosely.
 * Drag it and whatever sits wholly inside comes along; drag its bottom-right
 * corner to resize it. Frames always sit behind everything else, smaller
 * ones in front of bigger ones so frames can nest.
 */
export const FrameView = memo(function FrameView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const frame = item?.kind === 'frame' ? item : null;
  const selected = useUi((s) => s.selectedIds.includes(id));
  const editing = useUi((s) => s.editingId === id);
  const lifted = useLiftedZ(id);
  const tagRef = useRef<HTMLDivElement>(null);
  const resize = useRef<{ sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  const rest = frame ? { x: frame.x, y: frame.y } : null;
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined,
    // Clicking a selected frame's tag renames it.
    (e) => {
      const r = tagRef.current?.getBoundingClientRect();
      if (r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
        useUi.getState().set({ selectedId: id, editingId: id });
      }
    });

  if (!frame) return null;
  const update = useBoard.getState().updateItem;

  const startResize = (e: ReactPointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { sx: e.clientX, sy: e.clientY, x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    setResizing(true);
    useUi.getState().set({ selectedIds: [id], editingId: null });
  };
  const moveResize = (e: ReactPointerEvent) => {
    const r = resize.current;
    if (!r) return;
    const dx = (e.clientX - r.sx) / camera.z, dy = (e.clientY - r.sy) / camera.z;
    const fit = (v: number) => (useUi.getState().snap && !e.altKey ? snap(v) : Math.round(v));
    const w = Math.max(fit(r.x + r.w + dx) - r.x, MIN_W);
    const h = Math.max(fit(r.y + r.h + dy) - r.y, MIN_H);
    if (w !== frame.w || h !== frame.h) update(id, { w, h });
  };
  const endResize = () => { resize.current = null; setResizing(false); };

  const c = frame.color;
  const style = {
    width: frame.w,
    height: frame.h,
    '--frame-color': c ?? undefined,
    '--frame-ink': c ? (isLight(c) ? 'var(--ink-dark)' : 'var(--ink-light)') : undefined,
  } as CSSProperties;
  // Behind everything; the bigger the frame, the further back.
  const zIndex = lifted ?? -1 - Math.min(900_000, Math.round(Math.sqrt(frame.w * frame.h)));

  return (
    <div
      ref={posRef}
      className="item-pos"
      data-item
      style={{ zIndex }}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div ref={visRef} className="frame" data-selected={selected} data-colored={!!c || undefined} data-resizing={resizing || undefined} style={style}>
        <div ref={tagRef} className="frame-tag">
          {editing ? (
            <input
              className="frame-title-input"
              ref={(el) => { if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.select(); } }}
              defaultValue={frame.title}
              placeholder="Frame title"
              size={Math.max(8, frame.title.length + 1)}
              onChange={(e) => { update(id, { title: e.target.value }); e.target.size = Math.max(8, e.target.value.length + 1); }}
              onBlur={() => { if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null }); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
            />
          ) : (
            <span className="frame-title" data-empty={!frame.title}>{frame.title || 'Untitled frame'}</span>
          )}
        </div>
        {selected && (
          <div
            className="frame-handle"
            title="Drag to resize — hold Alt to ignore the grid"
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
});
