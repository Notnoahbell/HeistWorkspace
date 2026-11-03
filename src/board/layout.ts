// Derived, local-only layout: measured item sizes and the slots that columns
// hand out to what's stacked in them. Recomputed, never persisted.
//
// Columns size themselves to their contents, so a column inside a column
// widens its parent rather than squashing its children.

import { create } from 'zustand';
import type { Point } from '../canvas/camera';
import { GRID_SIZE } from '../canvas/grid';
import type { Column } from './store';
import {
  COLUMN_EMPTY, COLUMN_GAP, COLUMN_HEADER, COLUMN_PAD, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH,
} from './constants';

interface LayoutState {
  /** Rendered heights (world units): measured for cards, computed for columns. */
  heights: Record<string, number>;
  /** Widths of columns (computed); everything else stacks at NOTE_WIDTH. */
  widths: Record<string, number>;
  /** World position of each item stacked in a column. */
  slots: Record<string, Point>;
  /** Width a stacked card stretches to (its vertical column's inner width). */
  fills: Record<string, number>;
}

export const useLayout = create<LayoutState>()(() => ({
  heights: {},
  widths: {},
  slots: {},
  fills: {},
}));

export const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

export interface Size { w: number; h: number }

/** Size of an item when stacked in a column. */
export function stackedSize(id: string, s: Pick<LayoutState, 'heights' | 'widths'> = useLayout.getState()): Size {
  return { w: s.widths[id] ?? NOTE_WIDTH, h: s.heights[id] ?? NOTE_MIN_HEIGHT };
}

export interface ColumnLayout {
  /** Slot offsets relative to the column's top-left. */
  slots: Record<string, Point>;
  placeholder: (Point & Size) | null;
  /** Width cards stretch to (vertical columns only). */
  fill: number | null;
  width: number;
  height: number;
}

/**
 * Lay out a column's children (vertically or side by side), skipping the one
 * being dragged and opening a gap where it would drop.
 */
export function columnLayout(
  col: Column,
  sizes: Record<string, Size>,
  excludeId: string | null,
  gap: ({ index: number } & Size) | null,
): ColumnLayout {
  const members = col.childIds.filter((id) => id !== excludeId);
  const horizontal = col.direction === 'horizontal';
  const slots: Record<string, Point> = {};
  let placeholder: ColumnLayout['placeholder'] = null;
  let cursor = horizontal ? COLUMN_PAD : COLUMN_HEADER; // along the stacking axis
  let cross = 0; // largest size across it

  const place = (size: Size) => {
    const at = horizontal ? { x: cursor, y: COLUMN_HEADER } : { x: COLUMN_PAD, y: cursor };
    cursor += (horizontal ? size.w : size.h) + COLUMN_GAP;
    cross = Math.max(cross, horizontal ? size.h : size.w);
    return at;
  };

  for (let i = 0; i <= members.length; i++) {
    if (gap && gap.index === i) placeholder = { ...place(gap), w: gap.w, h: gap.h };
    if (i === members.length) break;
    slots[members[i]] = place(sizes[members[i]] ?? { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT });
  }

  const filled = members.length > 0 || !!gap;
  if (!filled) return { slots, placeholder, fill: null, width: COLUMN_WIDTH, height: COLUMN_HEADER + COLUMN_EMPTY };
  const along = cursor - COLUMN_GAP + COLUMN_PAD;
  if (horizontal) {
    return { slots, placeholder, fill: null, width: Math.max(COLUMN_WIDTH, along), height: COLUMN_HEADER + cross + COLUMN_PAD };
  }
  const width = Math.max(COLUMN_WIDTH, cross + COLUMN_PAD * 2);
  if (placeholder) placeholder.w = width - COLUMN_PAD * 2;
  return { slots, placeholder, fill: width - COLUMN_PAD * 2, width, height: along };
}

/** Insertion index for a pointer at a world point, ignoring the dragged item. */
export function dropIndex(col: Column, origin: Point, sizes: Record<string, Size>, excludeId: string, p: Point) {
  const members = col.childIds.filter((id) => id !== excludeId);
  const horizontal = col.direction === 'horizontal';
  let at = horizontal ? origin.x + COLUMN_PAD : origin.y + COLUMN_HEADER;
  for (let i = 0; i < members.length; i++) {
    const size = sizes[members[i]] ?? { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT };
    const len = horizontal ? size.w : size.h;
    if ((horizontal ? p.x : p.y) < at + len / 2) return i;
    at += len + COLUMN_GAP;
  }
  return members.length;
}
