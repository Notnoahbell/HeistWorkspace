// Floating toolbar above the selected item. Same actions and panels as the
// sidebar's item menu; rendered in screen space so it stays a constant size.

import { useSyncExternalStore } from 'react';
import { camera } from '../canvas/camera';
import { useBoard } from '../board/store';
import { itemSize, posOf } from '../board/actions';
import { useLayout } from '../board/layout';
import { useUi } from '../board/ui';
import { useBoardId } from '../board/nav';
import { Flyout } from './Flyout';
import { itemActions, Panel } from './panels';

const PANEL_WIDTH = 272;
const GAP = 12;

export function SelectionToolbar() {
  const boardId = useBoardId();
  const selectedId = useUi((s) => s.selectedId);
  const hidden = useUi((s) => (s.movingId != null && s.movingId === s.selectedId) || s.editingId != null);
  const flyout = useUi((s) => (s.flyout?.from === 'toolbar' ? s.flyout : null));
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
        {itemActions(item).map((a) => (
          <button
            key={a.key}
            data-flyout-trigger
            data-danger={a.danger}
            title={a.label}
            aria-label={a.label}
            aria-pressed={a.panel ? flyout?.panel === a.panel : undefined}
            onClick={() => {
              if (!a.panel) { a.run?.(); return; }
              const open = flyout?.panel === a.panel;
              useUi.getState().set({ flyout: open ? null : { panel: a.panel, from: 'toolbar' } });
            }}
          >
            {a.glyph}
          </button>
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
