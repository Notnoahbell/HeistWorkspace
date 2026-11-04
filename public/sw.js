// Image cache for uploads: posters, filmstrips and photos, cache-first. Uploads
// never change (each gets a new random name), so a saved copy never goes stale.
// Videos aren't handled here: browsers won't play video a service worker
// hands back in pieces, so the app keeps whole videos in Cache Storage itself
// and plays them from there (src/lib/mediaCache.ts).

const MEDIA = 'heist-media-v1';
const IMAGES = 'heist-images-v1';
const MAX_IMAGES = 600;
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([MEDIA, IMAGES]);
    for (const name of await caches.keys()) if (name.startsWith('heist-') && !keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/uploads/')) return;
  if (IMAGE_RE.test(url.pathname)) e.respondWith(image(req, url));
});

async function image(req, url) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200) {
    cache.put(url.pathname, res.clone()).then(() => trim(cache, MAX_IMAGES)).catch(() => {});
  }
  return res;
}

/** Oldest first out once there are too many. */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
