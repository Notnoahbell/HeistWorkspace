// Comments UI: the count badge on a card, the threads that slide in beside a
// selected card (up to five, with "Show all"), the full list with Open /
// Resolved tabs, replies, @mentions and typing indicators. The video player
// reuses the full list.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, ChevronLeft, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { COMMENTABLE, useBoard, type Comment } from '../board/store';
import { useUi } from '../board/ui';
import { useLayout } from '../board/layout';
import { useBoardId } from '../board/nav';
import { itemSize, posOf } from '../board/actions';
import {
  addComment, cardVideos, deleteComment, membersOf, noteTyping, setResolved, stopTyping, timeAgo, toThreads,
  useComments, useOpenCount, useTypers, type Thread,
} from '../board/comments';
import { camera } from '../canvas/camera';
import { session } from '../session';
import { personalColor, usePresence, type Profile } from '../sync/presence';
import { Avatar } from './Collab';
import { fmtTime } from './Scrubber';

const ICON = { size: 14, strokeWidth: 2.2, 'aria-hidden': true } as const;
/** Threads shown beside a card before "Show all". */
const QUICK_MAX = 5;
/** Replies shown per thread beside a card (the rest are in "Show all"). */
const QUICK_REPLIES = 2;
const POP_WIDTH = 300;
const GAP = 14;

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

function CommentRow({ c, reply, onSeek, footer }: { c: Comment; reply?: boolean; onSeek?: (t: number) => void; footer?: ReactNode }) {
  const profile = usePresence((s) => s.users[c.authorId]);
  const resolver = usePresence((s) => (c.resolvedBy ? s.users[c.resolvedBy]?.name : undefined));
  const name = profile?.name ?? c.authorName;
  const mine = c.authorId === session.userId;
  return (
    <div className="cmt" data-reply={reply || undefined}>
      <Avatar profile={{ name, icon: profile?.icon ?? null }} color={personalColor(c.authorId)} size={reply ? 20 : 24} />
      <div className="cmt-body">
        <header className="cmt-meta">
          <span className="cmt-author">{mine ? `${name} (you)` : name}</span>
          <span className="cmt-when" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
          {mine && (
            <button className="cmt-act cmt-delete" title={reply ? 'Delete reply' : 'Delete comment'} aria-label="Delete" onClick={() => deleteComment(c.id)}>
              <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
        </header>
        <p className="cmt-text">
          {c.time != null && (
            <button className="cmt-time" title="Jump to this moment" disabled={!onSeek} onClick={() => onSeek?.(c.time!)}>
              {fmtTime(c.time)}
            </button>
          )}
          <CommentText c={c} />
        </p>
        {!reply && c.resolved && <div className="cmt-resolved-by">Resolved{resolver ? ` by ${resolver}` : ''}</div>}
        {footer}
      </div>
      {!reply && (
        <div className="cmt-actions">
          {c.resolved ? (
            <button className="cmt-act" title="Reopen" aria-label="Reopen" onClick={() => setResolved(c.id, false)}>
              <RotateCcw {...ICON} />
            </button>
          ) : (
            <button className="cmt-act cmt-check" title="Resolve" aria-label="Resolve" onClick={() => setResolved(c.id, true)}>
              <Check {...ICON} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A thread: the first comment, its replies, and a reply box on demand. */
function ThreadCard({ t, targetId, onSeek, maxReplies, onMore, index }: {
  t: Thread;
  targetId: string;
  onSeek?: (t: number) => void;
  /** Show only the latest few replies (beside a card); the rest via onMore. */
  maxReplies?: number;
  onMore?: () => void;
  index: number;
}) {
  const [replying, setReplying] = useState(false);
  const hidden = maxReplies != null ? Math.max(0, t.replies.length - maxReplies) : 0;
  const replies = hidden ? t.replies.slice(-maxReplies!) : t.replies;
  return (
    <article className="cmt-thread" style={{ '--i': index } as CSSProperties}>
      <CommentRow
        c={t.root}
        onSeek={onSeek}
        footer={!t.root.resolved && !replying && (
          <button className="cmt-reply-btn" onClick={() => setReplying(true)}>Reply</button>
        )}
      />
      {(replies.length > 0 || hidden > 0 || replying) && (
        <div className="cmt-replies">
          {hidden > 0 && (
            <button className="cmt-earlier" onClick={onMore}>{hidden} earlier {hidden === 1 ? 'reply' : 'replies'}</button>
          )}
          {replies.map((r) => <CommentRow key={r.id} c={r} reply />)}
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
          {timed ? fmtTime(now) : 'Whole video'}
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

/** The full list: Open and Resolved tabs, scrolling, composer under Open. */
export function CommentList({ targetId, clock, onSeek, onBack, initialTab = 'open' }: ThreadProps & {
  onBack?: () => void;
  initialTab?: 'open' | 'resolved';
}) {
  const all = useComments(targetId);
  const [tab, setTab] = useState(initialTab);
  const threads = useMemo(() => toThreads(all), [all]);
  const open = threads.filter((t) => !t.root.resolved);
  const resolved = threads.filter((t) => t.root.resolved).sort((a, b) => (b.root.resolvedAt ?? 0) - (a.root.resolvedAt ?? 0));
  const shown = tab === 'open' ? open : resolved;
  return (
    <div className="cmt-full">
      <div className="cmt-tabs" role="tablist">
        {onBack && (
          <button className="cmt-back" title="Show fewer" aria-label="Show fewer" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
        <button role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
          Open <span>{open.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>
          Resolved <span>{resolved.length}</span>
        </button>
      </div>
      <div className="cmt-list">
        {shown.map((t, i) => <ThreadCard key={t.root.id} t={t} targetId={targetId} onSeek={onSeek} index={Math.min(i, 8)} />)}
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

/** Beside a selected card: up to five open threads, then "Show all". */
function QuickThread({ targetId, clock, onSeek, onExpand }: ThreadProps & { onExpand: (tab: 'open' | 'resolved') => void }) {
  const all = useComments(targetId);
  const threads = useMemo(() => toThreads(all), [all]);
  const open = threads.filter((t) => !t.root.resolved);
  const resolvedCount = threads.length - open.length;
  // Timecoded threads read in timecode order; others show the latest few.
  const timed = open.some((t) => t.root.time != null);
  const shown = timed ? open.slice(0, QUICK_MAX) : open.slice(-QUICK_MAX);
  const hidden = open.length - shown.length;

  return (
    <div className="cmt-quick" style={{ '--n': shown.length + 1 } as CSSProperties}>
      {shown.map((t, i) => (
        <ThreadCard key={t.root.id} t={t} targetId={targetId} onSeek={onSeek} index={i} maxReplies={QUICK_REPLIES} onMore={() => onExpand('open')} />
      ))}
      {(hidden > 0 || resolvedCount > 0) && (
        <button className="cmt-more" style={{ '--i': shown.length } as CSSProperties} onClick={() => onExpand(hidden > 0 || !resolvedCount ? 'open' : 'resolved')}>
          {hidden > 0 ? `Show all ${open.length} comments` : `${resolvedCount} resolved`}
        </button>
      )}
      <div className="cmt-quick-compose">
        <Typing targetId={targetId} />
        <Composer targetId={targetId} clock={clock} />
      </div>
    </div>
  );
}

// --- Popover beside the selected card -----------------------------------------------------

export function CommentsPopover() {
  const boardId = useBoardId();
  const id = useUi((s) => s.selectedId);
  const hidden = useUi((s) => s.movingId != null || s.dragId != null || s.flyout != null || s.viewer != null || s.contextMenu != null);
  const item = useBoard((s) => (id ? s.items[id] : undefined));
  const slot = useLayout((s) => (id ? s.slots[id] : undefined));
  useSyncExternalStore(camera.subscribe, () => camera.version);
  if (!item || hidden || item.boardId !== boardId || !COMMENTABLE.has(item.kind)) return null;
  void slot; // follow the card when its place in a section changes

  const at = posOf(item);
  const tl = camera.worldToScreen(at.x, at.y);
  const left = tl.x + camera.origin.x;
  const top = Math.max(camera.origin.y + 8, tl.y + camera.origin.y);
  const width = itemSize(item).w * camera.z;
  const right = left + width + GAP + POP_WIDTH < window.innerWidth - 8;
  const x = right ? left + width + GAP : Math.max(8, left - GAP - POP_WIDTH);
  const isVideo = item.kind === 'media' && item.mediaType === 'video';

  return <Popover key={item.id} id={item.id} style={{ left: x, top, width: POP_WIDTH }} video={isVideo} />;
}

function Popover({ id, style, video }: { id: string; style: CSSProperties; video: boolean }) {
  const [expanded, setExpanded] = useState<null | 'open' | 'resolved'>(null);
  const clock = video ? () => cardVideos.get(id)?.currentTime ?? null : undefined;
  const onSeek = video
    ? (t: number) => { const v = cardVideos.get(id); if (v) { v.pause(); v.currentTime = t; } }
    : undefined;
  return (
    <div
      className="cmt-pop"
      data-expanded={expanded ? 'true' : undefined}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {expanded ? (
        <CommentList targetId={id} clock={clock} onSeek={onSeek} initialTab={expanded} onBack={() => setExpanded(null)} />
      ) : (
        <QuickThread targetId={id} clock={clock} onSeek={onSeek} onExpand={setExpanded} />
      )}
    </div>
  );
}
