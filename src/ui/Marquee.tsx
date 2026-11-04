// Box selection: drag on empty canvas to select everything the box touches.
// Shift-drag adds to the current selection. Shift-drag inside a section or a
// frame (which would otherwise move it) boxes what's inside it instead;
// add Ctrl/⌘ to keep what's already selected. A Shift-click there without
// dragging selects the section / frame itself, as a Shift-click would.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { camera } from '../canvas/camera';
import { useUi } from '../board/ui';
import { itemsInRect, itemsInRectWithin, shiftSelect } from '../board/actions';

const START_DISTANCE = 3; // px before a press becomes a box

let el: HTMLDivElement | null = null;

export function startMarquee(e: ReactPointerEvent, within?: string) {
  const ui = useUi.getState;
  const additive = within ? e.ctrlKey || e.metaKey : e.shiftKey;
  const base = additive ? ui().selectedIds : [];
  const pick = within ? (r: Parameters<typeof itemsInRect>[0]) => itemsInRectWithin(r, within) : itemsInRect;
  // Inside something, nothing changes until it's clearly a box (it may be a Shift-click).
  if (!within) ui().set({ editingId: null, contextMenu: null, flyout: null, ...(additive ? {} : { selectedIds: [] }) });
  else ui().set({ editingId: null, contextMenu: null, flyout: null });

  // Anchor in world space so the box stays put if the view scrolls mid-drag.
  const anchor = camera.clientToWorld(e.clientX, e.clientY);
  const downX = e.clientX, downY = e.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - downX, ev.clientY - downY) < START_DISTANCE) return;
    active = true;
    const cur = camera.clientToWorld(ev.clientX, ev.clientY);
    const rect = {
      x0: Math.min(anchor.x, cur.x), y0: Math.min(anchor.y, cur.y),
      x1: Math.max(anchor.x, cur.x), y1: Math.max(anchor.y, cur.y),
    };
    if (el) {
      const a = camera.worldToScreen(rect.x0, rect.y0);
      const b = camera.worldToScreen(rect.x1, rect.y1);
      el.style.display = 'block';
      el.style.transform = `translate3d(${a.x + camera.origin.x}px, ${a.y + camera.origin.y}px, 0)`;
      el.style.width = `${b.x - a.x}px`;
      el.style.height = `${b.y - a.y}px`;
    }
    const hits = pick(rect);
    const next = additive ? [...new Set([...base, ...hits])] : hits;
    const now = ui().selectedIds;
    if (next.length !== now.length || next.some((id, i) => id !== now[i])) ui().set({ selectedIds: next });
  };

  const up = () => {
    if (within && !active) shiftSelect(within);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (el) el.style.display = 'none';
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** The box itself (screen space, above the canvas). */
export function Marquee() {
  return <div ref={(node) => { el = node; }} className="marquee" aria-hidden="true" />;
}
