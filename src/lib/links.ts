// Client side of link previews: URL tidying and the /api/unfurl call.

import type { LinkPreview } from '../board/store';

/** "example.com/x" → "https://example.com/x"; null if it isn't a web URL. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// One request per URL even if several cards (or StrictMode) ask at once.
const inflight = new Map<string, Promise<LinkPreview>>();

export function fetchPreview(url: string): Promise<LinkPreview> {
  let p = inflight.get(url);
  if (!p) {
    p = fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : { failed: true }))
      .catch(() => ({ failed: true }))
      .finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}
