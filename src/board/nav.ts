// Which board is open. Lives in the URL hash (#/b/<id>) so the browser's
// back/forward buttons and links work; Home is #/.

import { useSyncExternalStore } from 'react';
import { homeId, isHome } from '../session';
import { useBoard, type Board } from './store';
import { effectiveIcon } from '../lib/iconGuess';

function parse(): string {
  const m = /^#\/b\/([\w-]+)/.exec(location.hash);
  const id = m?.[1];
  const item = id ? useBoard.getState().items[id] : undefined;
  return item?.kind === 'board' ? item.id : homeId();
}

let current = parse();
const listeners = new Set<() => void>();

function refresh() {
  const next = parse();
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

window.addEventListener('hashchange', refresh);
// The open board may appear (sync) or disappear (unshared, deleted elsewhere).
useBoard.subscribe((s, prev) => { if (s.items !== prev.items) refresh(); });

/** Re-resolve the open board, e.g. after the user id (and so Home) changed. */
export const refreshBoard = refresh;

export const currentBoardId = () => current;

export function subscribeBoard(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const useBoardId = () => useSyncExternalStore(subscribeBoard, currentBoardId);

export function openBoard(id: string) {
  location.hash = isHome(id) ? '#/' : `#/b/${id}`;
}

export interface Crumb {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  home: boolean;
}

export function crumbFor(id: string, items = useBoard.getState().items): Crumb {
  if (isHome(id)) return { id, title: 'Home', icon: 'House', color: null, home: true };
  const b = items[id] as Board | undefined;
  return { id, title: b?.title || 'Untitled board', icon: b ? effectiveIcon(b) : null, color: b?.color ?? null, home: false };
}

/**
 * Home → … → the board itself. A board shared with you sits right under your
 * Home in the path (the owner's boards above it aren't yours to see).
 */
export function pathTo(id: string, items = useBoard.getState().items): Crumb[] {
  const path: Crumb[] = [];
  let cur: string | undefined = id;
  for (let guard = 0; cur && guard < 64; guard++) {
    // Stop at anything you can't see: someone else's board, or their Home.
    if (isHome(cur) ? cur !== homeId() : !items[cur]) break;
    path.unshift(crumbFor(cur, items));
    if (isHome(cur)) return path;
    cur = items[cur]?.boardId;
  }
  // Shared with you (the owner's boards above aren't visible): start from your
  // own Home, so it's always one click away.
  if (!path[0]?.home) path.unshift(crumbFor(homeId(), items));
  return path;
}
