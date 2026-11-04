// Item behaviours (what happens when things are grabbed, dragged, dropped)
// and board-level commands used by the sidebar and keyboard shortcuts.

import { camera, type Point, type Rect } from '../canvas/camera';
import { bodies, type Body, type BodyHooks } from './body';
import { BOARD_HEIGHT, COLUMN_HEADER, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH } from './constants';
import { dropIndex, snap, stackedSize, useLayout, type Size } from './layout';
import {
  columnContents, descendants, onCanvas, parentOf, stackZ, useBoard, type Column, type Item, type ItemKind,
} from './store';
import { currentBoardId, openBoard } from './nav';
import { useUi } from './ui';
import { COLOR_PRESETS } from '../lib/color';
import { dismissShortcut } from '../sync/client';

const board = useBoard.getState;
const ui = useUi.getState;
const layout = useLayout.getState;

// --- Selection -----------------------------------------------------------------

/** Item being dragged out of the sidebar; selected only once dropped. */
let spawningId: string | null = null;

function select(id: string) {
  if (spawningId === id) return;
  const { editingId } = ui();
  ui().set({ selectedIds: [id], editingId: editingId === id ? id : null });
  board().bringToFront(id);
}

export const selectOnly = (id: string) => ui().set({ selectedIds: [id], editingId: null });
export const clearSelection = () => ui().set({ selectedIds: [], editingId: null, contextMenu: null });

/** Shift-click: add to or remove from the selection. */
export function toggleSelect(id: string) {
  const ids = ui().selectedIds;
  ui().set({ selectedIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], editingId: null });
}

export function selectAll() {
  const boardId = currentBoardId();
  const ids = Object.values(board().items).filter((i) => i.boardId === boardId && !parentOf(i) && onCanvas(i)).map((i) => i.id);
  ui().set({ selectedIds: ids, editingId: null });
}

// --- Geometry --------------------------------------------------------------------

/** Where an item sits in the world: its own x/y, or its slot in a column. */
export function posOf(it: Item): Point {
  return (parentOf(it) && layout().slots[it.id]) || { x: it.x, y: it.y };
}

/** Rendered size of an item. */
export function itemSize(it: Item): Size {
  const { heights, widths } = layout();
  if (it.kind === 'column') return { w: widths[it.id] ?? COLUMN_WIDTH, h: heights[it.id] ?? COLUMN_HEADER };
  if (parentOf(it)) {
    // Stacked cards stretch to their column's inner width.
    const size = stackedSize(it.id);
    return { w: layout().fills[it.id] ?? size.w, h: size.h };
  }
  if (it.kind === 'board') return { w: it.w, h: heights[it.id] ?? BOARD_HEIGHT };
  return { w: it.w, h: heights[it.id] ?? NOTE_MIN_HEIGHT };
}

export const itemHeight = (it: Item) => itemSize(it).h;

/** Innermost column under a world point, ignoring `exclude` (what's being dragged). */
function columnAt(p: Point, exclude: Set<string>): Column | null {
  const { items } = board();
  const boardId = currentBoardId();
  let hit: Column | null = null;
  let hitZ = -Infinity;
  for (const it of Object.values(items)) {
    if (it.kind !== 'column' || it.boardId !== boardId || exclude.has(it.id)) continue;
    const o = posOf(it);
    const { w, h } = itemSize(it);
    if (p.x < o.x || p.x > o.x + w || p.y < o.y || p.y > o.y + h) continue;
    const z = stackZ(items, it.id);
    if (z > hitZ) { hit = it; hitZ = z; }
  }
  return hit;
}

/** Top-level items on the open board touching a world rect (box selection). */
export function itemsInRect(r: Rect): string[] {
  const boardId = currentBoardId();
  return Object.values(board().items)
    .filter((it) => {
      if (it.boardId !== boardId || parentOf(it) || !onCanvas(it)) return false;
      const { w, h } = itemSize(it);
      return it.x < r.x1 && it.x + w > r.x0 && it.y < r.y1 && it.y + h > r.y0;
    })
    .map((it) => it.id);
}

// --- Dragging ----------------------------------------------------------------------

/** What rides along with a column: its contents, at any depth. */
const contentsOf = (id: string) => columnContents(board().items, id);

/** Everything moving with a drag of `id` (it, its contents, the rest of a dragged group). */
function draggedWith(id: string, group: boolean): Set<string> {
  const out = new Set([id, ...contentsOf(id)]);
  if (group) for (const other of ui().selectedIds) { out.add(other); for (const c of contentsOf(other)) out.add(c); }
  return out;
}

/** Board under the pointer: a crumb in the top-bar path, or a board on the canvas. */
function boardTargetAt(p: Point, client: Point, exclude: Set<string>): string | null {
  const crumb = document.elementFromPoint(client.x, client.y)?.closest('[data-crumb-id]');
  if (crumb) {
    const bid = crumb.getAttribute('data-crumb-id');
    return bid && bid !== currentBoardId() ? bid : null;
  }
  const { items } = board();
  const boardId = currentBoardId();
  let hit: string | null = null;
  let hitZ = -Infinity;
  for (const it of Object.values(items)) {
    if (it.kind !== 'board' || it.boardId !== boardId || exclude.has(it.id)) continue;
    const o = posOf(it);
    const { w, h } = itemSize(it);
    if (p.x < o.x || p.x > o.x + w || p.y < o.y || p.y > o.y + h) continue;
    const z = stackZ(items, it.id);
    if (z > hitZ) { hit = it.linkTo ?? it.id; hitZ = z; }
  }
  return hit;
}

const GAP_IN_TARGET = 48;

/**
 * Move a dragged item (and the rest of its group) into another board,
 * placed to the right of what's already there, keeping their arrangement.
 */
function moveIntoBoard(body: Body, id: string, targetId: string) {
  const { items } = board();
  const ids = [id];
  const at: Record<string, Point> = {};
  const bounds = contentBounds(targetId);
  const base = bounds ? { x: snap(bounds.x1 + GAP_IN_TARGET), y: snap(bounds.y0) } : { x: 0, y: 0 };
  at[id] = base;
  if (body.multi) {
    for (const f of body.followers) {
      if (parentOf(items[f.body.id])) continue; // column contents ride along with their column
      ids.push(f.body.id);
      at[f.body.id] = { x: base.x + f.ox, y: base.y + f.oy };
    }
  }
  board().moveToBoard(ids, targetId, at);
  const target = board().items[targetId];
  const name = target?.kind === 'board' ? target.title || 'Untitled board' : 'Home';
  ui().set({
    selectedIds: [], editingId: null, dragId: null, movingId: null, boardDrop: null,
    toast: { text: `Moved ${ids.length === 1 ? '1 item' : `${ids.length} items`} to ${name}`, boardId: targetId, at: Date.now() },
  });
}

/**
 * Behaviour shared by every item: drag it freely, into or out of columns
 * (columns nest), or as part of a multi-selection.
 */
export function itemHooks(id: string): BodyHooks {
  return {
    grab(body: Body) {
      const sel = ui().selectedIds;
      const group = sel.length > 1 && sel.includes(id);
      body.multi = group;
      if (!group) select(id);

      // Carry everything that should move with this item: its own contents,
      // plus the other selected top-level items (and their contents).
      const { items } = board();
      const carried = new Set(contentsOf(id));
      if (group) {
        for (const other of sel) {
          if (other === id || !items[other] || parentOf(items[other])) continue;
          carried.add(other);
          for (const c of contentsOf(other)) carried.add(c);
        }
      }
      const followers = [...carried].map((c) => bodies.get(c)).filter((b): b is Body => !!b);
      if (followers.length) {
        const { w, h } = itemSize(items[id]);
        body.carry(followers, w, h);
      }
    },

    dragMove(body, p, client) {
      // Over another board (on the canvas or in the path above)? That wins.
      const target = boardTargetAt(p, client, draggedWith(id, body.multi));
      if (target !== ui().boardDrop) ui().set({ boardDrop: target, ...(target ? { drop: null } : {}) });
      if (target) return;

      if (body.multi) return; // groups move freely; dropping a group into a column isn't supported
      const col = columnAt(p, new Set([id, ...contentsOf(id)]));
      const current = ui().drop;
      if (!col) {
        if (current) ui().set({ drop: null });
        return;
      }
      const { heights, widths } = layout();
      const sizes = Object.fromEntries(col.childIds.map((c) => [c, stackedSize(c, { heights, widths })]));
      const index = dropIndex(col, posOf(col), sizes, id, p);
      if (current?.columnId === col.id && current.index === index) return;
      const item = board().items[id];
      // The size it will have once stacked (boards become rows; columns keep theirs).
      const size = item?.kind === 'column' ? itemSize(item) : { w: NOTE_WIDTH, h: heights[id] ?? NOTE_MIN_HEIGHT };
      ui().set({ drop: { columnId: col.id, index, ...size } });
    },

    release(body, land, moved) {
      const drop = ui().drop;
      const targetBoard = ui().boardDrop;
      if (drop || targetBoard) ui().set({ drop: null, boardDrop: null });
      if (!moved) return null;

      if (targetBoard) {
        moveIntoBoard(body, id, targetBoard);
        return null;
      }

      if (drop) {
        board().moveToColumn(id, drop.columnId, drop.index);
        return null; // the column hands out the slot
      }
      if (parentOf(board().items[id])) board().detach(id, land);
      else board().updateItem(id, land);

      // Group drag: everything else top-level lands at the same offset.
      if (body.multi) {
        const { items } = board();
        for (const f of body.followers) {
          if (!parentOf(items[f.body.id])) board().updateItem(f.body.id, { x: land.x + f.ox, y: land.y + f.oy });
        }
      }
      return land;
    },
  };
}

// --- Commands ----------------------------------------------------------------

export function viewportCenterWorld(): Point {
  return camera.screenToWorld(camera.width / 2, camera.height / 2);
}

const snapPoint = (p: Point): Point => (ui().snap ? { x: snap(p.x), y: snap(p.y) } : p);

/** The bright presets (not the greys, brown or peach) new boards start in. */
const BOARD_STARTS = COLOR_PRESETS.slice(0, 12);

/** A random starting colour, avoiding ones already used by boards alongside it while any are left. */
function randomBoardColor(siblings: Item[]): string {
  const used = new Set(siblings.map((b) => ('color' in b ? b.color?.toUpperCase() : undefined)));
  const fresh = BOARD_STARTS.filter((c) => !used.has(c));
  const pool = fresh.length ? fresh : BOARD_STARTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function addOnCurrentBoard(kind: ItemKind, at: Point): string {
  const boardId = currentBoardId();
  if (kind === 'board') {
    // Number new boards so a fresh tree reads "Board 01, Board 02…".
    const siblings = Object.values(board().items).filter((i) => i.kind === 'board' && i.boardId === boardId);
    const n = siblings.length + 1;
    return board().addItem('board', { ...at, boardId, title: `Board ${String(n).padStart(2, '0')}`, color: randomBoardColor(siblings) });
  }
  return board().addItem(kind, { ...at, boardId });
}

/** Create an item centred-ish on a world point. Returns its id. */
export function createItem(kind: ItemKind, at: Point, { edit = true } = {}) {
  const id = addOnCurrentBoard(kind, at);
  const item = board().items[id];
  const p = snapPoint({ x: at.x - item.w / 2, y: at.y - 24 });
  board().updateItem(id, p);
  // Boards are named by the inspector rather than inline.
  ui().set({ selectedId: id, editingId: edit && kind !== 'board' ? id : null });
  return id;
}

/** Where the pointer holds an item spawned from the sidebar (world units from its top-left). */
export const SPAWN_GRIP = { x: 40, y: 20 };

/**
 * Drag a new item out of the sidebar: create it under the pointer and hand
 * the live pointer to its body once it has mounted.
 */
export function spawnAndDrag(
  kind: ItemKind, pointerId: number, clientX: number, clientY: number, onAttached?: () => void,
) {
  const at = camera.clientToWorld(clientX, clientY);
  const id = addOnCurrentBoard(kind, { x: at.x - SPAWN_GRIP.x, y: at.y - SPAWN_GRIP.y });
  // Selecting now would swap the sidebar to settings mid-drag; wait for the drop.
  spawningId = id;
  ui().set({ selectedId: null, editingId: null });
  window.addEventListener('pointerup', () => {
    spawningId = null;
    select(id);
    // A new column wants a name: start editing its title on drop.
    if (kind === 'column') ui().set({ editingId: id });
  }, { once: true });
  let tries = 0;
  const attach = () => {
    const body = bodies.get(id);
    if (body?.pos) {
      body.grab(pointerId, clientX, clientY, SPAWN_GRIP);
      onAttached?.();
    } else if (++tries < 10) requestAnimationFrame(attach);
    else onAttached?.();
  };
  requestAnimationFrame(attach);
}

export function deleteItem(id: string) {
  const item = board().items[id];
  if (!item) return;
  // Removing a shortcut to a shared board: don't re-add it on the next sync.
  if (item.kind === 'board' && item.linkTo) dismissShortcut(item.linkTo);
  // A deleted column leaves its notes where they were.
  const release = item.kind === 'column'
    ? Object.fromEntries(item.childIds.map((c) => [c, layout().slots[c]]).filter(([, p]) => p))
    : undefined;
  board().removeItem(id, release);
  ui().set({ selectedIds: ui().selectedIds.filter((x) => x !== id), editingId: null });
}

/** Delete, asking first when a board still has things on it. */
export function confirmDelete(id: string) {
  const item = board().items[id];
  if (item?.kind === 'board') {
    // Count everything that goes with it, including inside sub-boards.
    const inside = descendants(board().items, id).length;
    const name = item.title || 'Untitled board';
    if (inside && !window.confirm(`Delete "${name}" and everything in it (${inside} item${inside === 1 ? '' : 's'})?`)) return;
  }
  deleteItem(id);
}

// Bounds are read on every camera move, so cache until the content changes.
let boundsCache: { boardId: string; rect: Rect | null } | null = null;
useBoard.subscribe(() => { boundsCache = null; });
useLayout.subscribe(() => { boundsCache = null; });

/** World-space box around everything on a board, or null if it's empty. */
export function contentBounds(boardId = currentBoardId()): Rect | null {
  if (boundsCache?.boardId === boardId) return boundsCache.rect;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of Object.values(board().items)) {
    if (it.boardId !== boardId || parentOf(it) || !onCanvas(it)) continue;
    const { w, h } = itemSize(it);
    x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + w); y1 = Math.max(y1, it.y + h);
  }
  const rect = Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  boundsCache = { boardId, rect };
  return rect;
}

/** Zoom and centre the camera on everything on the board. */
export function zoomToFit() {
  const b = contentBounds();
  if (!b) {
    camera.centerOn(0, 0, 1, camera.width, camera.height);
    return;
  }
  const { x0, y0, x1, y1 } = b;
  const pad = 80;
  const z = Math.min(1, (camera.width - pad * 2) / (x1 - x0), (camera.height - pad * 2) / (y1 - y0));
  camera.centerOn((x0 + x1) / 2, (y0 + y1) / 2, z, camera.width, camera.height);
}

/** Open a board tile, or go up from the current board. */
export function enterBoard(id: string) {
  ui().set({ selectedId: null, editingId: null });
  openBoard(id);
}

const KIND_NOUN: Record<Exclude<ItemKind, 'comment'>, [string, string]> = {
  board: ['board', 'boards'],
  column: ['section', 'sections'],
  note: ['note', 'notes'],
  todo: ['to-do list', 'to-do lists'],
  link: ['link', 'links'],
  media: ['photo or video', 'photos and videos'],
};

/** "2 boards, 5 notes" — what's on a board, by kind. */
export function boardSummary(items: Record<string, Item>, boardId: string): string {
  const n: Record<ItemKind, number> = { board: 0, column: 0, note: 0, todo: 0, link: 0, media: 0, comment: 0 };
  for (const it of Object.values(items)) if (it.boardId === boardId) n[it.kind]++;
  const parts = (Object.keys(KIND_NOUN) as (keyof typeof KIND_NOUN)[])
    .filter((k) => n[k])
    .map((k) => `${n[k]} ${KIND_NOUN[k][n[k] === 1 ? 0 : 1]}`);
  return parts.join(', ') || 'Empty';
}

/** Delete everything selected (asking first if that includes boards with things on them). */
export function deleteSelection() {
  const { items } = board();
  const ids = ui().selectedIds.filter((id) => items[id] && id !== currentBoardId());
  if (ids.length === 1) { confirmDelete(ids[0]); return; }
  const inside = ids.reduce((n, id) => n + (items[id].kind === 'board' ? descendants(items, id).length : 0), 0);
  if (inside && !window.confirm(`Delete ${ids.length} items, including boards with ${inside} item${inside === 1 ? '' : 's'} in them?`)) return;
  for (const id of ids) deleteItem(id);
  clearSelection();
}

/**
 * Gather the selection into a new column, in reading order (top to bottom,
 * then left to right), and start editing its title.
 */
export function groupIntoColumn(ids = ui().selectedIds) {
  const { items } = board();
  const boardId = currentBoardId();
  const chosen = new Set(ids.filter((id) => items[id]?.boardId === boardId));
  // Something whose column is also chosen comes along inside that column.
  const insideChosen = (id: string) => {
    for (let p = parentOf(items[id]); p; p = parentOf(items[p])) if (chosen.has(p)) return true;
    return false;
  };
  const members = [...chosen].filter((id) => !insideChosen(id))
    .map((id) => ({ id, at: posOf(items[id]) }))
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  if (!members.length) return null;

  const x = Math.min(...members.map((m) => m.at.x));
  const y = Math.min(...members.map((m) => m.at.y));
  const col = board().addItem('column', { ...snapPoint({ x, y }), boardId });
  members.forEach((m, i) => board().moveToColumn(m.id, col, i));
  ui().set({ selectedIds: [col], editingId: col, contextMenu: null });
  return col;
}
