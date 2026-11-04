// Comments on notes, to-dos, links, photos and videos. Each comment is an item
// of kind 'comment' pointing at its target (see store.ts), so it syncs, shares
// and merges per comment. Video comments can carry a timecode.

import { useShallow } from 'zustand/react/shallow';
import { useBoard, type Comment, type Item } from './store';
import { session } from '../session';
import { usePresence } from '../sync/presence';

const EMPTY: Comment[] = [];

/** Comments grouped by target, in reading order: by timecode (untimed first), then oldest first. */
let indexed: Record<string, Item> | null = null;
let index = new Map<string, Comment[]>();
export function commentIndex(items: Record<string, Item>): Map<string, Comment[]> {
  if (items === indexed) return index;
  const next = new Map<string, Comment[]>();
  for (const it of Object.values(items)) {
    if (it.kind !== 'comment') continue;
    const list = next.get(it.targetId);
    if (list) list.push(it); else next.set(it.targetId, [it]);
  }
  for (const list of next.values()) list.sort((a, b) => (a.time ?? -1) - (b.time ?? -1) || a.createdAt - b.createdAt);
  indexed = items;
  index = next;
  return next;
}

/** Every comment on an item (open and resolved), in order. */
export const useComments = (targetId: string) =>
  useBoard(useShallow((s) => commentIndex(s.items).get(targetId) ?? EMPTY));

/** How many comments on an item are still open. */
export const useOpenCount = (targetId: string) =>
  useBoard((s) => (commentIndex(s.items).get(targetId) ?? EMPTY).reduce((n, c) => n + (c.resolved ? 0 : 1), 0));

export function addComment(targetId: string, text: string, time: number | null) {
  const target = useBoard.getState().items[targetId];
  const body = text.trim();
  if (!target || !body) return;
  useBoard.getState().addItem('comment', {
    boardId: target.boardId, x: 0, y: 0,
    targetId,
    authorId: session.userId,
    authorName: usePresence.getState().me?.name ?? 'Me',
    text: body,
    createdAt: Date.now(),
    time: time != null && Number.isFinite(time) ? time : null,
  });
}

/** Tick a comment off (it moves to "Resolved"), or reopen it. */
export function setResolved(id: string, resolved: boolean) {
  useBoard.getState().updateItem(id, { resolved, resolvedBy: resolved ? session.userId : null, resolvedAt: resolved ? Date.now() : null });
}

export const deleteComment = (id: string) => useBoard.getState().removeItem(id);

/** "now", "5m", "3h", "2d", or a date. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Video elements of media cards on screen, so a comment can pick up (or jump to) the card's time. */
export const cardVideos = new Map<string, HTMLVideoElement>();
