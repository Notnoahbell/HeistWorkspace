// Comments UI: the count badge on a card, the panel beside a selected card
// (one conversation, or a video's threads), the full list for the player,
// replies, reactions, @mentions and typing indicators.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUp, Check, ChevronDown, Clock, Pencil, SmilePlus, Trash2, X } from 'lucide-react';
import { COMMENTABLE, useBoard, type Comment, type Media } from '../board/store';
import { forVersion, isVideo, versionOf } from '../board/versions';
import { useUi } from '../board/ui';
import { useLayout } from '../board/layout';
import { useBoardId } from '../board/nav';
import { itemSize, posOf } from '../board/actions';
import {
  addComment, cardVideos, deleteComment, editComment, isThreaded, membersOf, noteTyping, REACTIONS, stopTyping, timeAgo,
  toggleReaction, toThreads, useComments, useOpenCount, useTypers, type Thread,
} from '../board/comments';
import { camera } from '../canvas/camera';
import { session } from '../session';
import { personalColor, usePresence, type Profile } from '../sync/presence';
import { Avatar } from './Collab';
import { fmtTime } from './Scrubber';

const ICON = { size: 14, strokeWidth: 2.2, 'aria-hidden': true } as const;
/** Threads shown beside a card before "Show N more". */
const QUICK_MAX = 5;
const POP_WIDTH = 344;
const GAP = 14;

/**
 * How comments are shown: the time format, whether threads are numbered (#1,
 * #2…), and which one is picked. The player sets this; cards use the defaults.
 */
export interface CommentLook {
  fmt: (seconds: number) => string;
  numbered: boolean;
  activeId: string | null;
  onPick?: (c: Comment) => void;
  /** On a video: the version being looked at (else the current one). */
  version?: number;
}
export const CommentLookContext = createContext<CommentLook>({ fmt: fmtTime, numbered: false, activeId: null });

// --- Badge on the card ------------------------------------------------------------

/** Top-right corner of a card: open-thread count, and dots while someone's writing a comment. */
export function CommentBadge({ id }: { id: string }) {
  const n = useOpenCount(id);
  const typers = useTypers(id);
  if (!n && !typers.length) return null;
  return (
    <span className="cmt-corner">
      {typers.length > 0 && (
        <span className="cmt-typing-bubble" style={{ background: typers[0].color }} title={`${names(typers)} ${typers.length === 1 ? 'is' : 'are'} commenting`}>
          <Dots />
        </span>
      )}
      {n > 0 && <span className="cmt-badge" title={`${n} open comment${n === 1 ? '' : 's'}`}>{n > 9 ? '9+' : n}</span>}
    </span>
  );
}

const Dots = () => <span className="dots" aria-hidden="true"><i /><i /><i /></span>;
const names = (people: { name: string }[]) =>
  people.length <= 2 ? people.map((p) => p.name).join(' and ') : `${people[0].name} and ${people.length - 1} others`;

/** "Olive Otter is typing…" under a thread list. */
function Typing({ targetId }: { targetId: string }) {
  const typers = useTypers(targetId);
  if (!typers.length) return null;
  return (
    <div className="cmt-typing" style={{ '--who': typers[0].color } as CSSProperties}>
      <Dots /> {names(typers)} {typers.length === 1 ? 'is' : 'are'} typing…
    </div>
  );
}

// --- Text with @mentions --------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function CommentText({ c }: { c: Comment }) {
  const users = usePresence((s) => s.users);
  const parts = useMemo(() => {
    const named = (c.mentions ?? []).map((id) => ({ id, name: users[id]?.name })).filter((m): m is { id: string; name: string } => !!m.name);
    if (!named.length) return [c.text];
    const re = new RegExp(`(@(?:${named.map((m) => escape(m.name)).join('|')}))`, 'gi');
    return c.text.split(re).map((part, i) => {
      const who = named.find((m) => `@${m.name}`.toLowerCase() === part.toLowerCase());
      return who ? <span key={i} className="cmt-mention" data-me={who.id === session.userId || undefined}>{part}</span> : part;
    });
  }, [c.text, c.mentions, users]);
  return <>{parts}</>;
}

// --- One comment -------------------------------------------------------------------

function CommentRow({ c, reply, onSeek, onReply, number }: {
  c: Comment;
  reply?: boolean;
  onSeek?: (t: number) => void;
  /** Shows Reply in the footer. */
  onReply?: () => void;
  number?: number;
}) {
  const look = useContext(CommentLookContext);
  const profile = usePresence((s) => s.users[c.authorId]);
  const name = profile?.name ?? c.authorName;
  const mine = c.authorId === session.userId;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const remove = () => {
    // A reply goes on its own; a thread's first comment takes the thread with it.
    const el = (reply ? row.current : row.current?.closest('.cmt-thread')) as HTMLElement | null;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) { deleteComment(c.id); return; }
    // The last one beside a card takes the panel with it: let the whole panel go, not just the row.
    const pop = el.closest<HTMLElement>('.cmt-pop');
    const last = !reply && pop && pop.querySelectorAll('.cmt-thread').length === 1 && useUi.getState().commenting !== c.targetId;
    (last ? animatePanelOut(pop) : animateOut(el)).then(() => deleteComment(c.id));
  };
  // Delete takes a second click, so a slip off a reaction can't remove a comment.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <div ref={row} className="cmt" data-reply={reply || undefined} data-editing={editing || undefined}>
      <Avatar profile={{ name, icon: profile?.icon ?? null }} color={personalColor(c.authorId)} size={reply ? 22 : 26} />
      <div className="cmt-body">
        <header className="cmt-meta">
          <span className="cmt-author" title={name}>{mine ? 'You' : name}</span>
          <span className="cmt-when" title={new Date(c.createdAt).toLocaleString()}>
            {timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}
          </span>
          {look.numbered && number != null && <span className="cmt-num">#{number}</span>}
          {/* React first; then, on your own comments, edit and delete (set apart). */}
          <span className="cmt-tools">
            <ReactButton c={c} />
            {mine && (
              <span className="cmt-own">
                <button className="cmt-tool" title="Edit" aria-label="Edit" aria-pressed={editing} onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing((e) => !e)}>
                  <Pencil {...ICON} />
                </button>
                <button
                  className="cmt-tool cmt-delete"
                  data-confirm={confirming || undefined}
                  title={confirming ? 'Click again to delete' : reply ? 'Delete reply' : 'Delete comment'}
                  aria-label={confirming ? 'Confirm delete' : 'Delete'}
                  onClick={() => (confirming ? remove() : setConfirming(true))}
                  onBlur={() => setConfirming(false)}
                >
                  <Trash2 {...ICON} />
                  <span className="cmt-delete-label" aria-hidden="true">Delete?</span>
                </button>
              </span>
            )}
          </span>
        </header>
        {editing ? (
          <Composer
            targetId={c.targetId}
            initialText={c.text}
            autoFocus
            placeholder="Edit comment…"
            submitLabel="Save"
            onSubmit={(text) => editComment(c.id, text)}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
            cancelOnBlur
          />
        ) : (
          <p className="cmt-text">
            {c.time != null && (
              <button className="cmt-time" title="Jump to this moment" disabled={!onSeek} onClick={(e) => { e.stopPropagation(); onSeek?.(c.time!); }}>
                {look.fmt(c.time)}
              </button>
            )}
            <CommentText c={c} />
          </p>
        )}
        {/* Reaction chips and Reply. */}
        {(onReply || REACTIONS.some((r) => c.reactions?.[r]?.length)) && (
          <div className="cmt-foot">
            <Reactions c={c} />
            {onReply && <button className="cmt-reply-btn" onClick={onReply}>Reply</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The react button. Pressing it pops the six emoji out in a ring around it
 * (fixed to the screen, so nothing clips it); pick one, press the middle,
 * click away, scroll or Escape to close.
 */
function ReactButton({ c }: { c: Comment }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.cmt-ring')) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
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
    const r = ref.current!.getBoundingClientRect();
    setAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <>
      <button ref={ref} className="cmt-tool cmt-react-add" title="React" aria-label="React" aria-expanded={!!at} onClick={open}>
        <SmilePlus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {at && (
        <div
          className="cmt-ring"
          role="group"
          aria-label="Reactions"
          style={{ left: at.x, top: at.y }}
          onClick={(e) => { if (e.target === e.currentTarget) setAt(null); }}
        >
          {REACTIONS.map((r, i) => (
            <button
              key={r}
              className="cmt-emoji"
              style={{ '--a': `${i * 60 - 90}deg`, '--i': i } as CSSProperties}
              title={`React ${r}`}
              aria-label={`React ${r}`}
              aria-pressed={!!c.reactions?.[r]?.includes(session.userId)}
              onClick={() => { toggleReaction(c.id, r); setAt(null); }}
            >
              {r}
            </button>
          ))}
          <button className="cmt-ring-close" title="Close" aria-label="Close reactions" onClick={() => setAt(null)}>
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}

/** Reaction chips under a comment: click one to add yours, or take it back. */
function Reactions({ c }: { c: Comment }) {
  const users = usePresence((s) => s.users);
  return (
    <>
      {REACTIONS.filter((r) => c.reactions?.[r]?.length).map((r) => {
        const who = c.reactions![r];
        const names = who.map((id) => (id === session.userId ? 'You' : users[id]?.name ?? 'Someone'));
        return (
          <button
            key={r}
            className="cmt-react"
            aria-pressed={who.includes(session.userId)}
            title={names.join(', ')}
            onClick={(e) => { e.stopPropagation(); toggleReaction(c.id, r); }}
          >
            <span aria-hidden="true">{r}</span>{who.length}
          </button>
        );
      })}
    </>
  );
}

/**
 * While a comment animates past the edge of the list, don't let a scrollbar
 * flash up (unless the list already scrolls). Returns the undo.
 */
function holdScrollbar(el: HTMLElement): () => void {
  const list = el.closest<HTMLElement>('.cmt-list');
  if (!list || list.scrollHeight > list.clientHeight + 1) return () => {};
  list.style.overflowY = 'hidden';
  return () => { list.style.overflowY = ''; };
}

/** Fade and slide a comment away, then close the gap it leaves (the rest move up to fill it). */
async function animateOut(el: HTMLElement) {
  el.style.pointerEvents = 'none';
  holdScrollbar(el); // the list re-renders without it afterwards, so no need to undo
  await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }],
    { duration: 100, easing: 'ease-in', fill: 'forwards' }).finished;
  const cs = getComputedStyle(el);
  el.style.overflow = 'hidden';
  await el.animate([
    { height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom },
    { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
  ], { duration: 140, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'forwards' }).finished;
}

/** The panel beside a card leaving: a quick fade as it drifts back toward the card. */
async function animatePanelOut(pop: HTMLElement) {
  pop.style.pointerEvents = 'none';
  await pop.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-10px) scale(0.97)' }],
    { duration: 170, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished;
}

/** Threads already shown once in this session. */
const seenThreads = new Set<string>();

/** Where the last comment was posted from, so it can drop into the stack from there. */
let launch: { targetId: string; box: DOMRect; dock: Element; dockTop: number; at: number } | null = null;

/**
 * A comment you just posted slides up out of the reply box into its place,
 * and the box glides down to make room.
 */
function useDrop(ref: RefObject<HTMLElement | null>, c: Comment, fresh: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    const from = launch;
    if (!el || !fresh || !from || from.targetId !== c.targetId || c.authorId !== session.userId || Date.now() - from.at > 1500) return;
    launch = null;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.scrollIntoView({ block: 'nearest' });
    const to = el.getBoundingClientRect();
    const ease = 'cubic-bezier(0.25, 1, 0.5, 1)';
    el.style.animation = 'none'; // instead of the fade-in, not as well as
    const release = holdScrollbar(el);
    const slide = el.animate(
      [{ transform: `translateY(${from.box.top - to.top}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 260, easing: ease },
    );
    slide.onfinish = slide.oncancel = release;
    const shift = from.dock.isConnected ? from.dock.getBoundingClientRect().top - from.dockTop : 0;
    if (shift > 1) from.dock.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'none' }], { duration: 260, easing: ease });
  }, []);
}

/** A thread: the first comment, its replies (folded away, like YouTube), and a reply box on demand. */
function ThreadCard({ t, targetId, onSeek, number }: {
  t: Thread;
  number?: number;
  targetId: string;
  onSeek?: (t: number) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [open, setOpen] = useState(false);
  const look = useContext(CommentLookContext);
  const active = look.activeId === t.root.id;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  // Slides in once, for a comment that's just been posted (not on every reselect).
  const [fresh] = useState(() => {
    const isNew = !seenThreads.has(t.root.id) && Date.now() - t.root.createdAt < 1500;
    seenThreads.add(t.root.id);
    return isNew;
  });
  useDrop(ref, t.root, fresh);
  const n = t.replies.length;
  return (
    <article
      ref={ref}
      className="cmt-thread"
      data-fresh={fresh || undefined}
      data-active={active || undefined}
      onClick={look.onPick ? (e) => { if (!(e.target as Element).closest('button, textarea, a')) look.onPick!(t.root); } : undefined}
    >
      <CommentRow
        c={t.root}
        number={number}
        onSeek={onSeek}
        onReply={!replying ? () => { setReplying(true); setOpen(true); } : undefined}
      />
      {n > 0 && (
        <button className="cmt-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide replies' : `${n} ${n === 1 ? 'reply' : 'replies'}`}
          <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      {((open && n > 0) || replying) && (
        <div className="cmt-replies">
          {open && t.replies.map((r) => <CommentRow key={r.id} c={r} reply />)}
          {replying && (
            <Composer targetId={targetId} replyTo={t.root.id} autoFocus placeholder="Reply…" onDone={() => setReplying(false)} onCancel={() => setReplying(false)} />
          )}
        </div>
      )}
    </article>
  );
}

// --- Composer: one box, @mentions, timecode -----------------------------------------------

function Composer({ targetId, clock, replyTo, autoFocus, placeholder = 'Add a comment…', onDone, onCancel, initialText, onSubmit, submitLabel, cancelOnBlur }: {
  targetId: string;
  /** Editing: start from this text, and hand the result to onSubmit instead of posting. */
  initialText?: string;
  onSubmit?: (text: string) => void;
  submitLabel?: string;
  /** Clicking anywhere outside the box cancels (editing). */
  cancelOnBlur?: boolean;
  /** Current video time, for timecoded comments (videos only). */
  clock?: () => number | null;
  replyTo?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initialText ?? '');
  const [timed, setTimed] = useState(true);
  const [now, setNow] = useState<number | null>(() => clock?.() ?? null);
  const [query, setQuery] = useState<{ start: number; q: string } | null>(null);
  const [active, setActive] = useState(0);
  const look = useContext(CommentLookContext);
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** Where the caret goes once a picked mention is in the text. */
  const caretTo = useRef<number | null>(initialText?.length ?? null);
  const boardId = useBoard((s) => s.items[targetId]?.boardId ?? '');
  const users = usePresence((s) => s.users);
  const members = useBoard(useShallow((s) => membersOf(boardId, s.items)));

  // People you can @mention: whoever can see this board (not you).
  const people: Profile[] = useMemo(
    () => members.filter((id) => id !== session.userId).map((id) => users[id]).filter((p): p is Profile => !!p),
    [members, users],
  );
  const matches = query ? people.filter((p) => p.name.toLowerCase().includes(query.q.toLowerCase())).slice(0, 6) : [];

  const clockRef = useRef(clock);
  clockRef.current = clock;
  const hasClock = !!clock;
  useEffect(() => {
    if (!hasClock) return;
    const t = setInterval(() => setNow(clockRef.current?.() ?? null), 200);
    return () => clearInterval(t);
  }, [hasClock]);

  // Grow with the text; only scroll past the cap (no scrollbar before then).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (caretTo.current != null) { el.setSelectionRange(caretTo.current, caretTo.current); caretTo.current = null; }
    el.style.height = '0px';
    const h = el.scrollHeight;
    el.style.height = `${Math.min(140, h)}px`;
    el.style.overflowY = h > 140 ? 'auto' : 'hidden';
  }, [text]);

  useEffect(() => () => stopTyping(targetId), [targetId]);

  const findQuery = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? { start: caret - m[2].length - 1, q: m[2] } : null);
    setActive(0);
  };

  const pick = (p: Profile) => {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart;
    const next = `${text.slice(0, query.start)}@${p.name} ${text.slice(caret)}`;
    caretTo.current = query.start + p.name.length + 2;
    setText(next);
    setQuery(null);
  };

  const submit = () => {
    if (!text.trim()) return;
    if (!onSubmit && box.current) {
      const from = box.current.closest('.cmt-pop-compose, .cmt-full-compose, .cmt-replies') ?? box.current;
      launch = { targetId, box: box.current.getBoundingClientRect(), dock: from, dockTop: from.getBoundingClientRect().top, at: Date.now() };
    }
    if (onSubmit) onSubmit(text);
    else addComment(targetId, text, { time: clock && timed ? clock() : null, replyTo, version: look.version });
    setText('');
    setQuery(null);
    stopTyping(targetId);
    onDone?.();
  };

  return (
    <div ref={box} className="cmt-composer" data-reply={replyTo ? 'true' : undefined} onClick={() => ref.current?.focus()}>
      {query && (
        <div className="cmt-suggest" role="listbox">
          {matches.map((p, i) => (
            <button
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar profile={p} color={personalColor(p.id)} size={20} /> {p.name}
            </button>
          ))}
          {!matches.length && (
            <p className="cmt-suggest-empty">
              {people.length ? 'No one by that name here.' : 'Only you can see this board — share it to mention people.'}
            </p>
          )}
        </div>
      )}
      {clock && !replyTo && !onSubmit && now != null && (
        <button
          className="cmt-chip"
          aria-pressed={timed}
          title={timed ? 'Pinned to this moment — click to comment on the whole video' : 'Pin to the current moment'}
          onClick={(e) => { e.stopPropagation(); setTimed((t) => !t); }}
        >
          <Clock size={11} strokeWidth={2.4} aria-hidden="true" />
          {timed ? look.fmt(now) : 'Whole video'}
        </button>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={2000}
        onChange={(e) => {
          setText(e.target.value);
          findQuery(e.target.value, e.target.selectionStart);
          if (!onSubmit) noteTyping(targetId, !!e.target.value.trim());
        }}
        onSelect={(e) => findQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => {
          stopTyping(targetId);
          setTimeout(() => {
            setQuery(null);
            // Focus went somewhere else on the page (not just to another window): give up the edit.
            if (cancelOnBlur && document.hasFocus() && !box.current?.contains(document.activeElement)) onCancel?.();
          }, 0);
        }}
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            if (query) setQuery(null);
            else if (onCancel && !text) onCancel();
            else e.currentTarget.blur();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
      />
      {(onSubmit || text.trim()) && (
        <button
          className="cmt-send"
          title={submitLabel ?? (replyTo ? 'Reply' : 'Post')}
          aria-label={submitLabel ?? (replyTo ? 'Reply' : 'Post')}
          disabled={!text.trim()}
          onMouseDown={(e) => e.preventDefault()} // keep focus in the box
          onClick={(e) => { e.stopPropagation(); submit(); }}
        >
          {onSubmit ? <Check size={16} strokeWidth={2.6} aria-hidden="true" /> : <ArrowUp size={16} strokeWidth={2.6} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

// --- Lists -----------------------------------------------------------------------------------

export interface ThreadProps {
  targetId: string;
  clock?: () => number | null;
  onSeek?: (t: number) => void;
}

/**
 * The full list (the player's sidebar): a count, the comments (scrolling),
 * and the comment box. Threads on a video; one conversation on anything else.
 */
export function CommentList({ targetId, clock, onSeek }: ThreadProps) {
  const threaded = useBoard((s) => isThreaded(s.items[targetId]));
  const look = useContext(CommentLookContext);
  const current = useBoard((s) => (isVideo(s.items[targetId]) ? versionOf(s.items[targetId] as Media) : null));
  const every = useComments(targetId);
  const all = useMemo(() => forVersion(every, current == null ? null : look.version ?? current), [every, current, look.version]);
  const threads = useMemo(() => toThreads(all), [all]);
  // #1, #2… in the order threads were started.
  const numbers = useMemo(() => {
    const byAge = [...threads].sort((a, b) => a.root.createdAt - b.root.createdAt);
    return new Map(byAge.map((t, i) => [t.root.id, i + 1]));
  }, [threads]);
  return (
    <div className="cmt-full">
      <header className="cmt-head">
        Comments <span>{threaded ? threads.length : all.length}</span>
      </header>
      <div className="cmt-list">
        {threaded
          ? threads.map((t) => <ThreadCard key={t.root.id} t={t} targetId={targetId} onSeek={onSeek} number={numbers.get(t.root.id)} />)
          : flatten(threads).map((c) => <FlatComment key={c.id} c={c} />)}
        {!threads.length && <p className="cmt-empty">No comments yet.</p>}
      </div>
      <div className="cmt-full-compose">
        <Typing targetId={targetId} />
        <Composer targetId={targetId} clock={clock} />
      </div>
    </div>
  );
}

/** Threads back into one conversation, oldest first. */
const flatten = (threads: Thread[]) => threads.flatMap((t) => [t.root, ...t.replies]).sort((a, b) => a.createdAt - b.createdAt);

/** A comment in a conversation: its own card, no thread of its own. */
function FlatComment({ c }: { c: Comment }) {
  const ref = useRef<HTMLElement>(null);
  const [fresh] = useState(() => {
    const isNew = !seenThreads.has(c.id) && Date.now() - c.createdAt < 1500;
    seenThreads.add(c.id);
    return isNew;
  });
  useDrop(ref, c, fresh);
  return (
    <article ref={ref} className="cmt-thread" data-fresh={fresh || undefined}>
      <CommentRow c={c} />
    </article>
  );
}

// --- Panel beside the selected card -----------------------------------------------------

export function CommentsPopover() {
  const boardId = useBoardId();
  const id = useUi((s) => s.selectedId);
  const hidden = useUi((s) => s.movingId != null || s.dragId != null || s.flyout != null || s.viewer != null || s.contextMenu != null);
  const item = useBoard((s) => (id ? s.items[id] : undefined));
  const slot = useLayout((s) => (id ? s.slots[id] : undefined));
  const commenting = useUi((s) => s.commenting);
  const hasOpen = useOpenCount(id ?? '') > 0;
  const typing = useTypers(id ?? '').length > 0;
  useSyncExternalStore(camera.subscribe, () => camera.version);
  if (!item || hidden || item.boardId !== boardId || !COMMENTABLE.has(item.kind)) return null;
  void slot; // follow the card when its place in a section changes
  // Only when there's something to read, someone's writing, or the box was asked for.
  if (!hasOpen && commenting !== item.id && !typing) return null;

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
    ? <Panel key={item.id} id={item.id} style={style} video />
    : <Conversation key={item.id} id={item.id} style={style} />;
}

/** Beside a video: its open threads (five, then "Show N more") and the comment box. */
function Panel({ id, style, video }: { id: string; style: CSSProperties; video: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const composing = useUi((s) => s.commenting === id);
  // Beside the card: the current version's threads.
  const current = useBoard((s) => (isVideo(s.items[id]) ? versionOf(s.items[id] as Media) : null));
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
    ? (t: number) => { const v = cardVideos.get(id); if (v) { v.pause(); v.currentTime = t; } }
    : undefined;

  return (
    <div className="cmt-pop" style={style} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {list.length > 0 && (
        <div className="cmt-list">
          {list.map((t) => <ThreadCard key={t.root.id} t={t} targetId={id} onSeek={onSeek} />)}
          {more > 0 && <button className="cmt-show-more" onClick={() => setShowAll(true)}>Show {more} more</button>}
        </div>
      )}
      <div className="cmt-pop-compose">
        <Typing targetId={id} />
        {(composing || open.length > 0) && (
          <Composer
            key={composing ? 'opened' : 'idle'}
            targetId={id}
            clock={clock}
            autoFocus={composing}
            onCancel={composing ? () => useUi.getState().set({ commenting: null }) : undefined}
          />
        )}
      </div>
    </div>
  );
}

/** Beside a note, link, to-do or photo: one conversation, oldest first, with the reply box at the bottom. */
function Conversation({ id, style }: { id: string; style: CSSProperties }) {
  const [showAll, setShowAll] = useState(false);
  const composing = useUi((s) => s.commenting === id);
  const all = useComments(id);
  const open = useMemo(() => [...all].sort((a, b) => a.createdAt - b.createdAt), [all]);
  const list = showAll ? open : open.slice(-QUICK_MAX);
  const earlier = open.length - list.length;

  return (
    <div className="cmt-pop" style={style} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {list.length > 0 && (
        <div className="cmt-list">
          {earlier > 0 && <button className="cmt-show-more" onClick={() => setShowAll(true)}>Show {earlier} earlier</button>}
          {list.map((c) => <FlatComment key={c.id} c={c} />)}
        </div>
      )}
      {/* The reply box is always there; the toolbar's comment button puts the caret in it. */}
      <div className="cmt-pop-compose">
        <Typing targetId={id} />
        <Composer
          key={composing ? 'opened' : 'idle'}
          targetId={id}
          autoFocus={composing}
          placeholder={open.length ? 'Reply…' : 'Write a comment…'}
          onCancel={composing ? () => useUi.getState().set({ commenting: null }) : undefined}
        />
      </div>
    </div>
  );
}
