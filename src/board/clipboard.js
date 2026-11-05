// Copy, cut, paste and duplicate. Boards are left out (they'd mean copying a
// whole subtree of boards); a column comes with everything inside it.
//
// The clipboard is kept in localStorage so it survives a reload and works
// across boards.
import { newId } from '../lib/id';
import { columnContents, parentOf, useBoard } from './store';
import { useUi } from './ui';
import { currentBoardId } from './nav';
import { deleteItem, itemSize, posOf, viewportCenterWorld } from './actions';
import { snap } from './layout';
import { GRID_SIZE } from '../canvas/grid';
const KEY = 'heist:clipboard';
const STEP = GRID_SIZE; // each repeat paste/duplicate steps down-right by one grid cell
let pasteCount = 0;
const board = useBoard.getState;
const ui = useUi.getState;
function readClip() {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    }
    catch {
        return null;
    }
}
export const hasClipboard = () => !!readClip()?.roots.length;
/** The selection minus boards, and minus anything inside a selected column. */
function copyable(ids) {
    const { items } = board();
    const chosen = new Set(ids.filter((id) => items[id] && items[id].kind !== 'board'));
    const insideChosen = (id) => {
        for (let p = parentOf(items[id]); p; p = parentOf(items[p]))
            if (chosen.has(p))
                return true;
        return false;
    };
    return [...chosen].filter((id) => !insideChosen(id));
}
/** Snapshot items (and column contents, minus boards) for copying. */
function snapshot(rootIds) {
    const { items } = board();
    const list = [];
    for (const id of rootIds) {
        list.push(structuredClone(items[id]));
        for (const c of columnContents(items, id))
            if (items[c].kind !== 'board')
                list.push(structuredClone(items[c]));
    }
    return { roots: rootIds.map((id) => ({ id, at: posOf(items[id]) })), items: list, boardId: currentBoardId() };
}
/**
 * Fresh copies of a snapshot: new ids, on the current board, roots placed at
 * `place(root)`. Returns the copies and the new id for each old one.
 */
function clone(clip, place) {
    const ids = new Map(clip.items.map((it) => [it.id, newId()]));
    const roots = new Map(clip.roots.map((r) => [r.id, r]));
    const boardId = currentBoardId();
    const copies = clip.items.map((it) => {
        const copy = { ...structuredClone(it), id: ids.get(it.id), boardId };
        const root = roots.get(it.id);
        if (root)
            Object.assign(copy, place(root), { parentId: null });
        else
            copy.parentId = ids.get(parentOf(it) ?? '') ?? null;
        if (copy.kind === 'column')
            copy.childIds = copy.childIds.map((c) => ids.get(c)).filter((c) => !!c);
        return copy;
    });
    return { copies, ids };
}
/** Plain text for copied cards (for pasting elsewhere): note text, list items, links, names. */
function plainText(roots) {
    const { items } = board();
    const one = (id) => {
        const it = items[id];
        if (!it)
            return '';
        switch (it.kind) {
            case 'note': return it.text;
            case 'todo': return it.entries.map((e) => `${e.done ? '[x]' : '[ ]'} ${e.text}`).join('\n');
            case 'link': return it.url;
            case 'media': return it.name;
            case 'column': return [it.title, ...it.childIds.map(one)].filter(Boolean).join('\n');
            case 'frame': return it.title;
            default: return '';
        }
    };
    return roots.map(one).filter((t) => t.trim()).join('\n\n');
}
export function copySelection() {
    const roots = copyable(ui().selectedIds);
    if (!roots.length)
        return false;
    // On the system clipboard too (pasting elsewhere gets the text). Something always goes
    // there, so a later paste can tell these cards from text copied in another app.
    const text = plainText(roots) || `${roots.length} Heist ${roots.length === 1 ? 'card' : 'cards'}`;
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...snapshot(roots), text }));
    }
    catch {
        return false;
    }
    void navigator.clipboard?.writeText(text).catch(() => { });
    pasteCount = 0;
    return true;
}
/** Whether text on the system clipboard is what our own last copy put there. */
export const isOwnCopy = (text) => !!text && readClip()?.text?.trim() === text.trim();
export function cutSelection() {
    const roots = copyable(ui().selectedIds);
    if (!roots.length || !copySelection())
        return;
    const { items } = board();
    for (const id of roots) {
        // A cut column takes what was copied with it (innermost first); any
        // boards inside weren't copied, so they stay on the board.
        for (const c of columnContents(items, id).reverse())
            if (items[c].kind !== 'board')
                deleteItem(c);
        deleteItem(id);
    }
    ui().set({ selectedIds: [] });
}
/**
 * Paste the clipboard. At a point (right-click "Paste here"), or else just
 * offset from the originals on the same board, or centred in view elsewhere.
 * Pasted items end up selected.
 */
export function paste(at) {
    const clip = readClip();
    if (!clip?.roots.length)
        return;
    const x0 = Math.min(...clip.roots.map((r) => r.at.x));
    const y0 = Math.min(...clip.roots.map((r) => r.at.y));
    let origin;
    if (at) {
        origin = at;
    }
    else if (clip.boardId === currentBoardId()) {
        pasteCount++;
        origin = { x: x0 + STEP * pasteCount, y: y0 + STEP * pasteCount };
    }
    else {
        const { items } = board();
        const x1 = Math.max(...clip.roots.map((r) => r.at.x + (items[r.id] ? itemSize(items[r.id]).w : 240)));
        const c = viewportCenterWorld();
        origin = { x: c.x - (x1 - x0) / 2, y: c.y - 60 };
    }
    const { copies, ids } = clone(clip, (r) => ({ x: snap(origin.x + r.at.x - x0), y: snap(origin.y + r.at.y - y0) }));
    board().insertItems(copies);
    ui().set({ selectedIds: clip.roots.map((r) => ids.get(r.id)), editingId: null, contextMenu: null });
}
/**
 * Duplicate the selection in place: stacked items get their copy right below
 * them in the same column; everything else a grid step down-right.
 */
export function duplicateSelection() {
    const roots = copyable(ui().selectedIds);
    if (!roots.length)
        return;
    const { items } = board();
    const clip = snapshot(roots);
    const { copies, ids } = clone(clip, (r) => ({ x: r.at.x + STEP, y: r.at.y + STEP }));
    board().insertItems(copies);
    // Copies of stacked items go back into the same column, just after the original.
    for (const id of roots) {
        const parent = parentOf(items[id]);
        const col = parent ? board().items[parent] : undefined;
        if (col?.kind === 'column')
            board().moveToColumn(ids.get(id), col.id, col.childIds.indexOf(id) + 1);
    }
    ui().set({ selectedIds: roots.map((id) => ids.get(id)), editingId: null, contextMenu: null });
}
