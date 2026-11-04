// The bell in the top bar: @mentions of you and replies in threads you're in,
// newest first. Clicking one opens its board and selects the item, which
// brings up its comments. New ones arriving while you work also show a toast.

import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useBoard, type Comment } from '../board/store';
import { useUi } from '../board/ui';
import { currentBoardId } from '../board/nav';
import { enterBoard, itemSize, posOf } from '../board/actions';
import {
  boardLabel, isUnread, markAllRead, markRead, targetLabel, timeAgo, useNoticeRead, useNotices, type Notice,
} from '../board/comments';
import { camera } from '../canvas/camera';
import { personalColor, usePresence } from '../sync/presence';
import { Avatar, Popover } from './Collab';
import { byLine } from '../lib/time';

const ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const;

/** Open the comment's board, select what it's on, and bring that into view. */
export function goToComment(c: Comment) {
  if (currentBoardId() !== c.boardId) enterBoard(c.boardId);
  // Let the board render (and sections lay out) before measuring.
  setTimeout(() => {
    const it = useBoard.getState().items[c.targetId];
    if (!it) return;
    const p = posOf(it);
    const { w, h } = itemSize(it);
    camera.centerOn(p.x + w / 2 + 150 / camera.z, p.y + h / 2, camera.z, camera.width, camera.height);
    useUi.getState().set({ selectedIds: [it.id], editingId: null });
  }, 80);
}

function verb(n: Notice) {
  return n.kind === 'mention' ? 'mentioned you on' : 'replied on';
}

export function NotificationBell() {
  const notices = useNotices();
  const read = useNoticeRead();
  const unread = notices.filter((n) => isUnread(n, read)).length;
  useLiveToasts(notices);

  return (
    <Popover
      label="Notifications"
      button={(open, toggle) => (
        <button className="top-btn top-bell" aria-expanded={open} onClick={toggle} title="Notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell {...ICON} />
          {unread > 0 && <span className="top-badge bell-count">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="notices">
          <div className="notices-head">
            <h3>Notifications</h3>
            {unread > 0 && <button className="notices-mark" onClick={markAllRead}>Mark all read</button>}
          </div>
          {notices.length === 0 && (
            <p className="pop-empty">Nothing yet. When someone @mentions you or replies to your comments, it shows up here.</p>
          )}
          <div className="notices-list">
            {notices.slice(0, 50).map((n) => (
              <NoticeRow key={n.comment.id} n={n} unread={isUnread(n, read)} onOpen={() => { markRead(n.comment.id); close(); goToComment(n.comment); }} />
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

function NoticeRow({ n, unread, onOpen }: { n: Notice; unread: boolean; onOpen: () => void }) {
  const c = n.comment;
  const author = usePresence((s) => s.users[c.authorId]);
  const target = useBoard((s) => s.items[c.targetId]);
  const name = author?.name ?? c.authorName;
  return (
    <button className="notice" data-unread={unread || undefined} onClick={onOpen}>
      <Avatar profile={{ name, icon: author?.icon ?? null }} color={personalColor(c.authorId)} size={28} />
      <span className="notice-body">
        <span className="notice-line">
          <strong>{name}</strong> {verb(n)} <strong>{targetLabel(target)}</strong>
        </span>
        <span className="notice-text">{c.text}</span>
        <span className="notice-where" title={byLine(boardLabel(c.boardId), c.createdAt)}>{boardLabel(c.boardId)} · {timeAgo(c.createdAt)}</span>
      </span>
      {unread && <span className="notice-dot" aria-label="Unread" />}
    </button>
  );
}

/** A toast for each notification that arrives while the app is open. */
function useLiveToasts(notices: Notice[]) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(notices.map((n) => n.comment.id)); return; }
    for (const n of notices) {
      if (seen.current.has(n.comment.id)) continue;
      seen.current.add(n.comment.id);
      if (Date.now() - n.comment.createdAt > 60_000) continue; // old ones synced in, not new
      const c = n.comment;
      const name = usePresence.getState().users[c.authorId]?.name ?? c.authorName;
      const target = useBoard.getState().items[c.targetId];
      useUi.getState().set({
        toast: {
          text: `${name} ${verb(n)} ${targetLabel(target)}: “${c.text.length > 60 ? `${c.text.slice(0, 60)}…` : c.text}”`,
          boardId: c.boardId !== currentBoardId() ? c.boardId : undefined,
          at: Date.now(),
        },
      });
    }
  }, [notices]);
}
