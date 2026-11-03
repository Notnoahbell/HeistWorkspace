// Tool rail down the left: things to add (raised mini-versions of each item —
// click, or drag one out onto the board) and view controls at the bottom.
// Icons only; names and shortcuts in tooltips. It never changes state: item
// settings live in the floating toolbar above whatever's selected.

import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, Link2, ListChecks, Magnet, Maximize, Minus, Plus } from 'lucide-react';
import { camera } from '../canvas/camera';
import { ZOOM_STEP, zoomAtCenter } from '../canvas/input';
import { useUi } from '../board/ui';
import { createItem, SPAWN_GRIP, spawnAndDrag, viewportCenterWorld, zoomToFit } from '../board/actions';
import {
  BOARD_HEIGHT, BOARD_SWATCH, BOARD_WIDTH, COLUMN_EMPTY, COLUMN_HEADER, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH,
} from '../board/constants';
import type { ItemKind } from '../board/store';
import { squircleClip } from '../lib/squircle';
import { BoardIcon } from './BoardIcon';

const ICON = { size: 18, strokeWidth: 1.8, 'aria-hidden': true } as const;
const TILE_ICON = { size: 18, strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true } as const;

/** Raised mini-versions of each item, so the add buttons read as objects. */
const TOOLS: { kind: ItemKind; name: string; key: string; tile: ReactNode }[] = [
  { kind: 'note', name: 'Note', key: 'N', tile: <span className="rail-tile tile-note"><i /><i /><i /></span> },
  { kind: 'link', name: 'Link', key: 'L', tile: <span className="rail-tile"><Link2 {...TILE_ICON} /></span> },
  { kind: 'todo', name: 'To-do list', key: 'T', tile: <span className="rail-tile"><ListChecks {...TILE_ICON} /></span> },
  {
    kind: 'board', name: 'Board', key: 'B',
    tile: <span className="rail-tile tile-board" style={{ clipPath: squircleClip(34) }}><LayoutGrid {...TILE_ICON} /></span>,
  },
  { kind: 'column', name: 'Column', key: 'C', tile: <span className="rail-tile tile-column"><i /><i /><i /></span> },
];

const SIZE: Record<ItemKind, { w: number; h: number }> = {
  note: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  link: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  todo: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  column: { w: COLUMN_WIDTH, h: COLUMN_HEADER + COLUMN_EMPTY },
  board: { w: BOARD_WIDTH, h: BOARD_HEIGHT },
};

/** What a new item looks like while it's being dragged out of the rail. */
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
 * the cursor and becomes a real, still-held item once it leaves the rail.
 */
function AddButton({ kind, name, keyHint, tile, rail }: { kind: ItemKind; name: string; keyHint: string; tile: ReactNode; rail: () => HTMLElement | null }) {
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
        className="rail-add"
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
          // Hand over once the pointer is out of the rail, over the board.
          const r = rail()?.getBoundingClientRect();
          if (!r || e.clientX > r.right) {
            p.spawned = true;
            spawnAndDrag(kind, e.pointerId, e.clientX, e.clientY, hidePreview);
          }
        }}
        onPointerUp={() => {
          const p = press.current;
          if (p?.dragging && !p.spawned) hidePreview(); // let go over the rail: cancel
          // Clear after the click event that follows has had a chance to see it.
          setTimeout(() => { press.current = null; });
        }}
        onPointerCancel={() => { hidePreview(); press.current = null; }}
        onClick={() => {
          if (press.current?.dragging) return;
          createItem(kind, viewportCenterWorld());
        }}
      >
        {tile}
      </button>
      {createPortal(<div ref={previewRef} className="spawn-preview" aria-hidden="true"><Preview kind={kind} /></div>, document.body)}
    </>
  );
}

export function ToolRail() {
  const ref = useRef<HTMLElement>(null);
  const snap = useUi((s) => s.snap);
  const z = useSyncExternalStore(camera.subscribe, () => camera.z);

  return (
    <nav className="tool-rail" ref={ref} aria-label="Tools">
      <div className="rail-group">
        {TOOLS.map((t) => <AddButton key={t.kind} kind={t.kind} name={t.name} keyHint={t.key} tile={t.tile} rail={() => ref.current} />)}
      </div>
      <div className="rail-spacer" />
      <div className="rail-group rail-view">
        <button
          className="rail-btn"
          aria-pressed={snap}
          title="Snap to grid (G) — hold Alt while dragging to place freely"
          aria-label="Snap to grid"
          onClick={() => useUi.getState().set({ snap: !snap })}
        >
          <Magnet {...ICON} />
        </button>
        <button className="rail-btn" title="Zoom to fit (Shift+1)" aria-label="Zoom to fit" onClick={zoomToFit}>
          <Maximize {...ICON} />
        </button>
        <div className="rail-zoom">
          <button className="rail-btn" title="Zoom in (Ctrl +)" aria-label="Zoom in" onClick={() => zoomAtCenter(camera.z * ZOOM_STEP)}>
            <Plus {...ICON} />
          </button>
          <button className="rail-btn rail-pct" title="Reset to 100% (Ctrl 0)" aria-label="Reset zoom" onClick={() => zoomAtCenter(1)}>
            {Math.round(z * 100)}%
          </button>
          <button className="rail-btn" title="Zoom out (Ctrl −)" aria-label="Zoom out" onClick={() => zoomAtCenter(camera.z / ZOOM_STEP)}>
            <Minus {...ICON} />
          </button>
        </div>
      </div>
    </nav>
  );
}
