// Versions of a video. Dropping one video card onto another makes it the new
// version (v2, v3…): the target keeps its place, comments and history, and the
// earlier file is kept in `versions`. Comments belong to the version they were
// made on.
import { stackZ, useBoard } from './store';
import { session } from '../session';
import { itemSize, posOf } from './actions';
import { useLocalMedia } from './media';
/** The current version's number (1 with no history). */
export const versionOf = (m) => (m.versions?.length ?? 0) + 1;
/** Which version a comment is on. */
export const commentVersion = (c) => c.version ?? 1;
/** Only the comments on one version (or all, for null). */
export const forVersion = (list, version) => version == null ? list : list.filter((c) => commentVersion(c) === version);
/** Can this item be stacked as / onto a video version? */
export const isVideo = (it) => it?.kind === 'media' && it.mediaType === 'video';
/** Review statuses, in the order they're offered. */
export const STATUSES = [
    { value: 'review', label: 'Needs review', color: '#f5a524' },
    { value: 'changes', label: 'Changes requested', color: '#e5484d' },
    { value: 'approved', label: 'Approved', color: '#30a46c' },
];
export const statusInfo = (s) => STATUSES.find((x) => x.value === s) ?? null;
/** The item's current file as a history entry. */
const currentEntry = (m) => ({
    src: m.src, name: m.name, meta: m.meta, addedAt: m.versionAt ?? 0, addedBy: m.versionBy ?? null,
    label: m.versionLabel ?? null, status: m.status ?? null,
});
/** Every version of a video, newest first. */
export function versionList(m) {
    const old = (m.versions ?? []).map((v, i) => ({
        n: i + 1, src: v.src, name: v.name, meta: v.meta, addedAt: v.addedAt, addedBy: v.addedBy ?? null,
        label: v.label ?? null, status: v.status ?? null, current: false,
    }));
    const cur = {
        n: versionOf(m), src: m.src, name: m.name, meta: m.meta,
        addedAt: m.versionAt ?? null, addedBy: m.versionBy ?? null,
        label: m.versionLabel ?? null, status: m.status ?? null, current: true,
    };
    return [cur, ...old.reverse()];
}
/** One version of a video (falls back to the current one). */
export function versionInfo(m, n) {
    const all = versionList(m);
    return all.find((v) => v.n === n) ?? all[0];
}
/** Video card under the pointer that a dragged video could be stacked onto. */
export function videoTargetAt(p, boardId, exclude) {
    const { items } = useBoard.getState();
    let hit = null;
    let hitZ = -Infinity;
    for (const it of Object.values(items)) {
        if (!isVideo(it) || !it.src || it.boardId !== boardId || exclude.has(it.id))
            continue;
        const o = posOf(it);
        const { w, h } = itemSize(it);
        if (p.x < o.x || p.x > o.x + w || p.y < o.y || p.y > o.y + h)
            continue;
        const z = stackZ(items, it.id);
        if (z > hitZ) {
            hit = it.id;
            hitZ = z;
        }
    }
    return hit;
}
/**
 * Stack video `fromId` onto `ontoId` as its newest version. The target's
 * current file joins its history, then the dragged card's own history, then
 * the dragged file becomes current; the dragged card's comments move across
 * (renumbered to match) and the card goes. Returns the new version number.
 */
export function stackVersion(fromId, ontoId) {
    const { items, updateItem, removeItem } = useBoard.getState();
    const from = items[fromId];
    const onto = items[ontoId];
    if (!isVideo(from) || !isVideo(onto) || !from.src || !onto.src || fromId === ontoId)
        return null;
    const now = Date.now();
    const offset = versionOf(onto); // the dragged card's v1 lands right after the target's current
    const history = [...(onto.versions ?? []), currentEntry(onto), ...(from.versions ?? [])];
    for (const it of Object.values(items)) {
        if (it.kind === 'comment' && it.targetId === fromId) {
            updateItem(it.id, { targetId: ontoId, boardId: onto.boardId, version: offset + commentVersion(it) });
        }
    }
    updateItem(ontoId, {
        versions: history, src: from.src, name: from.name, meta: from.meta,
        versionAt: now, versionBy: session.userId, versionLabel: from.versionLabel ?? null, status: from.status ?? null,
    });
    // A card shows its local copy of a fresh upload; the target now shows the dragged one's (or the stored file).
    useLocalMedia.setState((s) => {
        const next = { ...s };
        if (s[fromId])
            next[ontoId] = s[fromId];
        else
            delete next[ontoId];
        delete next[fromId];
        return next;
    }, true);
    removeItem(fromId);
    return history.length + 1;
}
/**
 * A new file becomes the newest version (from a file dropped onto the card,
 * or restoring an earlier one). Starts with no status. Returns its number.
 */
export function addVersion(id, file, label = null) {
    const { items, updateItem } = useBoard.getState();
    const m = items[id];
    if (!isVideo(m))
        return null;
    const history = [...(m.versions ?? []), currentEntry(m)];
    updateItem(id, {
        versions: history, src: file.src, name: file.name, meta: file.meta,
        versionAt: Date.now(), versionBy: session.userId, versionLabel: label, status: null,
    });
    return history.length + 1;
}
/** Change something about version `n` (the current one lives on the item itself). */
function patchVersion(id, n, patch) {
    const { items, updateItem } = useBoard.getState();
    const m = items[id];
    if (m?.kind !== 'media')
        return;
    if (n === versionOf(m)) {
        updateItem(id, {
            ...('label' in patch ? { versionLabel: patch.label } : {}),
            ...('status' in patch ? { status: patch.status } : {}),
        });
        return;
    }
    updateItem(id, { versions: (m.versions ?? []).map((v, i) => (i + 1 === n ? { ...v, ...patch } : v)) });
}
export const renameVersion = (id, n, label) => patchVersion(id, n, { label: label.trim() || null });
export const setStatus = (id, n, status) => patchVersion(id, n, { status });
/** Put an earlier version back on top, as a new version (its comments stay where they were). */
export function restoreVersion(id, n) {
    const m = useBoard.getState().items[id];
    if (!isVideo(m))
        return null;
    const v = versionInfo(m, n);
    return addVersion(id, { src: v.src, name: v.name, meta: v.meta }, `Restored v${n}`);
}
/**
 * Remove version `n` and its comments; later versions move down one (their
 * comments too). Removing the newest makes the one before it current. The
 * only version can't be removed (delete the card instead).
 */
export function deleteVersion(id, n) {
    const { items, updateItem, removeItem } = useBoard.getState();
    const m = items[id];
    if (!isVideo(m) || !m.versions?.length)
        return;
    const all = [...m.versions, currentEntry(m)];
    if (n < 1 || n > all.length)
        return;
    const wasCurrent = n === all.length;
    all.splice(n - 1, 1);
    const cur = all.pop();
    for (const c of Object.values(items)) {
        if (c.kind !== 'comment' || c.targetId !== id)
            continue;
        const v = commentVersion(c);
        if (v === n)
            removeItem(c.id);
        else if (v > n)
            updateItem(c.id, { version: v - 1 });
    }
    updateItem(id, {
        versions: all, src: cur.src, name: cur.name, meta: cur.meta, versionAt: cur.addedAt || null, versionBy: cur.addedBy ?? null,
        versionLabel: cur.label ?? null, status: cur.status ?? null,
    });
    if (wasCurrent)
        useLocalMedia.setState((s) => { const next = { ...s }; delete next[id]; return next; }, true);
}
