// Board document store. Every mutation goes through these actions as small,
// serialisable patches so they can later be mapped onto a Yjs document for
// sync, offline and undo/redo. Positions are always in world coordinates.
//
// Items from every board live in one flat map, tagged with the board they
// belong to. A board is itself an item (its tile on the parent board); the
// root of each user's tree is their Home, which is not an item.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { newId } from '../lib/id';
import { homeId, session } from '../session';
import { BOARD_WIDTH, COLUMN_WIDTH, MEDIA_WIDTH, NOTE_WIDTH } from './constants';
/** Things drawn on the canvas (everything but comments). */
export const onCanvas = (it) => it.kind !== 'comment';
/** Kinds people can comment on. */
export const COMMENTABLE = new Set(['note', 'todo', 'link', 'media']);
/** The board a tile opens: itself, or what it's a shortcut to. */
export const boardTarget = (b) => b.linkTo ?? b.id;
export const isStackable = (it) => !!it;
/** Column the item is stacked in, if any (older boards have no parentId field). */
export const parentOf = (it) => (isStackable(it) && it.parentId) || null;
const DEFAULTS = {
    note: {
        w: NOTE_WIDTH, color: null, text: '', parentId: null,
        textSize: 'md', textAlign: 'left', bold: false,
    },
    todo: { w: NOTE_WIDTH, color: null, entries: [], parentId: null },
    link: { w: NOTE_WIDTH, color: null, url: '', preview: null, parentId: null },
    media: { w: MEDIA_WIDTH, mediaType: 'image', src: '', name: '', meta: {}, captionHidden: false, parentId: null },
    comment: { w: 0, parentId: null, targetId: '', authorId: '', authorName: '', text: '', createdAt: 0, time: null, resolved: false },
    column: { w: COLUMN_WIDTH, title: '', color: null, strip: null, cols: 1, childIds: [], parentId: null },
    board: { w: BOARD_WIDTH, title: '', color: null, icon: null, parentId: null },
    frame: { w: 480, h: 320, title: '', color: null, parentId: null },
};
// localStorage can throw (private mode, blocked storage); never let that break the board.
const safeStorage = {
    getItem: (k) => { try {
        return localStorage.getItem(k);
    }
    catch {
        return null;
    } },
    setItem: (k, v) => { try {
        localStorage.setItem(k, v);
    }
    catch { } },
    removeItem: (k) => { try {
        localStorage.removeItem(k);
    }
    catch { } },
};
/** Returns items with `id` removed from its parent column's childIds. */
function unparent(items, id) {
    const parentId = parentOf(items[id]);
    if (!parentId)
        return items;
    const col = items[parentId];
    if (col?.kind !== 'column')
        return items;
    return { ...items, [col.id]: { ...col, childIds: col.childIds.filter((c) => c !== id) } };
}
/** Everything stacked inside a column, at any depth. */
export function columnContents(items, columnId) {
    const out = [];
    const queue = [columnId];
    while (queue.length) {
        const col = items[queue.pop()];
        if (col?.kind !== 'column')
            continue;
        for (const c of col.childIds) {
            out.push(c);
            queue.push(c);
        }
    }
    return out;
}
/** How many columns deep an item is stacked (0 = on the board). */
export function stackDepth(items, id) {
    let depth = 0;
    for (let p = parentOf(items[id]); p && items[p] && depth < 32; p = parentOf(items[p]))
        depth++;
    return depth;
}
/**
 * Surface tone for something stacked in a column: alternates by depth so a
 * card always contrasts with the column it sits in. undefined = not stacked.
 */
export const stackTone = (depth) => depth === 0 ? undefined : depth % 2 ? 'odd' : 'even';
/**
 * CSS z-index for an item: top-level items by their z, and anything stacked
 * just above the column holding it (deeper = higher), all within the band of
 * its outermost column.
 */
export function stackZ(items, id) {
    let depth = 0;
    let root = items[id];
    for (let p = parentOf(root); p && items[p] && depth < 32; p = parentOf(items[p])) {
        root = items[p];
        depth++;
    }
    return (root?.z ?? 0) * 64 + depth;
}
/** All ids on a board and, recursively, on its sub-boards. */
export function descendants(items, boardId) {
    const out = [];
    const queue = [boardId];
    while (queue.length) {
        const b = queue.pop();
        for (const it of Object.values(items)) {
            if (it.boardId !== b)
                continue;
            out.push(it.id);
            if (it.kind === 'board')
                queue.push(it.id);
        }
    }
    return out;
}
export const useBoard = create()(persist((set, get) => ({
    items: {},
    topZ: 0,
    addItem(kind, init) {
        const id = newId();
        const z = get().topZ + 1;
        const item = { ...DEFAULTS[kind], createdBy: session.userId, createdAt: Date.now(), ...init, id, kind, z };
        set((s) => ({ items: { ...s.items, [id]: item }, topZ: z }));
        return id;
    },
    updateItem(id, patch) {
        set((s) => {
            const item = s.items[id];
            if (!item)
                return s;
            return { items: { ...s.items, [id]: { ...item, ...patch } } };
        });
    },
    removeItem(id, release = {}) {
        set((s) => {
            const item = s.items[id];
            if (!item)
                return s;
            let items = { ...unparent(s.items, id) };
            let topZ = s.topZ;
            if (item.kind === 'column') {
                for (const cid of item.childIds) {
                    const c = items[cid];
                    if (!isStackable(c))
                        continue;
                    const at = release[cid] ?? { x: item.x, y: item.y };
                    items[cid] = { ...c, parentId: null, x: at.x, y: at.y, z: ++topZ };
                }
            }
            if (item.kind === 'board') {
                for (const d of descendants(items, id))
                    delete items[d];
            }
            // Its comments go with it.
            for (const it of Object.values(items))
                if (it.kind === 'comment' && it.targetId === id)
                    delete items[it.id];
            delete items[id];
            return { items, topZ };
        });
    },
    bringToFront(id) {
        const { items, topZ } = get();
        const item = items[id];
        if (!item)
            return;
        // A stacked item rises with its column.
        const parentId = parentOf(item);
        const target = parentId ? items[parentId] : item;
        if (!target || target.z === topZ)
            return;
        set({ items: { ...items, [target.id]: { ...target, z: topZ + 1 } }, topZ: topZ + 1 });
    },
    moveToColumn(id, columnId, index) {
        set((s) => {
            if (s.items[id]?.kind === 'frame')
                return s; // frames stay on the board
            // A column can't go inside itself or anything inside it.
            for (let c = columnId; c; c = parentOf(s.items[c]))
                if (c === id)
                    return s;
            const items = unparent(s.items, id);
            const note = items[id];
            const col = items[columnId];
            if (!isStackable(note) || col?.kind !== 'column')
                return s;
            const childIds = col.childIds.filter((c) => c !== id);
            childIds.splice(Math.min(index, childIds.length), 0, id);
            return {
                items: {
                    ...items,
                    [columnId]: { ...col, childIds },
                    [id]: { ...note, parentId: columnId, boardId: col.boardId },
                },
            };
        });
    },
    insertItems(list) {
        set((s) => {
            const items = { ...s.items };
            let topZ = s.topZ;
            for (const it of list)
                items[it.id] = { ...it, z: ++topZ };
            return { items, topZ };
        });
    },
    moveToBoard(ids, boardId, at) {
        set((s) => {
            // A board can't go inside itself or anything inside it.
            for (let b = boardId; b; b = s.items[b]?.boardId)
                if (ids.includes(b))
                    return s;
            let items = { ...s.items };
            let topZ = s.topZ;
            for (const id of ids) {
                const it = items[id];
                if (!it)
                    continue;
                items = unparent(items, id);
                const p = at[id] ?? { x: 0, y: 0 };
                items[id] = { ...items[id], boardId, parentId: null, x: p.x, y: p.y, z: ++topZ };
                // A column's contents come along (boards keep their own contents).
                for (const c of columnContents(items, id))
                    items[c] = { ...items[c], boardId };
            }
            // Comments stay on the same board as what they're about.
            for (const it of Object.values(items)) {
                if (it.kind === 'comment' && items[it.targetId] && items[it.targetId].boardId !== it.boardId) {
                    items[it.id] = { ...it, boardId: items[it.targetId].boardId };
                }
            }
            return { items, topZ };
        });
    },
    detach(id, at) {
        set((s) => {
            const items = unparent(s.items, id);
            const note = items[id];
            if (!isStackable(note))
                return s;
            const z = s.topZ + 1;
            return { items: { ...items, [id]: { ...note, parentId: null, x: at.x, y: at.y, z } }, topZ: z };
        });
    },
}), {
    name: 'heist:board:local-default',
    version: 5,
    storage: createJSONStorage(() => safeStorage),
    partialize: (s) => ({ items: s.items, topZ: s.topZ }),
    migrate: (persisted, version) => {
        let state = persisted;
        // v0 stored text cards as `cards`.
        if (version === 0 && state.cards) {
            const items = {};
            for (const c of Object.values(state.cards))
                items[c.id] = { ...c, kind: 'comment', parentId: null };
            state = { items, topZ: state.topZ ?? 0 };
        }
        // v1 had a single board; everything moves into the user's Home.
        if (version < 2) {
            for (const it of Object.values(state.items ?? {}))
                it.boardId = homeId();
        }
        // v3: "comments" are now notes, and strips moved from notes to columns.
        if (version < 3) {
            const items = {};
            for (const raw of Object.values(state.items ?? {})) {
                if (raw.kind === 'comment') {
                    const { strip: _strip, ...rest } = raw;
                    items[raw.id] = { ...DEFAULTS.note, ...rest, kind: 'note' };
                }
                else if (raw.kind === 'column') {
                    items[raw.id] = { ...DEFAULTS.column, ...raw };
                }
                else {
                    items[raw.id] = { parentId: null, ...raw };
                }
            }
            state = { items, topZ: state.topZ ?? 0 };
        }
        // v4: columns can nest and have a direction.
        if (version < 4) {
            for (const it of Object.values(state.items ?? {})) {
                if (it.kind === 'column')
                    Object.assign(it, { parentId: it.parentId ?? null, direction: it.direction ?? 'vertical' });
            }
        }
        // v5: direction becomes a grid column count (horizontal = one row).
        if (version < 5) {
            for (const it of Object.values(state.items ?? {})) {
                if (it.kind !== 'column')
                    continue;
                it.cols = it.direction === 'horizontal' ? Math.max(1, it.childIds.length) : 1;
                delete it.direction;
            }
        }
        return state;
    },
}));
