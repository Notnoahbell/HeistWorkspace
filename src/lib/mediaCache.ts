// Keeping uploaded videos on this device, so the second look is instant.
//
// `warm(src)` downloads a whole file once (with progress) into Cache Storage.
// After that, players get a blob: URL for the saved copy (`useCachedSrc`,
// `cachedUrl`): disk-backed, so it isn't read into memory, and it starts and
// seeks with no network at all. (A service worker can't do this part: browsers
// reject video it hands back in pieces. public/sw.js caches the images.)
// Uploads never change (each gets a new name), so nothing here goes stale.
// Least recently used files are dropped once the total passes MAX_TOTAL.
//
// Needs a secure origin (https or localhost); elsewhere it quietly does nothing.

import { useEffect, useState } from 'react';

const CACHE = 'heist-media-v1';
const INDEX_KEY = 'heist:media-cache';
/** Larger files stream instead (a 4K master isn't worth keeping whole). */
export const MAX_FILE = 400 * 1024 * 1024;
const MAX_TOTAL = 3 * 1024 * 1024 * 1024;

export const cacheable = () => typeof caches !== 'undefined' && window.isSecureContext;

export function registerMediaCache() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Ask not to be cleared under storage pressure (granted quietly or not at all).
  void navigator.storage?.persist?.().catch(() => {});
}

/** Same key as the service worker uses: the path. */
const keyOf = (src: string) => new URL(src, location.href).pathname;
const sameOrigin = (src: string) => { try { return new URL(src, location.href).origin === location.origin; } catch { return false; } };

type Index = Record<string, { size: number; used: number }>;
function readIndex(): Index {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}') as Index; } catch { return {}; }
}
function writeIndex(ix: Index) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch { /* fine */ } }
function touch(key: string, size?: number) {
  const ix = readIndex();
  ix[key] = { size: size ?? ix[key]?.size ?? 0, used: Date.now() };
  writeIndex(ix);
}

/** Drop the least recently used files until we're under the limit. */
async function evict(cache: Cache) {
  const ix = readIndex();
  let total = Object.values(ix).reduce((n, e) => n + e.size, 0);
  const oldest = Object.entries(ix).sort((a, b) => a[1].used - b[1].used);
  for (const [key, e] of oldest) {
    if (total <= MAX_TOTAL) break;
    await cache.delete(key);
    delete ix[key];
    total -= e.size;
  }
  writeIndex(ix);
}

export type Warmed = 'cached' | 'stream';

interface Job { progress: number; listeners: Set<(p: number) => void>; done: Promise<Warmed> }
const jobs = new Map<string, Job>();
const known = new Set<string>();

/** Whether a file is already kept here. */
export async function isCached(src: string): Promise<boolean> {
  if (!cacheable() || !src || !sameOrigin(src)) return false;
  const key = keyOf(src);
  if (known.has(key)) return true;
  try {
    const hit = await (await caches.open(CACHE)).match(key);
    if (hit) { known.add(key); touch(key); }
    return !!hit;
  } catch { return false; }
}

/**
 * Make sure a whole file is kept here. Resolves 'cached' when it is, or
 * 'stream' when it can't be (too big, no cache, or the download failed) —
 * then just play it from the network. Several callers share one download.
 */
export function warm(src: string, onProgress?: (p: number) => void): Promise<Warmed> {
  if (!cacheable() || !src || !sameOrigin(src) || src.startsWith('blob:')) { onProgress?.(1); return Promise.resolve('stream'); }
  const key = keyOf(src);
  let job = jobs.get(key);
  if (!job) {
    const listeners = new Set<(p: number) => void>();
    const j: Job = { progress: 0, listeners, done: Promise.resolve('stream') };
    const report = (p: number) => { j.progress = p; for (const l of listeners) l(p); };
    j.done = download(key, report).finally(() => { if (jobs.get(key) === j) jobs.delete(key); });
    jobs.set(key, j);
    job = j;
  }
  if (onProgress) { job.listeners.add(onProgress); onProgress(job.progress); }
  return job.done.then((r) => { onProgress?.(1); return r; });
}

/** At most this many downloads at once, so the first videos finish first. */
const PARALLEL = 4;
let running = 0;
const queue: (() => void)[] = [];
const slot = () => new Promise<void>((go) => { if (running < PARALLEL) { running++; go(); } else queue.push(() => { running++; go(); }); });
const free = () => { running--; queue.shift()?.(); };

async function download(key: string, report: (p: number) => void): Promise<Warmed> {
  if (await isCached(key)) { report(1); return 'cached'; }
  await slot();
  const ctrl = new AbortController();
  try {
    const res = await fetch(key, { signal: ctrl.signal });
    const size = Number(res.headers.get('content-length') ?? 0);
    if (res.status !== 200 || !res.body || size > MAX_FILE) { ctrl.abort(); report(1); return 'stream'; }
    const cache = await caches.open(CACHE);
    // One copy goes into the cache, the other is read here just to count progress.
    const [toCache, toCount] = res.body.tee();
    const saving = cache.put(key, new Response(toCache, { headers: res.headers }));
    const reader = toCount.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (size) report(Math.min(0.99, got / size));
    }
    await saving;
    known.add(key);
    touch(key, got);
    void evict(cache);
    report(1);
    return 'cached';
  } catch {
    report(1);
    return 'stream';
  } finally {
    free();
  }
}

/** blob: URLs for saved files, made once per file per session. */
const urls = new Map<string, string>();

/** A blob: URL playing the saved copy of `src`, or null if it isn't saved here. */
export async function cachedUrl(src: string): Promise<string | null> {
  if (!cacheable() || !src || !sameOrigin(src) || src.startsWith('blob:')) return null;
  const key = keyOf(src);
  const made = urls.get(key);
  if (made) return made;
  try {
    const hit = await (await caches.open(CACHE)).match(key);
    if (!hit) return null;
    const blob = await hit.blob();
    const type = hit.headers.get('content-type');
    const url = URL.createObjectURL(type && !blob.type ? blob.slice(0, blob.size, type) : blob);
    urls.set(key, url);
    known.add(key);
    touch(key);
    return url;
  } catch { return null; }
}

/**
 * `src`, or the saved copy of it when there is one. Decided when `src` is
 * first seen (not switched mid-play when a download finishes).
 */
export function useCachedSrc(src: string | undefined): string | undefined {
  const quick = src ? urls.get(keyOf(src)) : undefined;
  const [found, setFound] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!src || quick) return;
    let live = true;
    void cachedUrl(src).then((url) => { if (live && url) setFound({ src, url }); });
    return () => { live = false; };
  }, [src, quick]);
  if (!src) return src;
  return quick ?? (found?.src === src ? found.url : src);
}
