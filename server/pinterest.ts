// Pinterest links pasted onto a board come in as the pin itself, not a link:
// its video, GIF or full-size image.
//
//   GET /api/pinterest?url=<pin or pin.it link>  → { kind: 'video' | 'gif' | 'image', src, name, width?, height? }
//   GET /api/pinterest/file?src=<pinimg.com URL> → the file (browsers can't fetch it themselves)
//
// The pin's details come from Pinterest's public pin-info endpoint (what their
// embed widgets use). Only Pinterest's own hosts are ever fetched.

import type { IncomingMessage, ServerResponse } from 'node:http';

const TIMEOUT_MS = 15_000;
const MAX_FILE = 300 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; HeistWorkspace/0.1)';
/** pinterest.com, pinterest.co.uk, …, and pin.it short links. */
const PIN_HOST = /(^|\.)pinterest\.[a-z.]{2,8}$|^pin\.it$/i;
const MEDIA_HOST = /^(i|v\d*)\.pinimg\.com$/i;

export const isPinterestUrl = (raw: string) => {
  try { return PIN_HOST.test(new URL(raw).hostname); } catch { return false; }
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

/** The pin's id, following a pin.it short link (only through Pinterest's own hosts). */
async function pinId(raw: string): Promise<string | null> {
  let url = new URL(raw);
  for (let hop = 0; hop < 6; hop++) {
    const m = /\/pin\/(?:[^/]*--)?(\d{5,})/.exec(url.pathname);
    if (m) return m[1];
    if (!PIN_HOST.test(url.hostname) && !/(^|\.)pinterest\.com$/i.test(url.hostname)) return null;
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const next = res.headers.get('location');
    if (!next) return null;
    url = new URL(next, url);
  }
  return null;
}

type Found = { kind: 'video' | 'gif' | 'image'; src: string; width?: number; height?: number };

/** The best thing to import from a pin's details. */
function pick(pin: Record<string, unknown>): Found | null {
  const text = JSON.stringify(pin);
  // Video: a plain MP4 (not the HLS stream), the 720p one if there's a choice.
  const mp4s = [...new Set(text.match(/https:\/\/v\d*\.pinimg\.com\/videos\/[^"]+?\.mp4/g) ?? [])];
  if (mp4s.length) {
    const list = (pin.videos as { video_list?: Record<string, { url: string; width?: number; height?: number }> } | null)?.video_list ?? {};
    const v = Object.values(list).find((x) => x.url === (mp4s.find((u) => /720/.test(u)) ?? mp4s[0]));
    return { kind: 'video', src: mp4s.find((u) => /720/.test(u)) ?? mp4s[0], width: v?.width, height: v?.height };
  }
  const embed = pin.embed as { type?: string; src?: string; width?: number; height?: number } | null;
  if (embed?.type === 'gif' && embed.src) return { kind: 'gif', src: embed.src, width: embed.width, height: embed.height };
  // Image: the original if Pinterest lists one, else the biggest size there is.
  const originals = text.match(/https:\/\/i\.pinimg\.com\/originals\/[^"]+?\.(?:jpe?g|png|webp|gif)/);
  if (originals) return { kind: originals[0].endsWith('.gif') ? 'gif' : 'image', src: originals[0] };
  const images = (pin.images ?? {}) as Record<string, { url: string; width: number; height: number }>;
  const best = Object.values(images).sort((a, b) => b.width - a.width)[0];
  if (!best) return null;
  return { kind: 'image', src: best.url.replace(/\/\d+x\//, '/originals/'), width: best.width, height: best.height };
}

/** Does it exist? (Some pins have no original-size copy.) */
async function exists(src: string) {
  try {
    const r = await fetch(src, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok;
  } catch { return false; }
}

export async function resolvePin(raw: string) {
  const id = await pinId(raw);
  if (!id) throw new Error('Not a Pinterest pin link');
  const r = await fetch(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const pin = ((await r.json()) as { data?: Record<string, unknown>[] }).data?.[0];
  if (!pin) throw new Error('Pin not found (private or deleted?)');
  let found = pick(pin);
  if (!found) throw new Error('Nothing to import in this pin');
  // A guessed "originals" address may not exist: fall back to the size Pinterest listed.
  if (found.kind === 'image' && /\/originals\//.test(found.src) && !(await exists(found.src))) {
    const images = (pin.images ?? {}) as Record<string, { url: string; width: number }>;
    const best = Object.values(images).sort((a, b) => b.width - a.width)[0];
    if (best) found = { kind: 'image', src: best.url };
  }
  const title = String(pin.title || pin.grid_title || pin.description || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { ...found, name: title || `Pinterest pin ${id}`, pin: id };
}

export async function handlePinterest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (path === '/api/pinterest') {
      const raw = url.searchParams.get('url') ?? '';
      if (!isPinterestUrl(raw)) return json(res, 400, { error: 'Not a Pinterest link' });
      return json(res, 200, await resolvePin(raw));
    }
    if (path === '/api/pinterest/file') {
      const src = new URL(url.searchParams.get('src') ?? '');
      if (src.protocol !== 'https:' || !MEDIA_HOST.test(src.hostname)) return json(res, 400, { error: 'Only Pinterest media' });
      const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
      const size = Number(r.headers.get('content-length') ?? 0);
      if (!r.ok || !r.body) return json(res, 502, { error: `Pinterest said ${r.status}` });
      if (size > MAX_FILE) return json(res, 413, { error: 'Too big to import' });
      res.statusCode = 200;
      res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/octet-stream');
      if (size) res.setHeader('Content-Length', String(size));
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((go) => res.once('drain', go));
      }
      res.end();
      return;
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 502, { error: (e as Error).message || 'Could not reach Pinterest' });
    else res.destroy();
  }
}
