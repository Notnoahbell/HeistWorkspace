// Fixed-width bar on the left: things to add and view controls. When
// something is selected, that item's menu slides in over the tools.

import { forwardRef, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { camera } from '../canvas/camera';
import { ZOOM_STEP, zoomAtCenter } from '../canvas/input';
import { useUi } from '../board/ui';
import {
  clearSelection, createItem, deleteSelection, groupIntoColumn, SPAWN_GRIP, spawnAndDrag, viewportCenterWorld, zoomToFit,
} from '../board/actions';
import {
  BOARD_HEIGHT, BOARD_SWATCH, BOARD_WIDTH, COLUMN_EMPTY, COLUMN_HEADER, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH,
} from '../board/constants';
import { useBoard, type ItemKind } from '../board/store';
import { useBoardId } from '../board/nav';
import { ArrowLeft, Columns3, LayoutGrid, Link2, ListChecks, Trash2 } from 'lucide-react';
import { squircleClip } from '../lib/squircle';
import { Flyout } from './Flyout';
import { ICON_PROPS, itemActions, Panel } from './panels';
import { BoardIcon } from './BoardIcon';

const icon = {
  snap: (
    <>
      <rect x="5" y="5" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="11" y="5" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="17" y="5" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="5" y="11" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="5" y="17" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="10.5" y="10.5" width="8" height="8" />
    </>
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
      {children}
    </svg>
  );
}

interface ToolButtonProps {
  label: string;
  title: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick: () => void;
}

function ToolButton({ label, title, icon: glyph, pressed, onClick }: ToolButtonProps) {
  return (
    <button className="side-btn" title={title} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <Icon>{glyph}</Icon>
      <span>{label}</span>
    </button>
  );
}

const SIZE: Record<ItemKind, { w: number; h: number }> = {
  note: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  link: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  todo: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
  column: { w: COLUMN_WIDTH, h: COLUMN_HEADER + COLUMN_EMPTY },
  board: { w: BOARD_WIDTH, h: BOARD_HEIGHT },
};

const TILE_ICON = { size: 18, strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true } as const;

/** Raised mini-versions of each item for the Add buttons. */
const TILE: Record<ItemKind, ReactNode> = {
  note: (
    <span className="side-tile tile-note">
      <i /><i /><i />
    </span>
  ),
  link: <span className="side-tile"><Link2 {...TILE_ICON} /></span>,
  todo: <span className="side-tile"><ListChecks {...TILE_ICON} /></span>,
  board: (
    <span className="side-tile tile-board" style={{ clipPath: squircleClip(34) }}>
      <LayoutGrid {...TILE_ICON} size={18} />
    </span>
  ),
  column: (
    <span className="side-tile tile-column">
      <i /><i /><i />
    </span>
  ),
};

/**
 * Click to add at the centre of the view, or drag the button out: a preview
 * tile follows the cursor and becomes a real, still-held item once it has
 * cleared the sidebar.
 */
function AddButton({ kind, label, title }: { kind: ItemKind; label: string; title: string }) {
  const press = useRef<{ x: number; y: number; dragging: boolean; spawned: boolean } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const { w, h } = SIZE[kind];

  const movePreview = (cx: number, cy: number) => {
    const el = previewRef.current!;
    el.style.display = 'block';
    el.style.transform =
      `translate3d(${cx - SPAWN_GRIP.x * camera.z}px, ${cy - SPAWN_GRIP.y * camera.z}px, 0) scale(${camera.z})`;
  };
  const hidePreview = () => { if (previewRef.current) previewRef.current.style.display = 'none'; };

  return (
    <>
      <button
        className="side-btn side-add"
        title={title}
        aria-label={`Add ${label.toLowerCase()}`}
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
          // Hand over once the tile's left edge is out over the canvas.
          if (e.clientX - SPAWN_GRIP.x * camera.z > camera.origin.x) {
            p.spawned = true;
            spawnAndDrag(kind, e.pointerId, e.clientX, e.clientY, hidePreview);
          }
        }}
        onPointerUp={() => {
          const p = press.current;
          if (p?.dragging && !p.spawned) hidePreview(); // dropped back on the sidebar: cancel
          // Clear after the click event that follows has had a chance to see it.
          setTimeout(() => { press.current = null; });
        }}
        onPointerCancel={() => { hidePreview(); press.current = null; }}
        onClick={() => {
          if (press.current?.dragging) return;
          createItem(kind, viewportCenterWorld());
        }}
      >
        {TILE[kind]}
        <span>{label}</span>
      </button>

      <div ref={previewRef} className="spawn-preview" aria-hidden="true">
        {kind === 'note' && (
          <div className="note" style={{ width: w, minHeight: h }}>
            <div className="note-text" data-empty="true">Note</div>
          </div>
        )}
        {kind === 'link' && (
          <div className="link" style={{ width: w }}>
            <div className="link-bar"><Link2 size={18} strokeWidth={1.8} aria-hidden="true" /><span>Enter a link URL</span></div>
          </div>
        )}
        {kind === 'todo' && (
          <div className="todo" style={{ width: w }}>
            <ul className="todo-list"><li className="todo-empty">To-do list</li></ul>
          </div>
        )}
        {kind === 'column' && (
          <div className="column" style={{ width: w, height: h }}>
            <header className="column-header">
              <span className="column-title" data-empty="true">Untitled column</span>
              <span className="column-count">0 items</span>
            </header>
          </div>
        )}
        {kind === 'board' && (
          <div className="board-tile" style={{ width: w }}>
            <div className="board-swatch-wrap">
              <BoardIcon icon={null} color={null} size={28} squircle={BOARD_SWATCH} />
            </div>
            <div className="board-meta">
              <div className="board-name">New board</div>
              <div className="board-count">Empty</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="side-section" aria-label={label}>
      <h2>{label}</h2>
      {children}
    </section>
  );
}

const MULTI = '\u0000multi';

/** Actions for several selected items at once. */
function MultiMenu() {
  const count = useUi((s) => s.selectedIds.length);
  return (
    <>
      <button className="side-back" title="Back (Esc)" aria-label="Back to tools" onClick={clearSelection}>
        <ArrowLeft {...ICON_PROPS} size={18} />
      </button>
      <div className="side-count" aria-live="polite"><strong>{count}</strong><span>selected</span></div>
      <button className="side-btn side-action" title="Gather into a new column" onClick={() => groupIntoColumn()}>
        <span className="side-glyph"><Columns3 {...ICON_PROPS} size={18} /></span>
        <span>Column</span>
      </button>
      <button className="side-btn side-action" data-danger title="Delete (Del)" onClick={deleteSelection}>
        <span className="side-glyph"><Trash2 {...ICON_PROPS} size={18} /></span>
        <span>Delete</span>
      </button>
    </>
  );
}

/** The selected item's actions: replaces the tools while something is selected. */
function ItemMenu({ id, isOpenBoard }: { id: string; isOpenBoard: boolean }) {
  const item = useBoard((s) => s.items[id]);
  const flyout = useUi((s) => (s.flyout?.from === 'sidebar' ? s.flyout : null));
  if (!item) return null;

  return (
    <>
      <button
        className="side-back"
        title="Back (Esc)"
        aria-label="Back to tools"
        onClick={() => useUi.getState().set({ selectedId: null, editingId: null, flyout: null })}
      >
        <ArrowLeft {...ICON_PROPS} size={18} />
      </button>
      {itemActions(item, isOpenBoard).map((a) => (
        <button
          key={a.key}
          className="side-btn side-action"
          data-flyout-trigger
          data-danger={a.danger}
          aria-pressed={a.panel ? flyout?.panel === a.panel : undefined}
          title={a.label}
          onClick={(e) => {
            if (!a.panel) { a.run?.(); return; }
            const r = e.currentTarget.getBoundingClientRect();
            const open = flyout?.panel === a.panel;
            useUi.getState().set({ flyout: open ? null : { panel: a.panel, from: 'sidebar', anchorY: r.top + r.height / 2 } });
          }}
        >
          <span className="side-glyph">{a.glyph}</span>
          <span>{a.label}</span>
        </button>
      ))}
      {flyout && (
        <Flyout left={SIDEBAR_W + 10} top={(flyout.anchorY ?? 0) - 30} notchY={flyout.anchorY} label={flyout.panel}>
          <Panel key={`${id}:${flyout.panel}`} item={item} panel={flyout.panel} />
        </Flyout>
      )}
    </>
  );
}

const SIDEBAR_W = 76;

export const Sidebar = forwardRef<HTMLSpanElement>(function Sidebar(_, coordsRef) {
  const snap = useUi((s) => s.snap);
  const z = useSyncExternalStore(camera.subscribe, () => camera.z);
  const boardId = useBoardId();
  const selectedId = useUi((s) => s.selectedId);
  // Only offer actions for things that exist on the open board (or the board itself).
  const multiCount = useUi((s) => s.selectedIds.length);
  const single = useBoard((s) => {
    const it = selectedId ? s.items[selectedId] : undefined;
    return !!it && (it.boardId === boardId || it.id === boardId);
  });
  // Keep the last menu rendered while it slides away.
  const lastId = useRef<string | null>(null);
  const multi = multiCount > 1;
  const inspecting = single || multi;
  if (inspecting) lastId.current = multi ? MULTI : selectedId;
  const menuId = inspecting ? (multi ? MULTI : selectedId) : lastId.current;

  return (
    <aside className="sidebar" data-mode={inspecting ? 'item' : 'tools'}>
      <div className="side-pane side-tools" inert={inspecting}>
        <Section label="Add">
          <AddButton kind="note" label="Note" title="Note (N) — click, or drag onto the board" />
          <AddButton kind="link" label="Link" title="Link (L) — click, or drag onto the board" />
          <AddButton kind="todo" label="To-do" title="To-do list (T) — click, or drag onto the board" />
          <AddButton kind="board" label="Board" title="Board (B) — click, or drag onto the board" />
          <AddButton kind="column" label="Column" title="Column (C) — click, or drag onto the board" />
        </Section>

        <div className="side-spacer" />

        <Section label="View">
          <ToolButton
            label="Snap"
            title="Snap to grid (G) — hold Alt while dragging to place freely"
            icon={icon.snap}
            pressed={snap}
            onClick={() => useUi.getState().set({ snap: !snap })}
          />
          <ToolButton label="Fit" title="Zoom to fit (Shift+1)" icon={icon.fit} onClick={zoomToFit} />
          <div className="side-zoom">
            <button title="Zoom in (Ctrl +)" aria-label="Zoom in" onClick={() => zoomAtCenter(camera.z * ZOOM_STEP)}>
              <Icon>{icon.plus}</Icon>
            </button>
            <button className="mono" title="Reset to 100% (Ctrl 0)" onClick={() => zoomAtCenter(1)}>
              {Math.round(z * 100)}%
            </button>
            <button title="Zoom out (Ctrl −)" aria-label="Zoom out" onClick={() => zoomAtCenter(camera.z / ZOOM_STEP)}>
              <Icon>{icon.minus}</Icon>
            </button>
          </div>
        </Section>

        <span ref={coordsRef} className="side-coords mono" title="Cursor position on the board">0, 0</span>
      </div>

      <div className="side-pane side-item" inert={!inspecting}>
        {menuId === MULTI
          ? <MultiMenu />
          : menuId && <ItemMenu key={menuId} id={menuId} isOpenBoard={menuId === boardId} />}
      </div>
    </aside>
  );
});
