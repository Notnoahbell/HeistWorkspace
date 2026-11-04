// Versions of a video. Dropping one video card onto another makes it the new
// version (v2, v3…): the target keeps its place, comments and history, and the
// earlier file is kept in `versions`. Comments belong to the version they were
// made on.

import { stackZ, useBoard, type Comment, type Item, type Media, type MediaMeta } from './store';
import { session } from '../session';
import { itemSize, posOf } from './actions';
import { useLocalMedia } from './media';
import type { Point } from '../canvas/camera';

/** The current version's number (1 with no history). */
export const versionOf = (m: Media) => (m.versions?.length ?? 0) + 1;

/** Which version a comment is on. */
export const commentVersion = (c: Comment) => c.version ?? 1;

/** Only the comments on one version (or all, for null). */
export const forVersion = (list: Comment[], version: number | null) =>
  version == null ? list : list.filter((c) => commentVersion(c) === version);

/** Can this item be stacked as / onto a video version? */
export const isVideo = (it: Item | undefined): it is Media => it?.kind === 'media' && it.mediaType === 'video';

export interface VersionInfo {
  n: number;
  src: string;
  name: string;
  meta: MediaMeta;
  addedAt: number | null;
  addedBy: string | null;
  current: boolean;
}

/** Every version of a video, newest first. */
export function versionList(m: Media): VersionInfo[] {
  const old = (m.versions ?? []).map((v, i) => ({
    n: i + 1, src: v.src, name: v.name, meta: v.meta, addedAt: v.addedAt, addedBy: v.addedBy ?? null, current: false,
  }));
  const cur = {
    n: versionOf(m), src: m.src, name: m.name, meta: m.meta,
    addedAt: m.versionAt ?? null, addedBy: m.versionBy ?? null, current: true,
  };
  return [cur, ...old.reverse()];
}

/** One version of a video (falls back to the current one). */
export function versionInfo(m: Media, n: number): VersionInfo {
  const all = versionList(m);
  return all.find((v) => v.n === n) ?? all[0];
}

/** Video card under the pointer that a dragged video could be stacked onto. */
export function videoTargetAt(p: Point, boardId: string, exclude: Set<string>): string | null {
  const { items } = useBoard.getState();
  let hit: string | null = null;
  let hitZ = -Infinity;
  for (const it of Object.values(items)) {
    if (!isVideo(it) || !it.src || it.boardId !== boardId || exclude.has(it.id)) continue;
    const o = posOf(it);
    const { w, h } = itemSize(it);
    if (p.x < o.x || p.x > o.x + w || p.y < o.y || p.y > o.y + h) continue;
    const z = stackZ(items, it.id);
    if (z > hitZ) { hit = it.id; hitZ = z; }
  }
  return hit;
}

/**
 * Stack video `fromId` onto `ontoId` as its newest version. The target's
 * current file joins its history, then the dragged card's own history, then
 * the dragged file becomes current; the dragged card's comments move across
 * (renumbered to match) and the card goes. Returns the new version number.
 */
export function stackVersion(fromId: string, ontoId: string): number | null {
  const { items, updateItem, removeItem } = useBoard.getState();
  const from = items[fromId];
  const onto = items[ontoId];
  if (!isVideo(from) || !isVideo(onto) || !from.src || !onto.src || fromId === ontoId) return null;

  const now = Date.now();
  const offset = versionOf(onto); // the dragged card's v1 lands right after the target's current
  const history = [
    ...(onto.versions ?? []),
    { src: onto.src, name: onto.name, meta: onto.meta, addedAt: onto.versionAt ?? 0, addedBy: onto.versionBy ?? null },
    ...(from.versions ?? []),
  ];
  for (const it of Object.values(items)) {
    if (it.kind === 'comment' && it.targetId === fromId) {
      updateItem(it.id, { targetId: ontoId, boardId: onto.boardId, version: offset + commentVersion(it) });
    }
  }
  updateItem(ontoId, {
    versions: history, src: from.src, name: from.name, meta: from.meta,
    versionAt: now, versionBy: session.userId,
  });
  // A card shows its local copy of a fresh upload; the target now shows the dragged one's (or the stored file).
  useLocalMedia.setState((s) => {
    const next = { ...s };
    if (s[fromId]) next[ontoId] = s[fromId]; else delete next[ontoId];
    delete next[fromId];
    return next;
  }, true);
  removeItem(fromId);
  return history.length + 1;
}
