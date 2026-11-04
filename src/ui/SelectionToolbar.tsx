// Floating toolbar above the selection: the item's actions and settings
// panels, or group actions when several things are selected. Rendered in
// screen space so it stays a constant size.

import { Fragment, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, Frame, LayoutGrid, Play, Trash2,
} from 'lucide-react';
import { SectionIcon } from './SectionIcon';
import { camera } from '../canvas/camera';
import { useBoard } from '../board/store';
import { arrangeSelection, canArrange, deleteSelection, groupIntoColumn, itemSize, planArrange, posOf, wrapInFrame, type Arrange } from '../board/actions';
import { useLayout } from '../board/layout';
import { useUi } from '../board/ui';
import { useBoardId } from '../board/nav';
import { Flyout } from './Flyout';
import { MAX_WALL, openWall } from './MediaWall';
import { ICON_PROPS, itemActions, Panel } from './panels';

const PANEL_WIDTH = 272;
const GAP = 12;

/** Several things selected: group actions above the selection's bounds. */
function GroupToolbar({ ids }: { ids: string[] }) {
  const items = useBoard(useShallow((s) => ids.map((id) => s.items[id]).filter(Boolean)));
  const hidden = useUi((s) => s.movingId != null || s.dragId != null);
  useLayout((s) => s.slots); // follow column reflows
  useSyncExternalStore(camera.subscribe, () => camera.version);
  if (!items.length || hidden) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity;
  for (const it of items) {
    const at = posOf(it);
    x0 = Math.min(x0, at.x); y0 = Math.min(y0, at.y);
    x1 = Math.max(x1, at.x + itemSize(it).w);
  }
  const a = camera.worldToScreen(x0, y0), b = camera.worldToScreen(x1, y0);
  const media = items.filter((it) => it.kind === 'media').length;
  const actions = [
    ...(media >= 2 ? [{
      key: 'wall',
      label: media > MAX_WALL ? `Play together (Enter) — the first ${MAX_WALL} of ${media}` : `Play ${media} together (Enter)`,
      icon: <Play {...ICON_PROPS} fill="currentColor" />,
      run: () => openWall(ids),
    }] : []),
    { key: 'frame', label: 'Wrap in a frame (Ctrl+G)', icon: <Frame {...ICON_PROPS} />, run: () => wrapInFrame() },
    { key: 'column', label: 'Gather into a new section', icon: <SectionIcon size={16} />, run: () => groupIntoColumn() },
    { key: 'delete', label: `Delete ${items.length} items`, icon: <Trash2 {...ICON_PROPS} />, run: deleteSelection, danger: true },
  ];

  return (
    <>
      <div
        className="selection-toolbar"
        style={{ left: (a.x + b.x) / 2 + camera.origin.x, top: Math.max(camera.origin.y + 8, a.y + camera.origin.y - GAP) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="toolbar-count">{items.length}</span>
        <span className="toolbar-divider" role="separator" />
        {actions.map((act, i) => (
          <Fragment key={act.key}>
            {i > 0 && (act.danger || (act.key === 'frame' && media >= 2)) && <span className="toolbar-divider" role="separator" />}
            <button data-key={act.key} title={act.label} aria-label={act.label} data-danger={act.danger} onClick={act.run}>
              {act.icon}
            </button>
          </Fragment>
        ))}
      </div>
      <AlignToolbar x={b.x + camera.origin.x + GAP} y={a.y + camera.origin.y} />
    </>
  );
}

const ARRANGE: { key: Arrange; label: string; icon: ReactNode }[] = [
  { key: 'left', label: 'Line up left edges (in a column)', icon: <AlignStartVertical {...ICON_PROPS} /> },
  { key: 'hcenter', label: 'Line up centres (in a column)', icon: <AlignCenterVertical {...ICON_PROPS} /> },
  { key: 'right', label: 'Line up right edges (in a column)', icon: <AlignEndVertical {...ICON_PROPS} /> },
  { key: 'top', label: 'Line up top edges (in a row)', icon: <AlignStartHorizontal {...ICON_PROPS} /> },
  { key: 'vcenter', label: 'Line up middles (in a row)', icon: <AlignCenterHorizontal {...ICON_PROPS} /> },
  { key: 'bottom', label: 'Line up bottom edges (in a row)', icon: <AlignEndHorizontal {...ICON_PROPS} /> },
  { key: 'spread-h', label: 'Space evenly left to right', icon: <AlignHorizontalSpaceAround {...ICON_PROPS} /> },
  { key: 'spread-v', label: 'Space evenly top to bottom', icon: <AlignVerticalSpaceAround {...ICON_PROPS} /> },
  { key: 'grid', label: 'Tidy into a grid', icon: <LayoutGrid {...ICON_PROPS} /> },
];

/**
 * Beside a multi-selection: line things up, space them out or tidy them into
 * a grid. Hovering a button outlines where everything would go.
 */
function AlignToolbar({ x, y }: { x: number; y: number }) {
  const [hover, setHover] = useState<Arrange | null>(null);
  if (!canArrange('left')) return null;
  const preview = hover ? planArrange(hover) : [];
  return (
    <>
      {preview.map((p) => {
        const s = camera.worldToScreen(p.x, p.y);
        return (
          <div
            key={p.id}
            className="arrange-ghost"
            style={{ left: s.x + camera.origin.x, top: s.y + camera.origin.y, width: p.w * camera.z, height: p.h * camera.z }}
          />
        );
      })}
      <div
        className="selection-toolbar align-toolbar"
        role="toolbar"
        aria-label="Arrange"
        style={{ left: Math.min(x, window.innerWidth - 52), top: Math.max(camera.origin.y + 8, y) }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerLeave={() => setHover(null)}
      >
        {ARRANGE.map((act, i) => (
          <Fragment key={act.key}>
            {(i === 3 || i === 6) && <span className="toolbar-divider" role="separator" />}
            <button
              data-key={act.key}
              title={act.label}
              aria-label={act.label}
              disabled={!canArrange(act.key)}
              onPointerEnter={() => setHover(act.key)}
              onFocus={() => setHover(act.key)}
              onBlur={() => setHover(null)}
              onClick={() => { arrangeSelection(act.key); setHover(null); }}
            >
              {act.icon}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}

/** How it looks · what it does · delete — a divider goes between groups. */
const LOOK = new Set(['color', 'strip', 'text', 'icon']);
const actionGroup = (a: { key: string; danger?: boolean }) => (a.danger ? 'danger' : LOOK.has(a.key) ? 'look' : 'do');

export function SelectionToolbar() {
  const ids = useUi((s) => s.selectedIds);
  if (ids.length > 1) return <GroupToolbar ids={ids} />;
  return <SingleToolbar />;
}

function SingleToolbar() {
  const boardId = useBoardId();
  const selectedId = useUi((s) => s.selectedId);
  const hidden = useUi((s) => (s.movingId != null && s.movingId === s.selectedId) || s.editingId != null);
  const flyout = useUi((s) => (s.flyout?.from === 'toolbar' ? s.flyout : null));
  useUi((s) => s.commenting); // the comment button shows pressed while its box is open
  const item = useBoard((s) => (selectedId ? s.items[selectedId] : undefined));
  const slot = useLayout((s) => (selectedId ? s.slots[selectedId] : undefined));
  useSyncExternalStore(camera.subscribe, () => camera.version);

  // Only for items on the open board (not the board itself, chosen from the top bar).
  if (!item || hidden || item.boardId !== boardId) return null;

  void slot; // re-render when the item's slot in a column moves
  const at = posOf(item);
  const topLeft = camera.worldToScreen(at.x, at.y);
  const left = topLeft.x + camera.origin.x;
  const top = topLeft.y + camera.origin.y;
  // Stacked boards are drawn as full-width rows.
  const width = itemSize(item).w * camera.z;

  // Panels open beside the item so live changes stay visible.
  const fitsRight = left + width + GAP + PANEL_WIDTH < window.innerWidth - 8;
  const panelLeft = fitsRight ? left + width + GAP : Math.max(camera.origin.x + 8, left - GAP - PANEL_WIDTH);

  return (
    <>
      <div
        className="selection-toolbar"
        style={{ left: left + width / 2, top: Math.max(camera.origin.y + 8, top - GAP) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {itemActions(item).map((a, i, all) => (
          <Fragment key={a.key}>
          {i > 0 && actionGroup(all[i - 1]) !== actionGroup(a) && <span className="toolbar-divider" role="separator" />}
          <button
            data-flyout-trigger
            data-key={a.key}
            data-danger={a.danger}
            title={a.label}
            aria-label={a.label}
            aria-pressed={a.panel ? flyout?.panel === a.panel : a.pressed}
            onClick={() => {
              if (!a.panel) { a.run?.(); return; }
              const open = flyout?.panel === a.panel;
              useUi.getState().set({ flyout: open ? null : { panel: a.panel, from: 'toolbar' } });
            }}
          >
            {a.glyph}
          </button>
          </Fragment>
        ))}
      </div>

      {flyout && (
        <Flyout left={panelLeft} top={top} label={flyout.panel}>
          <Panel key={`${item.id}:${flyout.panel}`} item={item} panel={flyout.panel} />
        </Flyout>
      )}
    </>
  );
}
