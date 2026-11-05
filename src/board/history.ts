// Undo / redo for everything you do to the board: moving, stacking, sections,
// deleting, editing, statuses… Every local change to the board store is
// recorded as the before/after copies of the items it touched, grouped into
// steps:
//
// - one press-drag-release (or click) is one step, whatever it changed;
// - changes made together (in one go, e.g. deleting a selection) are one step;
// - typing into one thing is one step until you pause.
//
// Changes that aren't yours to undo (other people's edits, an upload finishing,
// a link preview arriving, the server's video details) are folded into the
// recorded copies instead, so undoing never throws them away. Comments are
// left out: they have their own edit/delete.

import { create } from 'zustand';
import { useBoard, type Item } from './store';
import { currentBoardId, openBoard } from './nav';
import { useUi } from './ui';
import { homeId } from '../session';

type Snap = Item | undefined;
interface Step {
  /** Each touched item before and after (undefined = didn't exist). */
  before: Map<string, Snap>;
  after: Map<string, Snap>;
  /** The board it happened on. */
  boardId: string;
}

const LIMIT = 200;
/** A pause longer than this ends a typing step. */
const TYPING_PAUSE = 1000;
/** Changes this close together count as one (e.g. a drop and the tidy-up after it). */
const SAME_MOMENT = 250;

const undoStack: Step[] = [];
const redoStack: Step[] = [];
let open: Step | null = null;
let lastAt = 0;
let pressing = false;
let inTask = false;
let closeTimer = 0;
/** 'user' records; 'other' folds in; 'replay' (undo/redo itself) does neither. */
let mode: 'user' | 'other' | 'replay' = 'user';

/** Whether there's anything to undo / redo (for the buttons). */
export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>()(() => ({ canUndo: false, canRedo: false }));
const publish = () => {
  const canUndo = undoStack.length > 0 || !!open, canRedo = redoStack.length > 0;
  const s = useHistory.getState();
  if (s.canUndo !== canUndo || s.canRedo !== canRedo) useHistory.setState({ canUndo, canRedo });
};

/** Run board changes that aren't the user's own doing (they're never undone). */
export function untracked<T>(fn: () => T): T {
  const was = mode;
  mode = 'other';
  try { return fn(); } finally { mode = was; }
}

const same = (a: Snap, b: Snap) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/** Finish the step being recorded (dropping it if it changed nothing in the end). */
function close() {
  clearTimeout(closeTimer);
  if (!open) return;
  const step = open;
  open = null;
  for (const id of [...step.before.keys()]) {
    if (same(step.before.get(id), step.after.get(id))) { step.before.delete(id); step.after.delete(id); }
  }
  if (step.before.size) {
    undoStack.push(step);
    if (undoStack.length > LIMIT) undoStack.shift();
  }
  publish();
}

function record(ids: string[], prev: Record<string, Item>, next: Record<string, Item>) {
  const now = performance.now();
  if (open && !pressing && !inTask && now - lastAt > SAME_MOMENT) {
    const typing = ids.every((id) => open!.before.has(id)) && now - lastAt < TYPING_PAUSE;
    if (!typing) close();
  }
  if (!open) open = { before: new Map(), after: new Map(), boardId: currentBoardId() };
  for (const id of ids) {
    if (!open.before.has(id)) open.before.set(id, prev[id]);
    open.after.set(id, next[id]);
  }
  lastAt = now;
  if (!inTask) { inTask = true; queueMicrotask(() => { inTask = false; }); }
  if (redoStack.length) redoStack.length = 0;
  clearTimeout(closeTimer);
  if (!pressing) closeTimer = window.setTimeout(close, TYPING_PAUSE);
  publish();
}

/** Someone else changed `from` into `to`: make the same change to a recorded copy. */
function rebase(snap: Snap, from: Snap, to: Snap): Snap {
  if (!snap || !from || !to) return snap;
  const out = { ...snap } as Record<string, unknown>;
  const a = from as unknown as Record<string, unknown>, b = to as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (k in b) out[k] = b[k]; else delete out[k];
  }
  return out as unknown as Item;
}

function foldIn(prev: Record<string, Item>, next: Record<string, Item>) {
  for (const step of [...undoStack, ...redoStack, ...(open ? [open] : [])]) {
    for (const id of step.before.keys()) {
      const from = prev[id], to = next[id];
      if (from === to) continue;
      step.before.set(id, rebase(step.before.get(id), from, to));
      step.after.set(id, rebase(step.after.get(id), from, to));
    }
  }
}

useBoard.subscribe((s, prev) => {
  if (s.items === prev.items || mode === 'replay') return;
  if (mode === 'other') { foldIn(prev.items, s.items); return; }
  const ids: string[] = [];
  for (const id in s.items) if (s.items[id] !== prev.items[id]) ids.push(id);
  for (const id in prev.items) if (!(id in s.items)) ids.push(id);
  if (!ids.length) return;
  // Comments aren't undone from here; keep the recorded copies up to date with them.
  if (ids.every((id) => (s.items[id] ?? prev.items[id])?.kind === 'comment')) { foldIn(prev.items, s.items); return; }
  record(ids, prev.items, s.items);
});

// One press (a drag, a click, a pick from a menu) is one step.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { if (e.button === 0) { close(); pressing = true; } }, true);
  const up = () => {
    if (!pressing) return;
    pressing = false;
    // The drop lands just after the pointer comes up (and may glide into place): let it join.
    lastAt = performance.now();
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, SAME_MOMENT);
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

/** Put copies of items back as they were. */
function apply(snaps: Map<string, Snap>) {
  mode = 'replay';
  try {
    useBoard.setState((s) => {
      const items = { ...s.items };
      let topZ = s.topZ;
      for (const [id, it] of snaps) {
        if (it) { items[id] = it; topZ = Math.max(topZ, it.z); } else delete items[id];
      }
      return { items, topZ };
    });
  } finally {
    mode = 'user';
  }
}

/** Show what changed: go to its board and select it. */
function reveal(step: Step, snaps: Map<string, Snap>) {
  const items = useBoard.getState().items;
  if (step.boardId !== currentBoardId() && (items[step.boardId] || step.boardId === homeId())) openBoard(step.boardId);
  const ids = [...snaps.keys()].filter((id) => {
    const it = items[id];
    return it && it.kind !== 'comment' && it.boardId === step.boardId;
  });
  // Only what's on top: a section's contents come with it.
  const top = ids.filter((id) => {
    const p = (items[id] as { parentId?: string | null }).parentId;
    return !p || !ids.includes(p);
  });
  useUi.getState().set({ selectedIds: top, editingId: null });
}

export function undo() {
  close();
  const step = undoStack.pop();
  if (!step) return false;
  apply(step.before);
  redoStack.push(step);
  reveal(step, step.before);
  publish();
  return true;
}

export function redo() {
  close();
  const step = redoStack.pop();
  if (!step) return false;
  apply(step.after);
  undoStack.push(step);
  reveal(step, step.after);
  publish();
  return true;
}
