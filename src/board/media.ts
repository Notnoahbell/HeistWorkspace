// Adding photos, GIFs and videos: from the Upload button, a drop onto the
// canvas, or a paste. Each file becomes a media card straight away (with a
// local preview and progress), uploads to the server, then points at the
// uploaded copy so everyone sharing the board can see it.

import { create } from 'zustand';
import type { Point } from '../canvas/camera';
import { useBoard, type MediaMeta } from './store';
import { useUi } from './ui';
import { currentBoardId } from './nav';
import { snap } from './layout';
import { MEDIA_WIDTH, MEDIA_WIDTH_PORTRAIT } from './constants';

/** File types the server accepts (no SVG: it can carry script). */
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime';
const ACCEPTED = new Set(ACCEPT.split(','));
const GAP = 24;

/** Local-only: previews of files still uploading, and their progress (0–1). */
export const useLocalMedia = create<Record<string, { url: string; progress: number }>>()(() => ({}));

export const isMediaFile = (f: File) => ACCEPTED.has(f.type);

function readMeta(file: File, url: string): Promise<MediaMeta> {
  const base: MediaMeta = { mime: file.type, size: file.size };
  return new Promise((resolve) => {
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve({ ...base, width: v.videoWidth, height: v.videoHeight, duration: v.duration });
      v.onerror = () => resolve(base);
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => resolve({ ...base, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(base);
      img.src = url;
    }
  });
}

function send(id: string, file: File) {
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', '/api/upload');
  xhr.setRequestHeader('Content-Type', file.type);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    useLocalMedia.setState((s) => (s[id] ? { [id]: { ...s[id], progress: e.loaded / e.total } } : s));
  };
  const fail = () => useBoard.getState().updateItem(id, { upload: 'failed' });
  xhr.onerror = fail;
  xhr.onload = () => {
    let body: { url?: string } = {};
    try { body = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200 || !body.url) return fail();
    useBoard.getState().updateItem(id, { src: body.url, upload: undefined });
  };
  xhr.send(file);
}

/** Retry a failed upload, if this browser still has the file's preview. */
export async function retryUpload(id: string) {
  const local = useLocalMedia.getState()[id];
  if (!local) return;
  const blob = await fetch(local.url).then((r) => r.blob());
  const it = useBoard.getState().items[id];
  if (it?.kind !== 'media') return;
  useBoard.getState().updateItem(id, { upload: 'uploading' });
  send(id, new File([blob], it.name, { type: it.meta.mime ?? blob.type }));
}

/**
 * Add files as media cards starting at a world point, in a row. Returns how
 * many were accepted (others are skipped with a message).
 */
export async function addMediaFiles(files: File[], at: Point) {
  const ok = files.filter(isMediaFile);
  const skipped = files.length - ok.length;
  if (skipped) {
    useUi.getState().set({
      toast: { text: `${skipped} file${skipped === 1 ? '' : 's'} skipped — photos, GIFs and videos only (PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, MOV)`, at: Date.now() },
    });
  }
  if (!ok.length) return 0;

  const boardId = currentBoardId();
  const ids: string[] = [];
  let x = snap(at.x);
  for (const file of ok) {
    const url = URL.createObjectURL(file);
    const meta = await readMeta(file, url);
    const portrait = (meta.height ?? 0) > (meta.width ?? 1);
    const w = portrait ? MEDIA_WIDTH_PORTRAIT : MEDIA_WIDTH;
    const id = useBoard.getState().addItem('media', {
      boardId, x, y: snap(at.y), w,
      mediaType: file.type.startsWith('video/') ? 'video' : 'image',
      name: file.name, meta, upload: 'uploading',
    });
    useLocalMedia.setState({ [id]: { url, progress: 0 } });
    send(id, file);
    ids.push(id);
    x = snap(x + w + GAP);
  }
  useUi.getState().set({ selectedIds: ids, editingId: null });
  return ok.length;
}

// --- Caption text --------------------------------------------------------------

const fmtSize = (n?: number) =>
  n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

const fmtTime = (s?: number) => {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/** "MP4 · 0:42 · 1920×1080 · 12 MB" */
export function mediaSubtitle(meta: MediaMeta): string {
  const type = meta.mime?.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg').toUpperCase();
  const dims = meta.width && meta.height ? `${meta.width}×${meta.height}` : '';
  return [type, fmtTime(meta.duration), dims, fmtSize(meta.size)].filter(Boolean).join(' · ');
}
