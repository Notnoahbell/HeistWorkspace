// Client side of link previews: URL tidying and the /api/unfurl call.
/** "example.com/x" → "https://example.com/x"; null if it isn't a web URL. */
export function normalizeUrl(input) {
    let s = input.trim();
    if (!s)
        return null;
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s))
        s = `https://${s}`;
    try {
        const u = new URL(s);
        if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.'))
            return null;
        return u.href;
    }
    catch {
        return null;
    }
}
export function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
}
// One request per URL even if several cards (or StrictMode) ask at once.
const inflight = new Map();
export function fetchPreview(url) {
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
