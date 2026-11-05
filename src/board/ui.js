// Local, per-user UI state. Never synced (presence will live elsewhere).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useUi = create()(persist((set) => ({
    spaceDown: false,
    panning: false,
    dragId: null,
    movingId: null,
    carried: [],
    drop: null,
    boardDrop: null,
    versionDrop: null,
    toast: null,
    selectedIds: [],
    selectedId: null,
    editingId: null,
    snap: true,
    flyout: null,
    contextMenu: null,
    viewer: null,
    wall: null,
    commenting: null,
    set: (patch) => {
        if ('selectedIds' in patch && !('selectedId' in patch)) {
            const ids = patch.selectedIds ?? [];
            patch = { ...patch, selectedId: ids.length === 1 ? ids[0] : null };
        }
        else if ('selectedId' in patch && !('selectedIds' in patch)) {
            patch = { ...patch, selectedIds: patch.selectedId ? [patch.selectedId] : [] };
        }
        set(patch);
    },
}), {
    name: 'heist:ui',
    partialize: (s) => ({ snap: s.snap }),
}));
