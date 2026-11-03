// Local, per-user UI state. Never synced (presence will live elsewhere).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DropTarget {
  columnId: string;
  index: number;
  /** Size of the gap to open (the dragged item's stacked size). */
  w: number;
  h: number;
}

/** Settings panels that open in a pop-up for the selected item. */
export type PanelKey = 'color' | 'strip' | 'text' | 'icon' | 'rename';

export interface Flyout {
  panel: PanelKey;
  /** Opened from the sidebar's item menu or the toolbar above the item. */
  from: 'sidebar' | 'toolbar';
  /** Sidebar only: vertical centre of the button that opened it (client px). */
  anchorY?: number;
}

interface UiState {
  spaceDown: boolean;
  panning: boolean;
  /** Item currently held past the drag threshold. */
  dragId: string | null;
  /** Item that was dragged and hasn't come to rest yet (hides the toolbar). */
  movingId: string | null;
  /** Where the dragged item would land if released now. */
  drop: DropTarget | null;
  /** Board (tile on the canvas, or a crumb in the path) the drag would move things into. */
  boardDrop: string | null;
  /** Brief confirmation at the bottom of the screen. */
  toast: { text: string; boardId?: string; at: number } | null;
  /** Everything selected. */
  selectedIds: string[];
  /** The selected item when exactly one is selected, else null. */
  selectedId: string | null;
  editingId: string | null;
  snap: boolean;
  flyout: Flyout | null;
  /**
   * Right-click menu at a client position. With `world`, it was opened on
   * empty canvas (offers "add here"); otherwise it acts on the selection.
   */
  contextMenu: { x: number; y: number; world?: { x: number; y: number } } | null;
  /**
   * Patch UI state. Setting either selection field keeps the other in step,
   * so single-selection code can keep using `selectedId`.
   */
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      spaceDown: false,
      panning: false,
      dragId: null,
      movingId: null,
      drop: null,
      boardDrop: null,
      toast: null,
      selectedIds: [],
      selectedId: null,
      editingId: null,
      snap: true,
      flyout: null,
      contextMenu: null,
      set: (patch) => {
        if ('selectedIds' in patch && !('selectedId' in patch)) {
          const ids = patch.selectedIds ?? [];
          patch = { ...patch, selectedId: ids.length === 1 ? ids[0] : null };
        } else if ('selectedId' in patch && !('selectedIds' in patch)) {
          patch = { ...patch, selectedIds: patch.selectedId ? [patch.selectedId] : [] };
        }
        set(patch);
      },
    }),
    {
      name: 'heist:ui',
      partialize: (s) => ({ snap: s.snap }),
    },
  ),
);
