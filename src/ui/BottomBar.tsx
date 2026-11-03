// Floating tool bar at the bottom: things to add (click, or drag one out onto
// the board) and view controls. Icons only; names and shortcuts in tooltips.

import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Columns3, LayoutGrid, Link2, ListChecks, Magnet, Maximize, Minus, Plus, StickyNote } from 'lucide-react';
import { camera } from '../canvas/camera';
import { ZOOM_STEP, zoomAtCenter } from '../canvas/input';
import { useUi } from '../board/ui';
import { createItem, SPAWN_GRIP, spawnAndDrag, viewportCenterWorld, zoomToFit } from '../board/actions';
import {
  BOARD_HEIGHT, BOARD_SWATCH, BOARD_WIDTH, COLUMN_EMPTY, COLUMN_HEADER, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH,
} from '../board/constants';
import type { ItemKind } from '../board/store';
import { BoardIcon } from './BoardIcon';

const ICON = { size: 20, strokeWidth: 1.8, 'aria-hidden': true } as const;

const TOOLS: { kind: ItemKind; name: string; key: string; icon: ReactNode }[] = [
  { kind: 'note', name: 'Note', key: 'N', icon: <StickyNote {...ICON} /> },
  { kind: 'link', name: 'Link', key: 'L', icon: <Link2 {...ICON} /> },
  { kind: 'todo', name: 'To-do list', key: 'T', icon: <ListChecks {...ICON} /> },
  { kind: 'board', name: 'Board', key: 'B', icon: <LayoutGrid {...ICON} /> },
  { kind: 'column', name: 'Column', key: 'C', icon: <Columns3 {...ICON} /> },
];

const SIZE: Record<ItemKind, { w: number; h: number }> = {
  note: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  link: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  todo: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  column: { w: COLUMN_WIDTH, h: COLUMN_HEADER + COLUMN_EMPTY },
  board: { w: BOARD_WIDTH, h: BOARD_HEIGHT },
};

/** What a new item looks like while it's being dragged out of the bar. */
function Preview({ kind }: { kind: ItemKind }) {
  const { w, h } = SIZE[kind];
  switch (kind) {
    case 'note':
      return <div className="note" style={{ width: w, minHeight: h }}><div className="note-text" data-empty="true">Note</div></div>;
    case 'link':
      return <div className="link" style={{ width: w }}><div className="link-bar"><Link2 size={18} strokeWidth={1.8} aria-hidden="true" /><span>Enter a link URL</span></div></div>;
    case 'todo':
      return <div className="todo" style={{ width: w }}><ul className="todo-list"><li className="todo-empty">To-do list</li></ul></div>;
    case 'column':
      return (
        <div className="column" style={{ width: w, height: h }}>
          <header className="column-header">
            <span className="column-title" data-empty="true">Untitled column</span>
            <span className="column-count">0 items</span>
          </header>
        </div>
      );
    case 'board':
      return (
        <div className="board-tile" style={{ width: w }}>
          <div className="board-swatch-wrap"><BoardIcon icon={null} color={null} size={28} squircle={BOARD_SWATCH} /></div>
          <div className="board-meta"><div className="board-name">New board</div><div className="board-count">Empty</div></div>
        </div>
      );
  }
}

/**
 * Click to add at the centre of the view, or drag it out: a preview follows
 * the cursor and becomes a real, still-held item once it leaves the bar.
 */
function AddButton({ kind, name, keyHint, icon, bar }: { kind: ItemKind; name: string; keyHint: string; icon: ReactNode; bar: () => HTMLElement | null }) {
  const press = useRef<{ x: number; y: number; dragging: boolean; spawned: boolean } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const movePreview = (cx: number, cy: number) => {
    const el = previewRef.current!;
    el.style.display = 'block';
    el.style.transform = `translate3d(${cx - SPAWN_GRIP.x * camera.z}px, ${cy - SPAWN_GRIP.y * camera.z}px, 0) scale(${camera.z})`;
  };
  const hidePreview = () => { if (previewRef.current) previewRef.current.style.display = 'none'; };

  return (
    <>
      <button
        className="bar-btn"
        title={`${name} (${keyHint}) — click, or drag onto the board`}
        aria-label={`Add ${name.toLowerCase()}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { x: e.clientX, y: e.clientY, dragging: false, spawned: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || p.spawned) return;
          if (!p.dragging) {
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
            p.dragging = true;
          }
          movePreview(e.clientX, e.clientY);
          // Hand over once the pointer is out of the bar, over the board.
          const r = bar()?.getBoundingClientRect();
          const out = !r || e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
          if (out && e.clientY > camera.origin.y) {
            p.spawned = true;
            spawnAndDrag(kind, e.pointerId, e.clientX, e.clientY, hidePreview);
          }
        }}
        onPointerUp={() => {
          const p = press.current;
          if (p?.dragging && !p.spawned) hidePreview(); // let go over the bar: cancel
          // Clear after the click event that follows has had a chance to see it.
          setTimeout(() => { press.current = null; });
        }}
        onPointerCancel={() => { hidePreview(); press.current = null; }}
        onClick={() => {
          if (press.current?.dragging) return;
          createItem(kind, viewportCenterWorld());
        }}
      >
        {icon}
      </button>
      {/* Portalled: the bar is transformed, which would make `fixed` relative to it. */}
      {createPortal(<div ref={previewRef} className="spawn-preview" aria-hidden="true"><Preview kind={kind} /></div>, document.body)}
    </>
  );
}

export function BottomBar() {
  const ref = useRef<HTMLDivElement>(null);
  const snap = useUi((s) => s.snap);
  const z = useSyncExternalStore(camera.subscribe, () => camera.z);

  return (
    <nav className="bottom-bar" ref={ref} aria-label="Tools">
      <div className="bar-group">
        {TOOLS.map((t) => <AddButton key={t.kind} kind={t.kind} name={t.name} keyHint={t.key} icon={t.icon} bar={() => ref.current} />)}
      </div>
      <div className="bar-group bar-view">
        <button
          className="bar-btn"
          aria-pressed={snap}
          title="Snap to grid (G) — hold Alt while dragging to place freely"
          aria-label="Snap to grid"
          onClick={() => useUi.getState().set({ snap: !snap })}
        >
          <Magnet {...ICON} />
        </button>
        <button className="bar-btn" title="Zoom to fit (Shift+1)" aria-label="Zoom to fit" onClick={zoomToFit}>
          <Maximize {...ICON} />
        </button>
        <button className="bar-btn" title="Zoom out (Ctrl −)" aria-label="Zoom out" onClick={() => zoomAtCenter(camera.z / ZOOM_STEP)}>
          <Minus {...ICON} />
        </button>
        <button className="bar-btn bar-zoom" title="Reset to 100% (Ctrl 0)" aria-label="Reset zoom" onClick={() => zoomAtCenter(1)}>
          {Math.round(z * 100)}%
        </button>
        <button className="bar-btn" title="Zoom in (Ctrl +)" aria-label="Zoom in" onClick={() => zoomAtCenter(camera.z * ZOOM_STEP)}>
          <Plus {...ICON} />
        </button>
      </div>
    </nav>
  );
}
