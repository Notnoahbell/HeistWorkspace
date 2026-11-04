// Comments UI: the count badge on a card, the panel beside a selected card
// (one conversation, or a video's threads), the full list with
// Open / Resolved tabs for the player, replies, reactions, @mentions and
// typing indicators.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, ChevronDown, Clock, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react';
import { COMMENTABLE, useBoard, type Comment } from '../board/store';
import { useUi } from '../board/ui';
import { useLayout } from '../board/layout';
import { useBoardId } from '../board/nav';
import { itemSize, posOf } from '../board/actions';
import {
  addComment, cardVideos, deleteComment, isThreaded, membersOf, noteTyping, REACTIONS, setResolved, stopTyping, timeAgo,
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
const POP_WIDTH = 264;
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

function CommentRow({ c, reply, onSeek, onReply, number, resolvable = !reply }: {
  c: Comment;
  reply?: boolean;
  /** Has its own resolve / reopen (a thread's first comment). */
  resolvable?: boolean;
  onSeek?: (t: number) => void;
  /** Shows Reply in the footer. */
  onReply?: () => void;
  number?: number;
}) {
  const look = useContext(CommentLookContext);
  const profile = usePresence((s) => s.users[c.authorId]);
  const resolver = usePresence((s) => (c.resolvedBy ? s.users[c.resolvedBy]?.name : undefined));
  const name = profile?.name ?? c.authorName;
  const mine = c.authorId === session.userId;
  const tools = resolvable || mine;
  const reacted = REACTIONS.some((r) => c.reactions?.[r]?.length);
  // The react button sits with Reply / the reaction chips; with neither, it moves up beside the name.
  const reactUp = !onReply && !reacted;
  return (
    <div className="cmt" data-reply={reply || undefined}>
      <Avatar profile={{ name, icon: profile?.icon ?? null }} color={personalColor(c.authorId)} size={reply ? 22 : 26} />
      <div className="cmt-body">
        <header className="cmt-meta">
          <span className="cmt-author" title={name}>{mine ? 'You' : name}</span>
          <span className="cmt-when" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
          {look.numbered && number != null && <span className="cmt-num">#{number}</span>}
          <span className="cmt-meta-end">
            {/* On hover: resolve, delete. */}
            {tools && (
              <span className="cmt-tools">
                {resolvable && (c.resolved ? (
                  <button className="cmt-tool" title="Reopen" aria-label="Reopen" onClick={() => setResolved(c.id, false)}>
                    <RotateCcw {...ICON} />
                  </button>
                ) : (
                  <button className="cmt-tool cmt-check" title="Resolve" aria-label="Resolve" onClick={() => setResolved(c.id, true)}>
                    <Check {...ICON} />
                  </button>
                ))}
                {mine && (
                  <button className="cmt-tool cmt-delete" title={reply ? 'Delete reply' : 'Delete comment'} aria-label="Delete" onClick={() => deleteComment(c.id)}>
                    <Trash2 {...ICON} />
                  </button>
                )}
              </span>
            )}
            {reactUp && <ReactButton c={c} />}
          </span>
        </header>
        <p className="cmt-text">
          {c.time != null && (
            <button className="cmt-time" title="Jump to this moment" disabled={!onSeek} onClick={(e) => { e.stopPropagation(); onSeek?.(c.time!); }}>
              {look.fmt(c.time)}
            </button>
          )}
          <CommentText c={c} />
        </p>
        {resolvable && c.resolved && <div className="cmt-resolved-by">Resolved{resolver ? ` by ${resolver}` : ''}</div>}
        {/* Reactions, Reply, and the react button. */}
        {!reactUp && (
          <div className="cmt-foot">
            <Reactions c={c} />
            {onReply && <button className="cmt-reply-btn" onClick={onReply}>Reply</button>}
            <ReactButton c={c} />
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
        <div className="cmt-ring" role="group" aria-label="Reactions" style={{ left: at.x, top: at.y }}>
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
            <X size={15} strokeWidth={2.2} aria-hidden="true" />
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

/** Threads already shown once in this session. */
const seenThreads = new Set<string>();

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
  const n = t.replies.length;
  return (
    <article
      ref={ref}
      className="cmt-thread"
      data-fresh={fresh || undefined}
      data-active={active || undefined}
      data-resolved={t.root.resolved || undefined}
      onClick={look.onPick ? (e) => { if (!(e.target as Element).closest('button, textarea, a')) look.onPick!(t.root); } : undefined}
    >
      <CommentRow
        c={t.root}
        number={number}
        onSeek={onSeek}
        onReply={!t.root.resolved && !replying ? () => { setReplying(true); setOpen(true); } : undefined}
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

function Composer({ targetId, clock, replyTo, autoFocus, placeholder = 'Add a comment…', onDone, onCancel }: {
  targetId: string;
  /** Current video time, for timecoded comments (videos only). */
  clock?: () => number | null;
  replyTo?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState('');
  const [timed, setTimed] = useState(true);
  const [now, setNow] = useState<number | null>(() => clock?.() ?? null);
  const [query, setQuery] = useState<{ start: number; q: string } | null>(null);
  const [active, setActive] = useState(0);
  const look = useContext(CommentLookContext);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Where the caret goes once a picked mention is in the text. */
  const caretTo = useRef<number | null>(null);
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
    addComment(targetId, text, { time: clock && timed ? clock() : null, replyTo });
    setText('');
    setQuery(null);
    stopTyping(targetId);
    onDone?.();
  };

  return (
    <div className="cmt-composer" data-reply={replyTo ? 'true' : undefined} onClick={() => ref.current?.focus()}>
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
      {clock && !replyTo && now != null && (
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
          noteTyping(targetId, !!e.target.value.trim());
        }}
        onSelect={(e) => findQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => { stopTyping(targetId); setTimeout(() => setQuery(null), 0); }}
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
      {text.trim() && <button className="cmt-send" onClick={(e) => { e.stopPropagation(); submit(); }}>{replyTo ? 'Reply' : 'Post'}</button>}
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
 * The full list (the player's sidebar): Open and Resolved tabs, scrolling,
 * composer under Open. Threads on a video; one conversation on anything else.
 */
export function CommentList({ targetId, clock, onSeek }: ThreadProps) {
  const threaded = useBoard((s) => isThreaded(s.items[targetId]));
  const all = useComments(targetId);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const threads = useMemo(() => toThreads(all), [all]);
  const open = threads.filter((t) => !t.root.resolved);
  const resolved = threads.filter((t) => t.root.resolved).sort((a, b) => (b.root.resolvedAt ?? 0) - (a.root.resolvedAt ?? 0));
  const shown = tab === 'open' ? open : resolved;
  // #1, #2… in the order threads were started.
  const numbers = useMemo(() => {
    const byAge = [...threads].sort((a, b) => a.root.createdAt - b.root.createdAt);
    return new Map(byAge.map((t, i) => [t.root.id, i + 1]));
  }, [threads]);
  return (
    <div className="cmt-full">
      <div className="cmt-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
          Open <span>{open.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>
          Resolved <span>{resolved.length}</span>
        </button>
      </div>
      <div className="cmt-list">
        {threaded
          ? shown.map((t) => <ThreadCard key={t.root.id} t={t} targetId={targetId} onSeek={onSeek} number={numbers.get(t.root.id)} />)
          : flatten(shown).map((c) => <FlatComment key={c.id} c={c} />)}
        {!shown.length && (
          <p className="cmt-empty">{tab === 'open' ? 'No open comments.' : 'Nothing resolved yet. Tick a comment to file it here.'}</p>
        )}
      </div>
      {tab === 'open' && (
        <div className="cmt-full-compose">
          <Typing targetId={targetId} />
          <Composer targetId={targetId} clock={clock} />
        </div>
      )}
    </div>
  );
}

/** Threads back into one conversation, oldest first. */
const flatten = (threads: Thread[]) => threads.flatMap((t) => [t.root, ...t.replies]).sort((a, b) => a.createdAt - b.createdAt);

/** A comment in a conversation: its own card, no thread of its own. */
function FlatComment({ c }: { c: Comment }) {
  const [fresh] = useState(() => {
    const isNew = !seenThreads.has(c.id) && Date.now() - c.createdAt < 1500;
    seenThreads.add(c.id);
    return isNew;
  });
  return (
    <article className="cmt-thread" data-fresh={fresh || undefined} data-resolved={c.resolved || undefined}>
      <CommentRow c={c} resolvable={c.resolved} />
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
  const all = useComments(id);
  const threads = useMemo(() => toThreads(all), [all]);
  const open = threads.filter((t) => !t.root.resolved);
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

/**
 * Beside a note, link, to-do or photo: one conversation, oldest first. No box
 * until you press Reply (or the toolbar's comment button).
 */
function Conversation({ id, style }: { id: string; style: CSSProperties }) {
  const [showAll, setShowAll] = useState(false);
  const [replying, setReplying] = useState(false);
  const composing = useUi((s) => s.commenting === id);
  const all = useComments(id);
  const open = useMemo(() => all.filter((c) => !c.resolved).sort((a, b) => a.createdAt - b.createdAt), [all]);
  const list = showAll ? open : open.slice(-QUICK_MAX);
  const earlier = open.length - list.length;
  const writing = replying || composing;
  const close = () => { setReplying(false); if (composing) useUi.getState().set({ commenting: null }); };

  return (
    <div className="cmt-pop" style={style} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {list.length > 0 && (
        <div className="cmt-list">
          {earlier > 0 && <button className="cmt-show-more" onClick={() => setShowAll(true)}>Show {earlier} earlier</button>}
          {list.map((c) => <FlatComment key={c.id} c={c} />)}
        </div>
      )}
      <div className="cmt-pop-compose">
        <Typing targetId={id} />
        {writing ? (
          <Composer
            targetId={id}
            autoFocus
            placeholder={open.length ? 'Reply…' : 'Write a comment…'}
            onDone={close}
            onCancel={close}
          />
        ) : (
          open.length > 0 && <button className="cmt-reply-open" onClick={() => setReplying(true)}>Reply</button>
        )}
      </div>
    </div>
  );
}
