// Board document store. Every mutation goes through these actions as small,
// serialisable patches so they can later be mapped onto a Yjs document for
// sync, offline and undo/redo. Positions are always in world coordinates.
//
// Items from every board live in one flat map, tagged with the board they
// belong to. A board is itself an item (its tile on the parent board); the
// root of each user's tree is their Home, which is not an item.

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { newId } from '../lib/id';
import type { Point } from '../canvas/camera';
import { homeId } from '../session';
import { BOARD_WIDTH, COLUMN_WIDTH, MEDIA_WIDTH, NOTE_WIDTH } from './constants';

interface ItemBase {
  id: string;
  /** Board this item sits on. */
  boardId: string;
  x: number;
  y: number;
  w: number;
  /** Stacking order among top-level items. */
  z: number;
}

export type TextSize = 'sm' | 'md' | 'lg';
export type TextAlign = 'left' | 'center' | 'right';

interface Stacked {
  /** Column this item is stacked in; x/y are ignored while set. */
  parentId: string | null;
}

export interface Note extends ItemBase, Stacked {
  kind: 'note';
  /** Background. null = theme default. */
  color: string | null;
  text: string;
  textSize: TextSize;
  textAlign: TextAlign;
  bold: boolean;
}

export interface TodoEntry {
  id: string;
  text: string;
  done: boolean;
}

/** A note that is a checklist. */
export interface Todo extends ItemBase, Stacked {
  kind: 'todo';
  color: string | null;
  entries: TodoEntry[];
}

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  /** The preview service couldn't read the page. */
  failed?: boolean;
}

export interface Link extends ItemBase, Stacked {
  kind: 'link';
  color: string | null;
  url: string;
  /** null = not fetched yet. */
  preview: LinkPreview | null;
}

/** Facts about an uploaded file, for the caption and layout. */
export interface MediaMeta {
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  /** Seconds (videos). */
  duration?: number;
  /** Videos, worked out by the server (see server/derive.ts): */
  /** Real frame rate (e.g. 23.976, 25, 29.97). */
  fps?: number;
  /** A still to show before it plays. */
  poster?: string;
  /** Evenly spaced frames side by side in one image, for hover-scrub. */
  strip?: { url: string; frames: number; w: number; h: number };
  /** A browser-friendly copy to play instead of the original; 'pending' while it's made. */
  proxy?: string | 'pending' | null;
  /** 'done' once the server has looked at it ('unavailable' without ffmpeg). */
  derived?: 'working' | 'done' | 'unavailable';
}

/** An earlier version of a video (stacked over by a newer one). */
export interface MediaVersion {
  src: string;
  name: string;
  meta: MediaMeta;
  /** When it became the current version, and who added it. */
  addedAt: number;
  addedBy?: string | null;
  /** A name for the version ("Client cut"), and where its review stands. */
  label?: string | null;
  status?: ReviewStatus | null;
}

/** A mark drawn on a video frame: pen stroke, arrow or box. Coordinates are 0–1 across/down the picture. */
export interface Shape { k: 'pen' | 'arrow' | 'box'; c: string; p: number[] }

/** Where the review of a version stands. */
export type ReviewStatus = 'review' | 'changes' | 'approved';

/** A photo, GIF or video. */
export interface Media extends ItemBase, Stacked {
  kind: 'media';
  mediaType: 'image' | 'video';
  /** Where the file lives once uploaded ('' while uploading). */
  src: string;
  /** Shown under the media; the filename to begin with. */
  name: string;
  meta: MediaMeta;
  /** Name/subtitle tucked away behind an arrow. */
  captionHidden: boolean;
  /** Set while the upload is in progress, or if it failed. */
  upload?: 'uploading' | 'failed';
  /** Earlier versions, oldest (v1) first; the item itself is the newest. */
  versions?: MediaVersion[];
  /** When the current version was added, and who added it (once there are versions). */
  versionAt?: number | null;
  versionBy?: string | null;
  /** The current version's name and review status (earlier ones keep theirs in `versions`). */
  versionLabel?: string | null;
  status?: ReviewStatus | null;
}

/** Before v5: sections stacked one way or the other. Read only to migrate. */
export type ColumnDirection = 'vertical' | 'horizontal';

/** A section: lays items out in a grid (1 column = a plain column); sections nest. */
export interface Column extends ItemBase, Stacked {
  kind: 'column';
  title: string;
  color: string | null;
  /** Coloured strip along the top edge. null = no strip. */
  strip: string | null;
  /** Grid columns; 1 stacks items top to bottom. */
  cols: number;
  /** @deprecated v4 and older; see gridCols(). */
  direction?: ColumnDirection;
  childIds: string[];
}

export interface Board extends ItemBase, Stacked {
  kind: 'board';
  title: string;
  color: string | null;
  /** Lucide icon name, see lib/icons. */
  icon: string | null;
  /** User ids this board (and everything in it) is shared with. Owner only. */
  sharedWith?: string[];
  /**
   * A shortcut: this tile stands for another board (e.g. one shared with you,
   * placed on your Home). Its own title/colour/icon are unused.
   */
  linkTo?: string;
}

/**
 * A comment on a note, to-do, link, photo or video. Stored as an item (so it
 * syncs and is shared like everything else) on the same board as its target,
 * but never drawn on the canvas itself.
 */
export interface Comment extends ItemBase, Stacked {
  kind: 'comment';
  targetId: string;
  authorId: string;
  /** Name when written; the current profile name wins when known. */
  authorName: string;
  text: string;
  createdAt: number;
  /** Seconds into a video, or null for the item as a whole. */
  time: number | null;
  /** The thread's first comment, for a reply (replies have no time and aren't resolved on their own). */
  replyTo?: string | null;
  /** User ids @mentioned in the text. */
  mentions?: string[];
  /** From when comments could be resolved; no longer used (every comment shows). */
  resolved: boolean;
  resolvedBy?: string | null;
  resolvedAt?: number | null;
  /** When the author last changed the text. */
  editedAt?: number | null;
  /** Which version of a video it's on (1 if unset). */
  version?: number;
  /** A range rather than a moment: where it ends (seconds). */
  timeEnd?: number | null;
  /** Marks drawn on the frame at `time`. */
  drawing?: Shape[];
  /** Emoji → ids of the people who reacted with it. */
  reactions?: Record<string, string[]>;
}

/** Things drawn on the canvas (everything but comments). */
export const onCanvas = (it: Item) => it.kind !== 'comment';
/** Kinds people can comment on. */
export const COMMENTABLE = new Set<ItemKind>(['note', 'todo', 'link', 'media']);

/** The board a tile opens: itself, or what it's a shortcut to. */
export const boardTarget = (b: Board) => b.linkTo ?? b.id;

export type Item = Note | Todo | Link | Media | Column | Board | Comment;
/** Items that can be stacked in a column (everything, columns included). */
export type Stackable = Item;
export const isStackable = (it: Item | undefined): it is Stackable => !!it;
/** Column the item is stacked in, if any (older boards have no parentId field). */
export const parentOf = (it: Item | undefined): string | null =>
  (isStackable(it) && it.parentId) || null;
export type ItemKind = Item['kind'];
type ItemOf<K extends ItemKind> = Extract<Item, { kind: K }>;
export type NewItem<K extends ItemKind> = Partial<Omit<ItemOf<K>, 'id' | 'kind' | 'z'>> & Point & { boardId: string };

type ItemPatch = { [K in ItemKind]: Partial<Omit<ItemOf<K>, 'id' | 'kind'>> }[ItemKind];

interface BoardState {
  items: Record<string, Item>;
  topZ: number;
  addItem: <K extends ItemKind>(kind: K, init: NewItem<K>) => string;
  updateItem: (id: string, patch: ItemPatch) => void;
  /**
   * Removes an item. A column's notes are released onto the board at
   * `release` positions; a board takes everything inside it with it.
   */
  removeItem: (id: string, release?: Record<string, Point>) => void;
  bringToFront: (id: string) => void;
  /** Stack an item into a column at `index`. */
  moveToColumn: (id: string, columnId: string, index: number) => void;
  /** Take a stacked item out of its column and put it on the board at `at`. */
  detach: (id: string, at: Point) => void;
  /** Add fully-formed items (e.g. pasted copies), stacking them on top. */
  insertItems: (items: Item[]) => void;
  /**
   * Move items (with their column contents) onto another board, placing
   * each top-level one at `at[id]`. Refuses to move a board into itself.
   */
  moveToBoard: (ids: string[], boardId: string, at: Record<string, Point>) => void;
}

const DEFAULTS: { [K in ItemKind]: Omit<ItemOf<K>, 'id' | 'kind' | 'z' | 'x' | 'y' | 'boardId'> } = {
  note: {
    w: NOTE_WIDTH, color: null, text: '', parentId: null,
    textSize: 'md', textAlign: 'left', bold: false,
  },
  todo: { w: NOTE_WIDTH, color: null, entries: [], parentId: null },
  link: { w: NOTE_WIDTH, color: null, url: '', preview: null, parentId: null },
  media: { w: MEDIA_WIDTH, mediaType: 'image', src: '', name: '', meta: {}, captionHidden: false, parentId: null },
  comment: { w: 0, parentId: null, targetId: '', authorId: '', authorName: '', text: '', createdAt: 0, time: null, resolved: false },
  column: { w: COLUMN_WIDTH, title: '', color: null, strip: null, cols: 1, childIds: [], parentId: null },
  board: { w: BOARD_WIDTH, title: '', color: null, icon: null, parentId: null },
};

// localStorage can throw (private mode, blocked storage); never let that break the board.
const safeStorage: StateStorage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch {} },
};

/** Returns items with `id` removed from its parent column's childIds. */
function unparent(items: Record<string, Item>, id: string): Record<string, Item> {
  const parentId = parentOf(items[id]);
  if (!parentId) return items;
  const col = items[parentId];
  if (col?.kind !== 'column') return items;
  return { ...items, [col.id]: { ...col, childIds: col.childIds.filter((c) => c !== id) } };
}

/** Everything stacked inside a column, at any depth. */
export function columnContents(items: Record<string, Item>, columnId: string): string[] {
  const out: string[] = [];
  const queue = [columnId];
  while (queue.length) {
    const col = items[queue.pop()!];
    if (col?.kind !== 'column') continue;
    for (const c of col.childIds) {
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** How many columns deep an item is stacked (0 = on the board). */
export function stackDepth(items: Record<string, Item>, id: string): number {
  let depth = 0;
  for (let p = parentOf(items[id]); p && items[p] && depth < 32; p = parentOf(items[p])) depth++;
  return depth;
}

/**
 * Surface tone for something stacked in a column: alternates by depth so a
 * card always contrasts with the column it sits in. undefined = not stacked.
 */
export const stackTone = (depth: number): 'odd' | 'even' | undefined =>
  depth === 0 ? undefined : depth % 2 ? 'odd' : 'even';

/**
 * CSS z-index for an item: top-level items by their z, and anything stacked
 * just above the column holding it (deeper = higher), all within the band of
 * its outermost column.
 */
export function stackZ(items: Record<string, Item>, id: string): number {
  let depth = 0;
  let root = items[id];
  for (let p = parentOf(root); p && items[p] && depth < 32; p = parentOf(items[p])) {
    root = items[p];
    depth++;
  }
  return (root?.z ?? 0) * 64 + depth;
}

/** All ids on a board and, recursively, on its sub-boards. */
export function descendants(items: Record<string, Item>, boardId: string): string[] {
  const out: string[] = [];
  const queue = [boardId];
  while (queue.length) {
    const b = queue.pop()!;
    for (const it of Object.values(items)) {
      if (it.boardId !== b) continue;
      out.push(it.id);
      if (it.kind === 'board') queue.push(it.id);
    }
  }
  return out;
}

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => ({
      items: {},
      topZ: 0,

      addItem(kind, init) {
        const id = newId();
        const z = get().topZ + 1;
        const item = { ...DEFAULTS[kind], ...init, id, kind, z } as unknown as Item;
        set((s) => ({ items: { ...s.items, [id]: item }, topZ: z }));
        return id;
      },

      updateItem(id, patch) {
        set((s) => {
          const item = s.items[id];
          if (!item) return s;
          return { items: { ...s.items, [id]: { ...item, ...patch } as Item } };
        });
      },

      removeItem(id, release = {}) {
        set((s) => {
          const item = s.items[id];
          if (!item) return s;
          let items = { ...unparent(s.items, id) };
          let topZ = s.topZ;
          if (item.kind === 'column') {
            for (const cid of item.childIds) {
              const c = items[cid];
              if (!isStackable(c)) continue;
              const at = release[cid] ?? { x: item.x, y: item.y };
              items[cid] = { ...c, parentId: null, x: at.x, y: at.y, z: ++topZ };
            }
          }
          if (item.kind === 'board') {
            for (const d of descendants(items, id)) delete items[d];
          }
          // Its comments go with it.
          for (const it of Object.values(items)) if (it.kind === 'comment' && it.targetId === id) delete items[it.id];
          delete items[id];
          return { items, topZ };
        });
      },

      bringToFront(id) {
        const { items, topZ } = get();
        const item = items[id];
        if (!item) return;
        // A stacked item rises with its column.
        const parentId = parentOf(item);
        const target = parentId ? items[parentId] : item;
        if (!target || target.z === topZ) return;
        set({ items: { ...items, [target.id]: { ...target, z: topZ + 1 } }, topZ: topZ + 1 });
      },

      moveToColumn(id, columnId, index) {
        set((s) => {
          // A column can't go inside itself or anything inside it.
          for (let c: string | null = columnId; c; c = parentOf(s.items[c])) if (c === id) return s;
          const items = unparent(s.items, id);
          const note = items[id];
          const col = items[columnId];
          if (!isStackable(note) || col?.kind !== 'column') return s;
          const childIds = col.childIds.filter((c) => c !== id);
          childIds.splice(Math.min(index, childIds.length), 0, id);
          return {
            items: {
              ...items,
              [columnId]: { ...col, childIds },
              [id]: { ...note, parentId: columnId, boardId: col.boardId },
            },
          };
        });
      },

      insertItems(list) {
        set((s) => {
          const items = { ...s.items };
          let topZ = s.topZ;
          for (const it of list) items[it.id] = { ...it, z: ++topZ } as Item;
          return { items, topZ };
        });
      },

      moveToBoard(ids, boardId, at) {
        set((s) => {
          // A board can't go inside itself or anything inside it.
          for (let b: string | undefined = boardId; b; b = s.items[b]?.boardId) if (ids.includes(b)) return s;
          let items = { ...s.items };
          let topZ = s.topZ;
          for (const id of ids) {
            const it = items[id];
            if (!it) continue;
            items = unparent(items, id);
            const p = at[id] ?? { x: 0, y: 0 };
            items[id] = { ...items[id], boardId, parentId: null, x: p.x, y: p.y, z: ++topZ } as Item;
            // A column's contents come along (boards keep their own contents).
            for (const c of columnContents(items, id)) items[c] = { ...items[c], boardId } as Item;
          }
          // Comments stay on the same board as what they're about.
          for (const it of Object.values(items)) {
            if (it.kind === 'comment' && items[it.targetId] && items[it.targetId].boardId !== it.boardId) {
              items[it.id] = { ...it, boardId: items[it.targetId].boardId };
            }
          }
          return { items, topZ };
        });
      },

      detach(id, at) {
        set((s) => {
          const items = unparent(s.items, id);
          const note = items[id];
          if (!isStackable(note)) return s;
          const z = s.topZ + 1;
          return { items: { ...items, [id]: { ...note, parentId: null, x: at.x, y: at.y, z } }, topZ: z };
        });
      },
    }),
    {
      name: 'heist:board:local-default',
      version: 5,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ items: s.items, topZ: s.topZ }),
      migrate: (persisted, version) => {
        type Stored = { items: Record<string, Item>; topZ: number };
        type Loose = Record<string, unknown> & { id: string; kind: string };
        let state = persisted as Stored & { cards?: Record<string, Loose> };
        // v0 stored text cards as `cards`.
        if (version === 0 && state.cards) {
          const items: Record<string, Item> = {};
          for (const c of Object.values(state.cards)) items[c.id] = { ...c, kind: 'comment', parentId: null } as never;
          state = { items, topZ: state.topZ ?? 0 };
        }
        // v1 had a single board; everything moves into the user's Home.
        if (version < 2) {
          for (const it of Object.values(state.items ?? {})) (it as unknown as Loose).boardId = homeId();
        }
        // v3: "comments" are now notes, and strips moved from notes to columns.
        if (version < 3) {
          const items: Record<string, Item> = {};
          for (const raw of Object.values(state.items ?? {}) as unknown as Loose[]) {
            if (raw.kind === 'comment') {
              const { strip: _strip, ...rest } = raw;
              items[raw.id] = { ...DEFAULTS.note, ...rest, kind: 'note' } as Note;
            } else if (raw.kind === 'column') {
              items[raw.id] = { ...DEFAULTS.column, ...raw } as unknown as Column;
            } else {
              items[raw.id] = { parentId: null, ...raw } as unknown as Item;
            }
          }
          state = { items, topZ: state.topZ ?? 0 };
        }
        // v4: columns can nest and have a direction.
        if (version < 4) {
          for (const it of Object.values(state.items ?? {})) {
            if (it.kind === 'column') Object.assign(it, { parentId: it.parentId ?? null, direction: it.direction ?? 'vertical' });
          }
        }
        // v5: direction becomes a grid column count (horizontal = one row).
        if (version < 5) {
          for (const it of Object.values(state.items ?? {})) {
            if (it.kind !== 'column') continue;
            it.cols = it.direction === 'horizontal' ? Math.max(1, it.childIds.length) : 1;
            delete it.direction;
          }
        }
        return state;
      },
    },
  ),
);
