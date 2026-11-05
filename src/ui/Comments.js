import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Comments UI: the count badge on a card, the panel beside a selected card
// (one conversation, or a video's threads), the full list for the player,
// replies, reactions, @mentions and typing indicators.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUp, Check, ChevronDown, Clock, Pencil, PenLine, SmilePlus, Trash2, X } from 'lucide-react';
import { clearDraft, useDraft } from './Annotate';
import { COMMENTABLE, useBoard } from '../board/store';
import { forVersion, isVideo, versionOf } from '../board/versions';
import { useUi } from '../board/ui';
import { useLayout } from '../board/layout';
import { useBoardId } from '../board/nav';
import { itemSize, posOf } from '../board/actions';
import { addComment, cardVideos, deleteComment, editComment, isThreaded, membersOf, noteTyping, REACTIONS, stopTyping, timeAgo, toggleReaction, toThreads, useComments, useOpenCount, useTypers, } from '../board/comments';
import { camera } from '../canvas/camera';
import { session } from '../session';
import { personalColor, usePresence } from '../sync/presence';
import { Avatar } from './Collab';
import { byLine, fullDate } from '../lib/time';
import { fmtTime } from './Scrubber';
const ICON = { size: 14, strokeWidth: 2.2, 'aria-hidden': true };
/** Threads shown beside a card before "Show N more". */
const QUICK_MAX = 5;
const POP_WIDTH = 344;
const GAP = 14;
export const CommentLookContext = createContext({ fmt: fmtTime, numbered: false, activeId: null });
// --- Badge on the card ------------------------------------------------------------
/** Top-right corner of a card: open-thread count, and dots while someone's writing a comment. */
export function CommentBadge({ id }) {
    const n = useOpenCount(id);
    const typers = useTypers(id);
    if (!n && !typers.length)
        return null;
    return (_jsxs("span", { className: "cmt-corner", children: [typers.length > 0 && (_jsx("span", { className: "cmt-typing-bubble", style: { background: typers[0].color }, title: `${names(typers)} ${typers.length === 1 ? 'is' : 'are'} commenting`, children: _jsx(Dots, {}) })), n > 0 && _jsx("span", { className: "cmt-badge", title: `${n} open comment${n === 1 ? '' : 's'}`, children: n > 9 ? '9+' : n })] }));
}
const Dots = () => _jsxs("span", { className: "dots", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] });
const names = (people) => people.length <= 2 ? people.map((p) => p.name).join(' and ') : `${people[0].name} and ${people.length - 1} others`;
/** "Olive Otter is typing…" under a thread list. */
function Typing({ targetId }) {
    const typers = useTypers(targetId);
    if (!typers.length)
        return null;
    return (_jsxs("div", { className: "cmt-typing", style: { '--who': typers[0].color }, children: [_jsx(Dots, {}), " ", names(typers), " ", typers.length === 1 ? 'is' : 'are', " typing\u2026"] }));
}
// --- Text with @mentions --------------------------------------------------------------
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function CommentText({ c }) {
    const users = usePresence((s) => s.users);
    const parts = useMemo(() => {
        const named = (c.mentions ?? []).map((id) => ({ id, name: users[id]?.name })).filter((m) => !!m.name);
        if (!named.length)
            return [c.text];
        const re = new RegExp(`(@(?:${named.map((m) => escape(m.name)).join('|')}))`, 'gi');
        return c.text.split(re).map((part, i) => {
            const who = named.find((m) => `@${m.name}`.toLowerCase() === part.toLowerCase());
            return who ? _jsx("span", { className: "cmt-mention", "data-me": who.id === session.userId || undefined, children: part }, i) : part;
        });
    }, [c.text, c.mentions, users]);
    return _jsx(_Fragment, { children: parts });
}
// --- One comment -------------------------------------------------------------------
function CommentRow({ c, reply, onSeek, onReply, number }) {
    const look = useContext(CommentLookContext);
    const profile = usePresence((s) => s.users[c.authorId]);
    const name = profile?.name ?? c.authorName;
    const mine = c.authorId === session.userId;
    const [editing, setEditing] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const row = useRef(null);
    const remove = () => {
        // A reply goes on its own; a thread's first comment takes the thread with it.
        const el = (reply ? row.current : row.current?.closest('.cmt-thread'));
        if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            deleteComment(c.id);
            return;
        }
        // The last one beside a card takes the panel with it: let the whole panel go, not just the row.
        const pop = el.closest('.cmt-pop');
        const last = !reply && pop && pop.querySelectorAll('.cmt-thread').length === 1 && useUi.getState().commenting !== c.targetId;
        (last ? animatePanelOut(pop) : animateOut(el)).then(() => deleteComment(c.id));
    };
    // Delete takes a second click, so a slip off a reaction can't remove a comment.
    useEffect(() => {
        if (!confirming)
            return;
        const t = setTimeout(() => setConfirming(false), 3000);
        return () => clearTimeout(t);
    }, [confirming]);
    return (_jsxs("div", { ref: row, className: "cmt", "data-reply": reply || undefined, "data-editing": editing || undefined, children: [_jsx(Avatar, { profile: { name, icon: profile?.icon ?? null }, color: personalColor(c.authorId), size: reply ? 22 : 26 }), _jsxs("div", { className: "cmt-body", children: [_jsxs("header", { className: "cmt-meta", children: [_jsx("span", { className: "cmt-author", title: name, children: mine ? 'You' : name }), _jsxs("span", { className: "cmt-when", title: [byLine(name, c.createdAt), c.editedAt ? `Edited ${fullDate(c.editedAt)}` : ''].filter(Boolean).join('\n'), children: [timeAgo(c.createdAt), c.editedAt ? ' · edited' : ''] }), look.numbered && number != null && _jsxs("span", { className: "cmt-num", children: ["#", number] }), _jsxs("span", { className: "cmt-tools", children: [_jsx(ReactButton, { c: c }), mine && (_jsxs("span", { className: "cmt-own", children: [_jsx("button", { className: "cmt-tool", title: "Edit", "aria-label": "Edit", "aria-pressed": editing, onMouseDown: (e) => e.preventDefault(), onClick: () => setEditing((e) => !e), children: _jsx(Pencil, { ...ICON }) }), _jsxs("button", { className: "cmt-tool cmt-delete", "data-confirm": confirming || undefined, title: confirming ? 'Click again to delete' : reply ? 'Delete reply' : 'Delete comment', "aria-label": confirming ? 'Confirm delete' : 'Delete', onClick: () => (confirming ? remove() : setConfirming(true)), onBlur: () => setConfirming(false), children: [_jsx(Trash2, { ...ICON }), _jsx("span", { className: "cmt-delete-label", "aria-hidden": "true", children: "Delete?" })] })] }))] })] }), editing ? (_jsx(Composer, { targetId: c.targetId, initialText: c.text, autoFocus: true, placeholder: "Edit comment\u2026", submitLabel: "Save", onSubmit: (text) => editComment(c.id, text), onDone: () => setEditing(false), onCancel: () => setEditing(false), cancelOnBlur: true })) : (_jsxs("p", { className: "cmt-text", children: [c.time != null && (_jsxs("button", { className: "cmt-time", title: c.drawing?.length ? 'Jump here and show the drawing' : 'Jump to this moment', disabled: !onSeek && !look.onPick, onClick: (e) => { e.stopPropagation(); if (look.onPick)
                                    look.onPick(c);
                                else
                                    onSeek?.(c.time); }, children: [look.fmt(c.time), c.timeEnd != null && _jsxs(_Fragment, { children: [" \u2013 ", look.fmt(c.timeEnd)] }), c.drawing?.length ? _jsx(PenLine, { size: 11, strokeWidth: 2.6, "aria-label": "with a drawing" }) : null] })), _jsx(CommentText, { c: c })] })), (onReply || REACTIONS.some((r) => c.reactions?.[r]?.length)) && (_jsxs("div", { className: "cmt-foot", children: [_jsx(Reactions, { c: c }), onReply && _jsx("button", { className: "cmt-reply-btn", onClick: onReply, children: "Reply" })] }))] })] }));
}
/**
 * The react button. Pressing it pops the six emoji out in a ring around it
 * (fixed to the screen, so nothing clips it); pick one, press the middle,
 * click away, scroll or Escape to close.
 */
function ReactButton({ c }) {
    const ref = useRef(null);
    const [at, setAt] = useState(null);
    useEffect(() => {
        if (!at)
            return;
        const close = () => setAt(null);
        const away = (e) => { if (!e.target.closest?.('.cmt-ring'))
            close(); };
        const key = (e) => { if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        } };
        window.addEventListener('pointerdown', away, true);
        window.addEventListener('keydown', key, true);
        window.addEventListener('wheel', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('pointerdown', away, true);
            window.removeEventListener('keydown', key, true);
            window.removeEventListener('wheel', close, true);
            window.removeEventListener('resize', close);
        };
    }, [at]);
    const open = () => {
        const r = ref.current.getBoundingClientRect();
        setAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", { ref: ref, className: "cmt-tool cmt-react-add", title: "React", "aria-label": "React", "aria-expanded": !!at, onClick: open, children: _jsx(SmilePlus, { size: 16, strokeWidth: 2, "aria-hidden": "true" }) }), at && (_jsxs("div", { className: "cmt-ring", role: "group", "aria-label": "Reactions", style: { left: at.x, top: at.y }, onClick: (e) => { if (e.target === e.currentTarget)
                    setAt(null); }, children: [REACTIONS.map((r, i) => (_jsx("button", { className: "cmt-emoji", style: { '--a': `${i * 60 - 90}deg`, '--i': i }, title: `React ${r}`, "aria-label": `React ${r}`, "aria-pressed": !!c.reactions?.[r]?.includes(session.userId), onClick: () => { toggleReaction(c.id, r); setAt(null); }, children: r }, r))), _jsx("button", { className: "cmt-ring-close", title: "Close", "aria-label": "Close reactions", onClick: () => setAt(null), children: _jsx(X, { size: 13, strokeWidth: 2.4, "aria-hidden": "true" }) })] }))] }));
}
/** Reaction chips under a comment: click one to add yours, or take it back. */
function Reactions({ c }) {
    const users = usePresence((s) => s.users);
    return (_jsx(_Fragment, { children: REACTIONS.filter((r) => c.reactions?.[r]?.length).map((r) => {
            const who = c.reactions[r];
            const names = who.map((id) => (id === session.userId ? 'You' : users[id]?.name ?? 'Someone'));
            return (_jsxs("button", { className: "cmt-react", "aria-pressed": who.includes(session.userId), title: names.join(', '), onClick: (e) => { e.stopPropagation(); toggleReaction(c.id, r); }, children: [_jsx("span", { "aria-hidden": "true", children: r }), who.length] }, r));
        }) }));
}
/**
 * While a comment animates past the edge of the list, don't let a scrollbar
 * flash up (unless the list already scrolls). Returns the undo.
 */
function holdScrollbar(el) {
    const list = el.closest('.cmt-list');
    if (!list || list.scrollHeight > list.clientHeight + 1)
        return () => { };
    list.style.overflowY = 'hidden';
    return () => { list.style.overflowY = ''; };
}
/** Fade and slide a comment away, then close the gap it leaves (the rest move up to fill it). */
async function animateOut(el) {
    el.style.pointerEvents = 'none';
    holdScrollbar(el); // the list re-renders without it afterwards, so no need to undo
    await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }], { duration: 100, easing: 'ease-in', fill: 'forwards' }).finished;
    const cs = getComputedStyle(el);
    el.style.overflow = 'hidden';
    await el.animate([
        { height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
    ], { duration: 140, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'forwards' }).finished;
}
/** The panel beside a card leaving: a quick fade as it drifts back toward the card. */
async function animatePanelOut(pop) {
    pop.style.pointerEvents = 'none';
    await pop.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-10px) scale(0.97)' }], { duration: 170, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished;
}
/** Threads already shown once in this session. */
const seenThreads = new Set();
/** Where the last comment was posted from, so it can drop into the stack from there. */
let launch = null;
/**
 * A comment you just posted slides up out of the reply box into its place,
 * and the box glides down to make room.
 */
function useDrop(ref, c, fresh) {
    useLayoutEffect(() => {
        const el = ref.current;
        const from = launch;
        if (!el || !fresh || !from || from.targetId !== c.targetId || c.authorId !== session.userId || Date.now() - from.at > 1500)
            return;
        launch = null;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        el.scrollIntoView({ block: 'nearest' });
        const to = el.getBoundingClientRect();
        const ease = 'cubic-bezier(0.25, 1, 0.5, 1)';
        el.style.animation = 'none'; // instead of the fade-in, not as well as
        const release = holdScrollbar(el);
        const slide = el.animate([{ transform: `translateY(${from.box.top - to.top}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: ease });
        slide.onfinish = slide.oncancel = release;
        const shift = from.dock.isConnected ? from.dock.getBoundingClientRect().top - from.dockTop : 0;
        if (shift > 1)
            from.dock.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'none' }], { duration: 260, easing: ease });
    }, []);
}
/** A thread: the first comment, its replies (folded away, like YouTube), and a reply box on demand. */
function ThreadCard({ t, targetId, onSeek, number }) {
    const [replying, setReplying] = useState(false);
    const [open, setOpen] = useState(false);
    const look = useContext(CommentLookContext);
    const active = look.activeId === t.root.id;
    const ref = useRef(null);
    useEffect(() => { if (active)
        ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
    // Slides in once, for a comment that's just been posted (not on every reselect).
    const [fresh] = useState(() => {
        const isNew = !seenThreads.has(t.root.id) && Date.now() - t.root.createdAt < 1500;
        seenThreads.add(t.root.id);
        return isNew;
    });
    useDrop(ref, t.root, fresh);
    const n = t.replies.length;
    return (_jsxs("article", { ref: ref, className: "cmt-thread", "data-fresh": fresh || undefined, "data-active": active || undefined, onClick: look.onPick ? (e) => { if (!e.target.closest('button, textarea, a'))
            look.onPick(t.root); } : undefined, children: [_jsx(CommentRow, { c: t.root, number: number, onSeek: onSeek, onReply: !replying ? () => { setReplying(true); setOpen(true); } : undefined }), n > 0 && (_jsxs("button", { className: "cmt-fold", "aria-expanded": open, onClick: () => setOpen((o) => !o), children: [open ? 'Hide replies' : `${n} ${n === 1 ? 'reply' : 'replies'}`, _jsx(ChevronDown, { size: 15, strokeWidth: 2.4, "aria-hidden": "true" })] })), ((open && n > 0) || replying) && (_jsxs("div", { className: "cmt-replies", children: [open && t.replies.map((r) => _jsx(CommentRow, { c: r, reply: true }, r.id)), replying && (_jsx(Composer, { targetId: targetId, replyTo: t.root.id, autoFocus: true, placeholder: "Reply\u2026", onDone: () => setReplying(false), onCancel: () => setReplying(false) }))] }))] }));
}
// --- Composer: one box, @mentions, timecode -----------------------------------------------
function Composer({ targetId, clock, replyTo, autoFocus, placeholder = 'Add a comment…', onDone, onCancel, initialText, onSubmit, submitLabel, cancelOnBlur }) {
    const [text, setText] = useState(initialText ?? '');
    const [timed, setTimed] = useState(true);
    const [now, setNow] = useState(() => clock?.() ?? null);
    const [query, setQuery] = useState(null);
    const [active, setActive] = useState(0);
    const look = useContext(CommentLookContext);
    const draft = useDraft();
    const ref = useRef(null);
    const box = useRef(null);
    /** Where the caret goes once a picked mention is in the text. */
    const caretTo = useRef(initialText?.length ?? null);
    const boardId = useBoard((s) => s.items[targetId]?.boardId ?? '');
    const users = usePresence((s) => s.users);
    const members = useBoard(useShallow((s) => membersOf(boardId, s.items)));
    // People you can @mention: whoever can see this board (not you).
    const people = useMemo(() => members.filter((id) => id !== session.userId).map((id) => users[id]).filter((p) => !!p), [members, users]);
    const matches = query ? people.filter((p) => p.name.toLowerCase().includes(query.q.toLowerCase())).slice(0, 6) : [];
    const clockRef = useRef(clock);
    clockRef.current = clock;
    const hasClock = !!clock;
    useEffect(() => {
        if (!hasClock)
            return;
        const t = setInterval(() => setNow(clockRef.current?.() ?? null), 200);
        return () => clearInterval(t);
    }, [hasClock]);
    // Grow with the text; only scroll past the cap (no scrollbar before then).
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        if (caretTo.current != null) {
            el.setSelectionRange(caretTo.current, caretTo.current);
            caretTo.current = null;
        }
        el.style.height = '0px';
        const h = el.scrollHeight;
        el.style.height = `${Math.min(140, h)}px`;
        el.style.overflowY = h > 140 ? 'auto' : 'hidden';
    }, [text]);
    useEffect(() => () => stopTyping(targetId), [targetId]);
    const findQuery = (value, caret) => {
        const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
        setQuery(m ? { start: caret - m[2].length - 1, q: m[2] } : null);
        setActive(0);
    };
    const pick = (p) => {
        const el = ref.current;
        if (!el || !query)
            return;
        const caret = el.selectionStart;
        const next = `${text.slice(0, query.start)}@${p.name} ${text.slice(caret)}`;
        caretTo.current = query.start + p.name.length + 2;
        setText(next);
        setQuery(null);
    };
    const submit = () => {
        if (!text.trim())
            return;
        if (!onSubmit && box.current) {
            const from = box.current.closest('.cmt-pop-compose, .cmt-full-compose, .cmt-replies') ?? box.current;
            launch = { targetId, box: box.current.getBoundingClientRect(), dock: from, dockTop: from.getBoundingClientRect().top, at: Date.now() };
        }
        const draft = look.review && !replyTo && !onSubmit ? useDraft.getState() : null;
        if (onSubmit)
            onSubmit(text);
        else if (draft && (draft.range || draft.shapes.length)) {
            addComment(targetId, text, {
                time: draft.range ? draft.range.a : clock?.() ?? null, timeEnd: draft.range?.b ?? null,
                drawing: draft.shapes, version: look.version,
            });
            clearDraft();
        }
        else
            addComment(targetId, text, { time: clock && timed ? clock() : null, replyTo, version: look.version });
        setText('');
        setQuery(null);
        stopTyping(targetId);
        onDone?.();
    };
    return (_jsxs("div", { ref: box, className: "cmt-composer", "data-reply": replyTo ? 'true' : undefined, onClick: () => ref.current?.focus(), children: [query && (_jsxs("div", { className: "cmt-suggest", role: "listbox", children: [matches.map((p, i) => (_jsxs("button", { role: "option", "aria-selected": i === active, onMouseDown: (e) => { e.preventDefault(); pick(p); }, onMouseEnter: () => setActive(i), children: [_jsx(Avatar, { profile: p, color: personalColor(p.id), size: 20 }), " ", p.name] }, p.id))), !matches.length && (_jsx("p", { className: "cmt-suggest-empty", children: people.length ? 'No one by that name here.' : 'Only you can see this board — share it to mention people.' }))] })), clock && !replyTo && !onSubmit && now != null && (look.review && draft.range ? (_jsxs("span", { className: "cmt-chip cmt-chip-range", "aria-pressed": "true", children: [_jsx(Clock, { size: 11, strokeWidth: 2.4, "aria-hidden": "true" }), look.fmt(draft.range.a), " \u2192 ", look.fmt(draft.range.b), _jsx("button", { className: "cmt-chip-x", title: "Back to a single moment", "aria-label": "Clear range", onClick: (e) => { e.stopPropagation(); useDraft.setState({ range: null }); }, children: _jsx(X, { size: 10, strokeWidth: 2.8, "aria-hidden": "true" }) })] })) : (_jsxs("button", { className: "cmt-chip", "aria-pressed": timed, title: timed ? 'Pinned to this moment — click to comment on the whole video (Shift-drag the timeline, or I / O, for a range)' : 'Pin to the current moment', onClick: (e) => { e.stopPropagation(); setTimed((t) => !t); }, children: [_jsx(Clock, { size: 11, strokeWidth: 2.4, "aria-hidden": "true" }), timed ? look.fmt(now) : 'Whole video'] }))), look.review && clock && !replyTo && !onSubmit && (_jsxs(_Fragment, { children: [draft.shapes.length > 0 && (_jsxs("span", { className: "cmt-chip cmt-chip-draw", "aria-pressed": "true", children: [_jsx(PenLine, { size: 11, strokeWidth: 2.4, "aria-hidden": "true" }), draft.shapes.length, " ", draft.shapes.length === 1 ? 'mark' : 'marks', _jsx("button", { className: "cmt-chip-x", title: "Remove the drawing", "aria-label": "Remove drawing", onClick: (e) => { e.stopPropagation(); useDraft.setState({ shapes: [], drawing: false }); }, children: _jsx(X, { size: 10, strokeWidth: 2.8, "aria-hidden": "true" }) })] })), _jsx("button", { className: "cmt-draw", "aria-pressed": draft.drawing, title: draft.drawing ? 'Stop drawing' : 'Draw on the frame', "aria-label": "Draw on the frame", onMouseDown: (e) => e.preventDefault(), onClick: (e) => { e.stopPropagation(); useDraft.setState((d) => ({ drawing: !d.drawing })); }, children: _jsx(PenLine, { size: 15, strokeWidth: 2.2, "aria-hidden": "true" }) })] })), _jsx("textarea", { ref: ref, rows: 1, value: text, autoFocus: autoFocus, placeholder: placeholder, maxLength: 2000, onChange: (e) => {
                    setText(e.target.value);
                    findQuery(e.target.value, e.target.selectionStart);
                    if (!onSubmit)
                        noteTyping(targetId, !!e.target.value.trim());
                }, onSelect: (e) => findQuery(e.currentTarget.value, e.currentTarget.selectionStart), onBlur: () => {
                    stopTyping(targetId);
                    setTimeout(() => {
                        setQuery(null);
                        // Focus went somewhere else on the page (not just to another window): give up the edit.
                        if (cancelOnBlur && document.hasFocus() && !box.current?.contains(document.activeElement))
                            onCancel?.();
                    }, 0);
                }, onKeyDown: (e) => {
                    if (query && matches.length) {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setActive((a) => (a + 1) % matches.length);
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setActive((a) => (a - 1 + matches.length) % matches.length);
                            return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            pick(matches[active]);
                            return;
                        }
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        if (query)
                            setQuery(null);
                        else if (onCancel && !text)
                            onCancel();
                        else
                            e.currentTarget.blur();
                        return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                    }
                } }), (onSubmit || text.trim()) && (_jsx("button", { className: "cmt-send", title: submitLabel ?? (replyTo ? 'Reply' : 'Post'), "aria-label": submitLabel ?? (replyTo ? 'Reply' : 'Post'), disabled: !text.trim(), onMouseDown: (e) => e.preventDefault(), onClick: (e) => { e.stopPropagation(); submit(); }, children: onSubmit ? _jsx(Check, { size: 16, strokeWidth: 2.6, "aria-hidden": "true" }) : _jsx(ArrowUp, { size: 16, strokeWidth: 2.6, "aria-hidden": "true" }) }))] }));
}
/**
 * The full list (the player's sidebar): a count, the comments (scrolling),
 * and the comment box. Threads on a video; one conversation on anything else.
 */
export function CommentList({ targetId, clock, onSeek }) {
    const threaded = useBoard((s) => isThreaded(s.items[targetId]));
    const look = useContext(CommentLookContext);
    const current = useBoard((s) => (isVideo(s.items[targetId]) ? versionOf(s.items[targetId]) : null));
    const every = useComments(targetId);
    const all = useMemo(() => forVersion(every, current == null ? null : look.version ?? current), [every, current, look.version]);
    const threads = useMemo(() => toThreads(all), [all]);
    // #1, #2… in the order threads were started.
    const numbers = useMemo(() => {
        const byAge = [...threads].sort((a, b) => a.root.createdAt - b.root.createdAt);
        return new Map(byAge.map((t, i) => [t.root.id, i + 1]));
    }, [threads]);
    return (_jsxs("div", { className: "cmt-full", children: [_jsxs("header", { className: "cmt-head", children: ["Comments ", _jsx("span", { children: threaded ? threads.length : all.length })] }), _jsxs("div", { className: "cmt-list", children: [threaded
                        ? threads.map((t) => _jsx(ThreadCard, { t: t, targetId: targetId, onSeek: onSeek, number: numbers.get(t.root.id) }, t.root.id))
                        : flatten(threads).map((c) => _jsx(FlatComment, { c: c }, c.id)), !threads.length && _jsx("p", { className: "cmt-empty", children: "No comments yet." })] }), _jsxs("div", { className: "cmt-full-compose", children: [_jsx(Typing, { targetId: targetId }), _jsx(Composer, { targetId: targetId, clock: clock })] })] }));
}
/** Threads back into one conversation, oldest first. */
const flatten = (threads) => threads.flatMap((t) => [t.root, ...t.replies]).sort((a, b) => a.createdAt - b.createdAt);
/** A comment in a conversation: its own card, no thread of its own. */
function FlatComment({ c }) {
    const ref = useRef(null);
    const [fresh] = useState(() => {
        const isNew = !seenThreads.has(c.id) && Date.now() - c.createdAt < 1500;
        seenThreads.add(c.id);
        return isNew;
    });
    useDrop(ref, c, fresh);
    return (_jsx("article", { ref: ref, className: "cmt-thread", "data-fresh": fresh || undefined, children: _jsx(CommentRow, { c: c }) }));
}
// --- Panel beside the selected card -----------------------------------------------------
export function CommentsPopover() {
    const boardId = useBoardId();
    const id = useUi((s) => s.selectedId);
    const hidden = useUi((s) => s.movingId != null || s.dragId != null || s.flyout != null || s.viewer != null || s.wall != null || s.contextMenu != null);
    const item = useBoard((s) => (id ? s.items[id] : undefined));
    const slot = useLayout((s) => (id ? s.slots[id] : undefined));
    const commenting = useUi((s) => s.commenting);
    const hasOpen = useOpenCount(id ?? '') > 0;
    const typing = useTypers(id ?? '').length > 0;
    useSyncExternalStore(camera.subscribe, () => camera.version);
    if (!item || hidden || item.boardId !== boardId || !COMMENTABLE.has(item.kind))
        return null;
    void slot; // follow the card when its place in a section changes
    // Only when there's something to read, someone's writing, or the box was asked for.
    if (!hasOpen && commenting !== item.id && !typing)
        return null;
    const at = posOf(item);
    const tl = camera.worldToScreen(at.x, at.y);
    const left = tl.x + camera.origin.x;
    const top = Math.max(camera.origin.y + 8, tl.y + camera.origin.y);
    const width = itemSize(item).w * camera.z;
    const right = left + width + GAP + POP_WIDTH < window.innerWidth - 8;
    const x = right ? left + width + GAP : Math.max(8, left - GAP - POP_WIDTH);
    const isVideo = item.kind === 'media' && item.mediaType === 'video';
    const style = { left: x, top, width: POP_WIDTH };
    return isVideo
        ? _jsx(Panel, { id: item.id, style: style, video: true }, item.id)
        : _jsx(Conversation, { id: item.id, style: style }, item.id);
}
/** Beside a video: its open threads (five, then "Show N more") and the comment box. */
function Panel({ id, style, video }) {
    const [showAll, setShowAll] = useState(false);
    const composing = useUi((s) => s.commenting === id);
    // Beside the card: the current version's threads.
    const current = useBoard((s) => (isVideo(s.items[id]) ? versionOf(s.items[id]) : null));
    const every = useComments(id);
    const all = useMemo(() => forVersion(every, current), [every, current]);
    const threads = useMemo(() => toThreads(all), [all]);
    const open = threads;
    // Timecoded threads read in timecode order; others show the latest few.
    const timed = open.some((t) => t.root.time != null);
    const list = showAll ? open : timed ? open.slice(0, QUICK_MAX) : open.slice(-QUICK_MAX);
    const more = open.length - list.length;
    const clock = video ? () => cardVideos.get(id)?.currentTime ?? null : undefined;
    const onSeek = video
        ? (t) => { const v = cardVideos.get(id); if (v) {
            v.pause();
            v.currentTime = t;
        } }
        : undefined;
    return (_jsxs("div", { className: "cmt-pop", style: style, onPointerDown: (e) => e.stopPropagation(), onWheel: (e) => e.stopPropagation(), children: [list.length > 0 && (_jsxs("div", { className: "cmt-list", children: [list.map((t) => _jsx(ThreadCard, { t: t, targetId: id, onSeek: onSeek }, t.root.id)), more > 0 && _jsxs("button", { className: "cmt-show-more", onClick: () => setShowAll(true), children: ["Show ", more, " more"] })] })), _jsxs("div", { className: "cmt-pop-compose", children: [_jsx(Typing, { targetId: id }), (composing || open.length > 0) && (_jsx(Composer, { targetId: id, clock: clock, autoFocus: composing, onCancel: composing ? () => useUi.getState().set({ commenting: null }) : undefined }, composing ? 'opened' : 'idle'))] })] }));
}
/** Beside a note, link, to-do or photo: one conversation, oldest first, with the reply box at the bottom. */
function Conversation({ id, style }) {
    const [showAll, setShowAll] = useState(false);
    const composing = useUi((s) => s.commenting === id);
    const all = useComments(id);
    const open = useMemo(() => [...all].sort((a, b) => a.createdAt - b.createdAt), [all]);
    const list = showAll ? open : open.slice(-QUICK_MAX);
    const earlier = open.length - list.length;
    return (_jsxs("div", { className: "cmt-pop", style: style, onPointerDown: (e) => e.stopPropagation(), onWheel: (e) => e.stopPropagation(), children: [list.length > 0 && (_jsxs("div", { className: "cmt-list", children: [earlier > 0 && _jsxs("button", { className: "cmt-show-more", onClick: () => setShowAll(true), children: ["Show ", earlier, " earlier"] }), list.map((c) => _jsx(FlatComment, { c: c }, c.id))] })), _jsxs("div", { className: "cmt-pop-compose", children: [_jsx(Typing, { targetId: id }), _jsx(Composer, { targetId: id, autoFocus: composing, placeholder: open.length ? 'Reply…' : 'Write a comment…', onCancel: composing ? () => useUi.getState().set({ commenting: null }) : undefined }, composing ? 'opened' : 'idle')] })] }));
}
