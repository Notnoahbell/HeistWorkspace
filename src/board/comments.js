// Comments on notes, to-dos, links, photos and videos. Each comment is an item
// of kind 'comment' pointing at its target (see store.ts), so it syncs, shares
// and merges per comment. Video comments can carry a timecode; replies point
// at their thread's first comment; @mentions are stored as user ids.
// Notifications are worked out from the comments you can see.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { useBoard } from './store';
import { session, homeId, isHome } from '../session';
import { usePresence } from '../sync/presence';
import { setTyping } from '../sync/client';
import { commentVersion, versionOf } from './versions';
const EMPTY = [];
/** Comments grouped by target, in reading order: by timecode (untimed first), then oldest first. */
let indexed = null;
let index = new Map();
export function commentIndex(items) {
    if (items === indexed)
        return index;
    const next = new Map();
    for (const it of Object.values(items)) {
        if (it.kind !== 'comment')
            continue;
        const list = next.get(it.targetId);
        if (list)
            list.push(it);
        else
            next.set(it.targetId, [it]);
    }
    for (const list of next.values())
        list.sort((a, b) => (a.time ?? -1) - (b.time ?? -1) || a.createdAt - b.createdAt);
    indexed = items;
    index = next;
    return next;
}
/** Every comment on an item (replies included), in order. */
export const useComments = (targetId) => useBoard(useShallow((s) => commentIndex(s.items).get(targetId) ?? EMPTY));
/** Comments as threads: each first comment with its replies (oldest first). */
export function toThreads(list) {
    const byRoot = new Map();
    for (const c of list)
        if (c.replyTo)
            (byRoot.get(c.replyTo) ?? byRoot.set(c.replyTo, []).get(c.replyTo)).push(c);
    return list
        .filter((c) => !c.replyTo)
        .map((root) => ({ root, replies: (byRoot.get(root.id) ?? []).sort((a, b) => a.createdAt - b.createdAt) }));
}
/**
 * Videos have threads (one per moment, each with its replies). Everything else
 * has a single conversation: every comment is a reply to it, oldest first.
 */
export const isThreaded = (it) => it?.kind === 'media' && it.mediaType === 'video';
/**
 * What the card's badge counts: open threads on a video (its current version,
 * or the one given), open comments on anything else.
 */
export const useOpenCount = (targetId, version) => useBoard((s) => {
    const target = s.items[targetId];
    const threaded = isThreaded(target);
    const v = threaded ? version ?? versionOf(target) : null;
    return (commentIndex(s.items).get(targetId) ?? EMPTY).reduce((n, c) => n + (!threaded || (!c.replyTo && commentVersion(c) === v) ? 1 : 0), 0);
});
export function addComment(targetId, text, opts = {}) {
    const { items } = useBoard.getState();
    const target = items[targetId];
    const body = text.trim();
    if (!target || !body)
        return;
    // On a video: the version it's on (a reply follows its thread; otherwise the one being viewed, else the current one).
    const root = opts.replyTo ? items[opts.replyTo] : undefined;
    const version = !isThreaded(target) ? undefined
        : root?.kind === 'comment' ? commentVersion(root)
            : opts.version ?? versionOf(target);
    const mentions = mentionsIn(body, membersOf(target.boardId));
    useBoard.getState().addItem('comment', {
        boardId: target.boardId, x: 0, y: 0,
        targetId,
        authorId: session.userId,
        authorName: usePresence.getState().me?.name ?? 'Me',
        text: body,
        createdAt: Date.now(),
        time: !opts.replyTo && opts.time != null && Number.isFinite(opts.time) ? opts.time : null,
        replyTo: opts.replyTo ?? null,
        mentions,
        ...(version != null ? { version } : {}),
        ...(!opts.replyTo && opts.timeEnd != null && opts.time != null && opts.timeEnd > opts.time ? { timeEnd: opts.timeEnd } : {}),
        ...(!opts.replyTo && opts.drawing?.length ? { drawing: opts.drawing } : {}),
    });
}
/** Change your comment's text (mentions are worked out again). */
export function editComment(id, text) {
    const { items, updateItem } = useBoard.getState();
    const c = items[id];
    const body = text.trim();
    if (c?.kind !== 'comment' || c.authorId !== session.userId || !body || body === c.text)
        return;
    updateItem(id, { text: body, mentions: mentionsIn(body, membersOf(c.boardId)), editedAt: Date.now() });
}
/** The reactions anyone can leave on a comment. */
export const REACTIONS = ['👍', '🔥', '❤️', '😂', '💯', '👎'];
/** Add your reaction to a comment, or take it back. */
export function toggleReaction(id, emoji) {
    const c = useBoard.getState().items[id];
    if (c?.kind !== 'comment')
        return;
    const next = { ...c.reactions };
    const who = next[emoji] ?? [];
    next[emoji] = who.includes(session.userId) ? who.filter((u) => u !== session.userId) : [...who, session.userId];
    if (!next[emoji].length)
        delete next[emoji];
    useBoard.getState().updateItem(id, { reactions: next });
}
/** Delete a comment; deleting a thread's first comment takes its replies too. */
export function deleteComment(id) {
    const { items, removeItem } = useBoard.getState();
    for (const it of Object.values(items))
        if (it.kind === 'comment' && it.replyTo === id)
            removeItem(it.id);
    removeItem(id);
}
/** "now", "5m", "3h", "2d", or a date. */
export function timeAgo(ms, now = Date.now()) {
    const s = Math.max(0, (now - ms) / 1000);
    if (s < 45)
        return 'now';
    if (s < 3600)
        return `${Math.round(s / 60)}m`;
    if (s < 86400)
        return `${Math.round(s / 3600)}h`;
    if (s < 86400 * 7)
        return `${Math.round(s / 86400)}d`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Video elements of media cards on screen, so a comment can pick up (or jump to) the card's time. */
export const cardVideos = new Map();
// --- Mentions ---------------------------------------------------------------------------
/** Everyone who can see a board: the Home's owner plus whoever it (or a board above it) is shared with. */
export function membersOf(boardId, items = useBoard.getState().items) {
    const out = new Set();
    for (let b = boardId, guard = 0; b && guard < 64; guard++) {
        if (isHome(b)) {
            out.add(b.slice(5));
            break;
        }
        const board = items[b];
        if (!board || board.kind !== 'board')
            break;
        for (const u of board.sharedWith ?? [])
            out.add(u);
        b = board.boardId;
    }
    return [...out];
}
/** Ids of the members whose "@Name" appears in the text. */
function mentionsIn(text, members) {
    const users = usePresence.getState().users;
    return members.filter((id) => {
        const name = users[id]?.name;
        return !!name && text.toLowerCase().includes(`@${name.toLowerCase()}`);
    });
}
// --- Typing --------------------------------------------------------------------------------
let typingTimer = null;
let typingOn = null;
/** Call on each keystroke in a comment box: others see you typing until you pause. */
export function noteTyping(targetId, hasText) {
    if (typingTimer)
        clearTimeout(typingTimer);
    if (!hasText) {
        stopTyping(targetId);
        return;
    }
    typingOn = targetId;
    setTyping(targetId);
    typingTimer = setTimeout(() => stopTyping(targetId), 4000);
}
export function stopTyping(targetId) {
    if (typingOn !== targetId)
        return;
    typingOn = null;
    setTyping(null);
}
/** Other people (on this board) writing a comment on the item right now. */
export const useTypers = (targetId) => usePresence(useShallow((s) => Object.values(s.peers).filter((p) => p.typing === targetId && p.userId !== session.userId)));
/** Mentions of you, and replies in threads you started or joined — newest first. */
let noticed = null;
let noticeCache = [];
let noticeFor = '';
export function noticesFrom(items, me = session.userId) {
    if (items === noticed && me === noticeFor)
        return noticeCache;
    const comments = Object.values(items).filter((it) => it.kind === 'comment');
    const mine = new Set(); // threads you're part of
    const joined = new Map(); // conversations you're part of → when you joined
    for (const c of comments) {
        if (c.authorId !== me)
            continue;
        mine.add(c.replyTo ?? c.id);
        joined.set(c.targetId, Math.min(joined.get(c.targetId) ?? Infinity, c.createdAt));
    }
    const out = [];
    for (const c of comments) {
        if (c.authorId === me)
            continue;
        if (c.mentions?.includes(me))
            out.push({ comment: c, kind: 'mention' });
        else if (c.replyTo && mine.has(c.replyTo))
            out.push({ comment: c, kind: 'reply' });
        else if (!isThreaded(items[c.targetId]) && c.createdAt > (joined.get(c.targetId) ?? Infinity))
            out.push({ comment: c, kind: 'reply' });
    }
    out.sort((a, b) => b.comment.createdAt - a.comment.createdAt);
    noticed = items;
    noticeFor = me;
    noticeCache = out;
    return out;
}
export const useNotices = () => useBoard((s) => noticesFrom(s.items));
export const useNoticeRead = create()(persist(() => ({ byUser: {} }), { name: 'heist:notices' }));
const readOf = (s) => s.byUser[session.userId] ?? { seenAt: 0, read: [] };
export const isUnread = (n, s = useNoticeRead.getState()) => {
    const r = readOf(s);
    return n.comment.createdAt > r.seenAt && !r.read.includes(n.comment.id);
};
export function markRead(id) {
    useNoticeRead.setState((s) => {
        const r = readOf(s);
        return { byUser: { ...s.byUser, [session.userId]: { ...r, read: [...r.read.slice(-200), id] } } };
    });
}
export function markAllRead() {
    useNoticeRead.setState((s) => ({ byUser: { ...s.byUser, [session.userId]: { seenAt: Date.now(), read: [] } } }));
}
/** A short label for what a comment is on: "“Opening shot…”", "shot-010.mp4". */
export function targetLabel(target) {
    if (!target)
        return 'a deleted item';
    switch (target.kind) {
        case 'note': {
            const line = target.text.split('\n')[0].trim();
            return line ? `“${line.length > 40 ? `${line.slice(0, 40)}…` : line}”` : 'a note';
        }
        case 'todo': return 'a to-do list';
        case 'link': return target.preview?.title || target.url || 'a link';
        case 'media': return target.name || (target.mediaType === 'video' ? 'a video' : 'a photo');
        default: return 'an item';
    }
}
/** The board's name for a notification ("Home" for a Home). */
export function boardLabel(boardId, items = useBoard.getState().items) {
    if (boardId === homeId())
        return 'your Home';
    if (isHome(boardId))
        return 'Home';
    const b = items[boardId];
    return b?.kind === 'board' ? b.title || 'Untitled board' : 'a board';
}
