// Link previews ("unfurling"): fetch a page server-side and read its Open
// Graph / meta tags. Browsers can't do this themselves (cross-origin), so it
// runs in the dev server for now and moves into the real backend later.
//
// It fetches URLs on a user's behalf, so it guards against being pointed at
// internal services: http(s) only, public addresses only (checked on every
// redirect hop), a timeout and a size cap.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  failed?: boolean;
}

const TIMEOUT_MS = 6000;
const MAX_BYTES = 768 * 1024;
const MAX_REDIRECTS = 5;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; preview: LinkPreview }>();

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host');
  const { address } = isIP(host) ? { address: host } : await lookup(host);
  if (isPrivateIp(address)) throw new Error('private address');
}

/** Fetch following redirects by hand so every hop is checked. */
async function safeFetch(start: URL, signal: AbortSignal): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HeistWorkspace/0.1; link preview)',
        Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
      },
    });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    return Object.defineProperty(res, 'finalUrl', { value: url.href });
  }
  throw new Error('too many redirects');
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  }).trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

function parse(html: string, base: string): LinkPreview {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = decode(a.content);
  }
  let favicon: string | undefined;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (/\bicon\b/i.test(a.rel ?? '') && a.href) { favicon = a.href; break; }
  }
  const abs = (u?: string) => {
    if (!u) return undefined;
    try { return new URL(decode(u), base).href; } catch { return undefined; }
  };
  const title = meta['og:title'] || meta['twitter:title'] || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? '');
  return {
    title: title || undefined,
    description: meta['og:description'] || meta['twitter:description'] || meta.description || undefined,
    image: abs(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']),
    siteName: meta['og:site_name'] || undefined,
    favicon: abs(favicon) ?? new URL('/favicon.ico', base).href,
  };
}

export async function unfurl(raw: string): Promise<LinkPreview> {
  const url = new URL(raw);
  const hit = cache.get(url.href);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.preview;

  const res = await safeFetch(url, AbortSignal.timeout(TIMEOUT_MS));
  const finalUrl = (res as Response & { finalUrl: string }).finalUrl;
  const type = res.headers.get('content-type') ?? '';
  let preview: LinkPreview;
  if (!res.ok) preview = { failed: true };
  else if (type.startsWith('image/')) preview = { image: finalUrl, title: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '') };
  else if (type.includes('html')) preview = parse(await readCapped(res), finalUrl);
  else preview = { failed: true };

  cache.set(url.href, { at: Date.now(), preview });
  return preview;
}

export async function handleUnfurl(req: IncomingMessage, res: ServerResponse) {
  const target = new URL(req.url ?? '', 'http://local').searchParams.get('url');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!target) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'missing url' }));
    return;
  }
  try {
    res.end(JSON.stringify(await unfurl(target)));
  } catch {
    res.end(JSON.stringify({ failed: true } satisfies LinkPreview));
  }
}

export function unfurlPlugin(): Plugin {
  return {
    name: 'heist-unfurl',
    configureServer(server) { server.middlewares.use('/api/unfurl', handleUnfurl); },
    configurePreviewServer(server) { server.middlewares.use('/api/unfurl', handleUnfurl); },
  };
}
