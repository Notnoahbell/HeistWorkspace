// Downloading photos and videos off the board, to the browser's Downloads folder.
//
// Each file is fetched here (so its progress can be shown in the Downloads panel,
// ui/Downloads.tsx), then handed to the browser to save under its card's name. Two
// at a time; the rest wait their turn. A copy kept on this device is used when
// there is one (instant). Downloads go on in the background while you work.

import { create } from 'zustand';
import { useBoard, type Media } from './store';
import { columnContents } from './store';
import { versionInfo, versionOf } from './versions';
import { cachedUrl } from '../lib/mediaCache';

const PARALLEL = 2;

export type DownloadStatus = 'queued' | 'downloading' | 'saving' | 'done' | 'failed' | 'cancelled';
export interface Download {
  id: string;
  name: string;
  src: string;
  kind: 'image' | 'video';
  status: DownloadStatus;
  /** Bytes so far, and in all (0 when the server doesn't say). */
  got: number;
  total: number;
  error?: string;
}

interface DownloadsState {
  list: Download[];
  /** Panel shown (it closes itself a while after everything has finished). */
  open: boolean;
}
export const useDownloads = create<DownloadsState>()(() => ({ list: [], open: false }));

const controllers = new Map<string, AbortController>();
let seq = 0;

function patch(id: string, p: Partial<Download>) {
  useDownloads.setState((s) => ({ list: s.list.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
}

/** The file name to save as: the card's name, with the file's own extension. */
function fileName(name: string, src: string) {
  const ext = src.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const base = (name || 'Untitled').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 150) || 'Untitled';
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base.replace(/\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i, '')}.${ext}` : base;
}

/** Photos and videos among these items, and inside any selected sections. */
export function downloadableIn(ids: string[]): Media[] {
  const { items } = useBoard.getState();
  const seen = new Set<string>();
  const out: Media[] = [];
  const add = (id: string) => {
    const it = items[id];
    if (!it || seen.has(id)) return;
    seen.add(id);
    if (it.kind === 'media' && it.src && !it.upload) out.push(it);
    if (it.kind === 'column') for (const c of columnContents(items, id)) add(c);
  };
  ids.forEach(add);
  return out;
}

/** Queue these items' photos and videos for download (the version on show, in full). */
export function downloadItems(ids: string[]) {
  const media = downloadableIn(ids);
  if (!media.length) return 0;
  const added: Download[] = media.map((m) => {
    const v = versionInfo(m, versionOf(m));
    return { id: `dl${++seq}`, name: fileName(v.name || m.name, v.src), src: v.src, kind: m.mediaType, status: 'queued', got: 0, total: v.meta.size ?? 0 };
  });
  useDownloads.setState((s) => ({ list: [...s.list.filter((d) => d.status !== 'done' && d.status !== 'cancelled'), ...added], open: true }));
  pump();
  return added.length;
}

export function cancelDownload(id: string) {
  controllers.get(id)?.abort();
  patch(id, { status: 'cancelled' });
  pump();
}
export function retryDownload(id: string) {
  patch(id, { status: 'queued', got: 0, error: undefined });
  pump();
}
export function clearFinished() {
  useDownloads.setState((s) => {
    const list = s.list.filter((d) => d.status === 'queued' || d.status === 'downloading' || d.status === 'saving');
    return { list, open: list.length > 0 };
  });
}
export const closeDownloads = () => useDownloads.setState({ open: false });

/** Start queued downloads while there's room. */
function pump() {
  const { list } = useDownloads.getState();
  let running = list.filter((d) => d.status === 'downloading' || d.status === 'saving').length;
  for (const d of list) {
    if (running >= PARALLEL) break;
    if (d.status !== 'queued') continue;
    running++;
    void run(d);
  }
}

async function run(d: Download) {
  const ctrl = new AbortController();
  controllers.set(d.id, ctrl);
  patch(d.id, { status: 'downloading' });
  try {
    // A copy kept on this device, else the server.
    const res = await fetch((await cachedUrl(d.src)) ?? d.src, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`Server said ${res.status}`);
    const total = Number(res.headers.get('content-length')) || d.total;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      // Progress a few times a second, not per chunk.
      if (performance.now() - last > 120) { last = performance.now(); patch(d.id, { got, total }); }
    }
    patch(d.id, { got, total: total || got, status: 'saving' });
    const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
    save(blob, d.name);
    patch(d.id, { status: 'done' });
  } catch (e) {
    if (ctrl.signal.aborted) return;
    patch(d.id, { status: 'failed', error: (e as Error).message || 'Download failed' });
  } finally {
    controllers.delete(d.id);
    pump();
    closeWhenIdle();
  }
}

/** Hand a file to the browser to save in Downloads. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start saving before letting go of it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A few seconds after everything has finished (and nothing failed), tidy up and close. */
let idleTimer = 0;
function closeWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    const { list } = useDownloads.getState();
    if (list.some((d) => d.status === 'queued' || d.status === 'downloading' || d.status === 'saving' || d.status === 'failed')) return;
    useDownloads.setState({ open: false });
  }, 4000);
}
