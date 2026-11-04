// Comments UI: the count badge on a card, the comments that swing out beside
// a selected card (up to five, with "Show all"), the full list with Open /
// Resolved tabs, and the composer. The video player reuses the full list.

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Check, ChevronLeft, Clock, MessageSquarePlus, RotateCcw, Trash2 } from 'lucide-react';
import { COMMENTABLE, useBoard, type Comment } from '../board/store';
import { useUi } from '../board/ui';
import { useLayout } from '../board/layout';
import { useBoardId } from '../board/nav';
import { itemSize, posOf } from '../board/actions';
import { addComment, cardVideos, deleteComment, setResolved, timeAgo, useComments, useOpenCount } from '../board/comments';
import { camera } from '../canvas/camera';
import { session } from '../session';
import { personalColor, usePresence } from '../sync/presence';
import { Avatar } from './Collab';
import { fmtTime } from './Scrubber';

const ICON = { size: 14, strokeWidth: 2.2, 'aria-hidden': true } as const;
/** Comments shown beside a card before "Show all". */
const QUICK_MAX = 5;
const POP_WIDTH = 300;
const GAP = 14;

// --- Badge on the card ------------------------------------------------------------

/** Small circle in a card's top-right corner while it has open comments. */
export function CommentBadge({ id }: { id: string }) {
  const n = useOpenCount(id);
  if (!n) return null;
  return <span className="cmt-badge" title={`${n} open comment${n === 1 ? '' : 's'}`}>{n > 9 ? '9+' : n}</span>;
}

// --- One comment -------------------------------------------------------------------

function CommentCard({ c, index, onSeek }: { c: Comment; index: number; onSeek?: (t: number) => void }) {
  const profile = usePresence((s) => s.users[c.authorId]);
  const resolver = usePresence((s) => (c.resolvedBy ? s.users[c.resolvedBy]?.name : undefined));
  const name = profile?.name ?? c.authorName;
  const mine = c.authorId === session.userId;
  return (
    <article className="cmt" data-resolved={c.resolved || undefined} style={{ '--i': index } as CSSProperties}>
      <Avatar profile={{ name, icon: profile?.icon ?? null }} color={personalColor(c.authorId)} size={24} />
      <div className="cmt-body">
        <header className="cmt-meta">
          <span className="cmt-author">{mine ? `${name} (you)` : name}</span>
          <span className="cmt-when" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
          {mine && (
            <button className="cmt-act cmt-delete" title="Delete comment" aria-label="Delete comment" onClick={() => deleteComment(c.id)}>
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
          {c.text}
        </p>
        {c.resolved && <div className="cmt-resolved-by">Resolved{resolver ? ` by ${resolver}` : ''}</div>}
      </div>
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
    </article>
  );
}

// --- Composer ------------------------------------------------------------------------

function Composer({ targetId, clock, autoFocus, onDone }: {
  targetId: string;
  /** Current video time, for timecoded comments (videos only). */
  clock?: () => number | null;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [text, setText] = useState('');
  const [timed, setTimed] = useState(true);
  const [now, setNow] = useState<number | null>(() => clock?.() ?? null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Keep the timecode chip in step with the video.
  useEffect(() => {
    if (!clock) return;
    const t = setInterval(() => setNow(clock()), 200);
    return () => clearInterval(t);
  }, [clock]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim()) return;
    addComment(targetId, text, clock && timed ? clock() : null);
    setText('');
    onDone?.();
  };

  return (
    <div className="cmt-composer">
      {clock && now != null && (
        <button
          className="cmt-chip"
          aria-pressed={timed}
          title={timed ? 'Comment is pinned to this moment — click to make it about the whole video' : 'Pin this comment to the current moment'}
          onClick={() => setTimed((t) => !t)}
        >
          <Clock size={12} strokeWidth={2.2} aria-hidden="true" />
          {timed ? fmtTime(now) : 'Whole video'}
        </button>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder="Add a comment…"
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
        }}
      />
      <button className="cmt-send" disabled={!text.trim()} onClick={submit}>Post</button>
    </div>
  );
}

// --- A thread: quick (beside the card) or full (tabs) -----------------------------------

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
  const open = all.filter((c) => !c.resolved);
  const resolved = all.filter((c) => c.resolved).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
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
        {shown.map((c, i) => <CommentCard key={c.id} c={c} index={Math.min(i, 8)} onSeek={onSeek} />)}
        {!shown.length && (
          <p className="cmt-empty">{tab === 'open' ? 'No open comments.' : 'Nothing resolved yet. Tick a comment to file it here.'}</p>
        )}
      </div>
      {tab === 'open' && <Composer targetId={targetId} clock={clock} />}
    </div>
  );
}

/** Beside a selected card: up to five open comments, then "Show all". */
function QuickThread({ targetId, clock, onSeek, onExpand }: ThreadProps & { onExpand: (tab: 'open' | 'resolved') => void }) {
  const all = useComments(targetId);
  const [composing, setComposing] = useState(false);
  const open = all.filter((c) => !c.resolved);
  const resolvedCount = all.length - open.length;
  // Timecoded threads read in timecode order; others show the latest few.
  const timed = open.some((c) => c.time != null);
  const shown = timed ? open.slice(0, QUICK_MAX) : open.slice(-QUICK_MAX);
  const hidden = open.length - shown.length;

  return (
    <div className="cmt-quick" style={{ '--n': shown.length + 1 } as CSSProperties}>
      {shown.map((c, i) => <CommentCard key={c.id} c={c} index={i} onSeek={onSeek} />)}
      {(hidden > 0 || resolvedCount > 0) && (
        <button className="cmt-more" style={{ '--i': shown.length } as CSSProperties} onClick={() => onExpand(hidden > 0 || !resolvedCount ? 'open' : 'resolved')}>
          {hidden > 0 ? `Show all ${open.length} comments` : `${resolvedCount} resolved`}
        </button>
      )}
      {composing || open.length ? (
        <Composer targetId={targetId} clock={clock} autoFocus={composing} />
      ) : (
        <button className="cmt-add" onClick={() => setComposing(true)}>
          <MessageSquarePlus size={15} strokeWidth={2} aria-hidden="true" /> Comment
        </button>
      )}
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

  return (
    <Popover
      key={item.id}
      id={item.id}
      side={right ? 'right' : 'left'}
      style={{ left: x, top, width: POP_WIDTH }}
      video={isVideo}
    />
  );
}

function Popover({ id, side, style, video }: { id: string; side: 'left' | 'right'; style: CSSProperties; video: boolean }) {
  const [expanded, setExpanded] = useState<null | 'open' | 'resolved'>(null);
  const clock = video ? () => cardVideos.get(id)?.currentTime ?? null : undefined;
  const onSeek = video
    ? (t: number) => { const v = cardVideos.get(id); if (v) { v.pause(); v.currentTime = t; } }
    : undefined;
  return (
    <div
      className="cmt-pop"
      data-side={side}
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
