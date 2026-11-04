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
  /** Width a stacked card stretches to (its section's cell width). */
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
  /** Slot offsets relative to the section's top-left. */
  slots: Record<string, Point>;
  placeholder: (Point & Size) | null;
  /** Width cards stretch to: one grid cell. */
  fill: number;
  /** Grid cell width (cards fill it; nested sections set its minimum). */
  cell: number;
  width: number;
  height: number;
  /** Rows, top to bottom (offsets), with the index of their first member. */
  rows: { top: number; bottom: number; start: number }[];
}

/** Grid columns in a section (older data had a vertical/horizontal direction instead). */
export function gridCols(col: Column): number {
  if (col.cols) return Math.max(1, Math.floor(col.cols));
  return col.direction === 'horizontal' ? Math.max(1, col.childIds.length) : 1;
}

/** Most grid columns a section can have. */
export const MAX_COLS = 6;

/**
 * Lay out a section's children in a grid: left to right, wrapping after
 * `cols`, each row as tall as its tallest item. Skips the one being dragged
 * and opens a gap where it would drop. One column = a plain column.
 */
export function columnLayout(
  col: Column,
  sizes: Record<string, Size>,
  excludeId: string | null,
  gap: ({ index: number } & Size) | null,
): ColumnLayout {
  const cols = gridCols(col);
  const members = col.childIds.filter((id) => id !== excludeId);
  const sizeOf = (id: string) => sizes[id] ?? { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT };
  // Cards stretch to the cell; a nested section can make the cells wider.
  const cell = Math.max(COLUMN_WIDTH - COLUMN_PAD * 2, ...members.map((id) => sizeOf(id).w));

  // The sequence to place, with the drop gap as a stand-in member.
  const seq: { id: string | null; h: number; w: number }[] = members.map((id) => ({ id, ...sizeOf(id) }));
  if (gap) seq.splice(Math.min(gap.index, seq.length), 0, { id: null, w: cell, h: gap.h });

  const slots: Record<string, Point> = {};
  const rows: ColumnLayout['rows'] = [];
  let placeholder: ColumnLayout['placeholder'] = null;
  let top = COLUMN_HEADER;
  let memberIndex = 0;
  for (let r = 0; r * cols < seq.length; r++) {
    const row = seq.slice(r * cols, r * cols + cols);
    const h = Math.max(...row.map((m) => m.h));
    rows.push({ top, bottom: top + h, start: memberIndex });
    row.forEach((m, c) => {
      const at = { x: COLUMN_PAD + c * (cell + COLUMN_GAP), y: top };
      if (m.id) { slots[m.id] = at; memberIndex++; } else placeholder = { ...at, w: cell, h: m.h };
    });
    top += h + COLUMN_GAP;
  }

  const width = COLUMN_PAD * 2 + cols * cell + (cols - 1) * COLUMN_GAP;
  const height = seq.length ? top - COLUMN_GAP + COLUMN_PAD : COLUMN_HEADER + COLUMN_EMPTY;
  return { slots, placeholder, fill: cell, cell, width, height, rows };
}

/** Insertion index for a pointer at a world point, ignoring the dragged item. */
export function dropIndex(col: Column, origin: Point, sizes: Record<string, Size>, excludeId: string, p: Point) {
  const members = col.childIds.filter((id) => id !== excludeId);
  if (!members.length) return 0;
  const { rows, slots, cell } = columnLayout(col, sizes, excludeId, null);
  const y = p.y - origin.y;
  const x = p.x - origin.x;
  // The row the pointer is in (between rows counts as the one below).
  let r = rows.findIndex((row) => y < row.bottom + COLUMN_GAP / 2);
  if (r === -1) return members.length; // below everything: append
  const end = rows[r + 1]?.start ?? members.length;
  for (let i = rows[r].start; i < end; i++) {
    if (x < slots[members[i]].x + cell / 2) return i;
  }
  return end;
}
