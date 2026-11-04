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
import { addVersion } from './versions';
import { withIdentity } from '../sync/client';

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

/** Send a file to the server; resolves with where it lives (or null if it failed). */
function uploadFile(file: File, onProgress: (p: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    // Who's uploading and the original name go along, for the admin file manager.
    const url = withIdentity(new URL('/api/upload', location.href));
    url.searchParams.set('name', file.name);
    xhr.open('PUT', url.pathname + url.search);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => resolve(null);
    xhr.onload = () => {
      let body: { url?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      resolve(xhr.status === 200 && body.url ? body.url : null);
    };
    xhr.send(file);
  });
}

async function send(id: string, file: File) {
  const url = await uploadFile(file, (progress) =>
    useLocalMedia.setState((s) => (s[id] ? { [id]: { ...s[id], progress } } : s)));
  if (!url) { useBoard.getState().updateItem(id, { upload: 'failed' }); return; }
  useBoard.getState().updateItem(id, { src: url, upload: undefined });
  const it = useBoard.getState().items[id];
  if (it?.kind === 'media' && it.mediaType === 'video') ensureDerived(url, it.meta);
}

/** Local-only: a new version uploading onto a card (by card id), and how far along (0–1). */
export const useVersionUploads = create<Record<string, { name: string; progress: number }>>()(() => ({}));

/**
 * A video file dropped onto a video card: upload it, then make it the card's
 * newest version. The card shows the progress meanwhile.
 */
export async function addVersionFile(id: string, file: File) {
  if (!file.type.startsWith('video/') || !isMediaFile(file)) return;
  const local = URL.createObjectURL(file);
  const meta = await readMeta(file, local);
  const done = () => useVersionUploads.setState((s) => { const next = { ...s }; delete next[id]; return next; }, true);
  useVersionUploads.setState({ [id]: { name: file.name, progress: 0 } });
  const url = await uploadFile(file, (progress) => useVersionUploads.setState((s) => (s[id] ? { [id]: { ...s[id], progress } } : s)));
  done();
  if (!url) {
    URL.revokeObjectURL(local);
    useUi.getState().set({ toast: { text: `Couldn't upload ${file.name}`, at: Date.now() } });
    return;
  }
  const n = addVersion(id, { src: url, name: file.name, meta });
  if (!n) return;
  useLocalMedia.setState({ [id]: { url: local, progress: 1 } }); // play the local copy straight away
  ensureDerived(url, meta);
  useUi.getState().set({ selectedIds: [id], toast: { text: `${file.name} added as v${n}`, at: Date.now() } });
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

export const fmtSize = (n?: number) =>
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

// --- What the server works out from a video (frame rate, poster, filmstrip, proxy) ----

interface Derived {
  status: 'ready' | 'working' | 'unavailable';
  fps?: number; duration?: number; width?: number; height?: number;
  poster?: string; strip?: MediaMeta['strip']; proxy?: string | 'pending' | null;
}

/** Asked about (or being polled) this session. */
const deriving = new Set<string>();
const POLL_MS = 3000;

/** Put derived details on whichever card (or earlier version) has this file. */
function applyDerived(src: string, d: Derived) {
  const meta: Partial<MediaMeta> = {
    derived: d.status === 'ready' ? 'done' : d.status,
    ...(d.fps ? { fps: d.fps } : {}),
    ...(d.duration ? { duration: d.duration } : {}),
    ...(d.poster ? { poster: d.poster } : {}),
    ...(d.strip ? { strip: d.strip } : {}),
    ...(d.proxy !== undefined ? { proxy: d.proxy } : {}),
  };
  const { items, updateItem } = useBoard.getState();
  for (const it of Object.values(items)) {
    if (it.kind !== 'media') continue;
    if (it.src === src) updateItem(it.id, { meta: { ...it.meta, ...meta } });
    const versions = it.versions;
    if (versions?.some((v) => v.src === src)) {
      updateItem(it.id, { versions: versions.map((v) => (v.src === src ? { ...v, meta: { ...v.meta, ...meta } } : v)) });
    }
  }
}

/**
 * Make sure the server has looked at this video (once per file; whoever is
 * looking at it asks, so older uploads catch up too), and keep asking while
 * a proxy is being made.
 */
export function ensureDerived(src: string, meta: MediaMeta | undefined) {
  if (!src.startsWith('/uploads/') || deriving.has(src)) return;
  if (meta?.derived === 'done' || meta?.derived === 'unavailable') return;
  deriving.add(src);
  const ask = async () => {
    try {
      const r = await fetch(`/api/derive?src=${encodeURIComponent(src)}`);
      if (!r.ok) return;
      const d = (await r.json()) as Derived;
      applyDerived(src, d);
      if (d.status === 'working') setTimeout(ask, POLL_MS);
    } catch {
      setTimeout(() => deriving.delete(src), POLL_MS * 10); // try again later
    }
  };
  void ask();
}

/**
 * The file to play: the proxy once there is one (even over a fresh upload's
 * local copy, which the browser may not be able to play, e.g. ProRes), else
 * the local copy, else the original.
 */
export const playable = (src: string, meta: MediaMeta | undefined, local?: string) =>
  meta?.proxy && meta.proxy !== 'pending' ? meta.proxy : local || src;
