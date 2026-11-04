// Admin file manager API. Every request needs the admin key in `x-admin-key`
// (ADMIN_KEY, or the one the sync server made and printed at startup).
//
//   GET  /api/admin/files    → every uploaded file: size, its derived files, who
//                              uploaded it and when, and every card (and version)
//                              that uses it, with the board it's on
//   POST /api/admin/delete   { files: ["<id>.<ext>", …] } → deletes the files (and
//                              their posters, filmstrips, proxies), and takes them off
//                              the boards: an older version is dropped from its card;
//                              a card's current version falls back to the one before;
//                              a card with nothing left is deleted with its comments.

import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncServer } from './sync.ts';
import type { UploadRecord } from './uploads.ts';

const MEDIA_RE = /^([0-9a-f]{24})\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i;
const DERIVED = ['derived.json', 'poster.jpg', 'strip.jpg', 'proxy.mp4', 'meta.json'];
/** Wrong keys allowed per address per minute. */
const MAX_FAILS = 10;

type AnyItem = { id: string; kind: string; boardId: string; [k: string]: unknown };
interface Version { src: string; name: string; meta?: Record<string, unknown>; addedAt?: number; addedBy?: string | null; [k: string]: unknown }

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

async function body(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error('too big'); }
  return JSON.parse(raw || '{}');
}

export function createAdmin(dir: string, sync: SyncServer) {
  const fails = new Map<string, { n: number; since: number }>();

  function authorised(req: IncomingMessage): boolean | 'locked' {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const f = fails.get(ip);
    if (f && Date.now() - f.since > 60_000) fails.delete(ip);
    if ((fails.get(ip)?.n ?? 0) >= MAX_FAILS) return 'locked';
    const given = Buffer.from(String(req.headers['x-admin-key'] ?? ''));
    const want = Buffer.from(sync.adminKey());
    if (given.length === want.length && timingSafeEqual(given, want)) return true;
    const e = fails.get(ip) ?? { n: 0, since: Date.now() };
    e.n++;
    fails.set(ip, e);
    return false;
  }

  /** Board titles from the top down, e.g. ["Alex's Home", "Campaign", "Shots"]. */
  function pathOf(boardId: string, items: Record<string, AnyItem>, profiles: Record<string, { name: string }>): string[] {
    const out: string[] = [];
    for (let b: string | undefined = boardId, guard = 0; b && guard < 64; guard++) {
      if (b.startsWith('home:')) { out.unshift(`${profiles[b.slice(5)]?.name ?? 'Someone'}'s Home`); break; }
      const board: AnyItem | undefined = items[b];
      if (!board) { out.unshift('(missing board)'); break; }
      out.unshift(String(board.title || 'Untitled board'));
      b = board.boardId;
    }
    return out;
  }

  /** Which cards use which file (by file name), with the version each is. */
  function usesByFile(items: Record<string, AnyItem>) {
    const uses = new Map<string, { item: AnyItem; n: number; current: boolean; version: Version | null }[]>();
    const add = (src: unknown, use: { item: AnyItem; n: number; current: boolean; version: Version | null }) => {
      if (typeof src !== 'string' || !src.startsWith('/uploads/')) return;
      const file = src.slice('/uploads/'.length);
      const list = uses.get(file) ?? [];
      list.push(use);
      uses.set(file, list);
    };
    for (const it of Object.values(items)) {
      if (it.kind !== 'media') continue;
      const versions = (Array.isArray(it.versions) ? it.versions : []) as Version[];
      versions.forEach((v, i) => add(v.src, { item: it, n: i + 1, current: false, version: v }));
      add(it.src, { item: it, n: versions.length + 1, current: true, version: null });
    }
    return uses;
  }

  async function list() {
    const { items, profiles } = sync.adminView() as { items: Record<string, AnyItem>; profiles: Record<string, { id: string; name: string; icon: string | null }> };
    const names = await readdir(dir).catch(() => [] as string[]);
    const present = new Set(names);
    const uses = usesByFile(items);
    const boards: Record<string, { path: string[]; owner: string | null }> = {};
    const files = [];
    let total = 0;
    for (const file of names) {
      const m = MEDIA_RE.exec(file);
      if (!m) continue;
      const id = m[1];
      const st = await stat(join(dir, file)).catch(() => null);
      if (!st?.isFile()) continue;
      let extra = 0;
      const derived: Record<string, number> = {};
      for (const d of DERIVED) {
        if (!present.has(`${id}.${d}`)) continue;
        const ds = await stat(join(dir, `${id}.${d}`)).catch(() => null);
        if (ds) { derived[d] = ds.size; extra += ds.size; }
      }
      let record: UploadRecord | null = null;
      if (present.has(`${id}.meta.json`)) {
        try { record = JSON.parse(await readFile(join(dir, `${id}.meta.json`), 'utf8')); } catch { /* unreadable: treat as unknown */ }
      }
      const used = (uses.get(file) ?? []).map((u) => {
        boards[u.item.boardId] ??= { path: pathOf(u.item.boardId, items, profiles), owner: sync.ownerOf(u.item as never) };
        return {
          itemId: u.item.id,
          boardId: u.item.boardId,
          name: String(u.version ? u.version.name : u.item.name ?? ''),
          version: u.n,
          current: u.current,
          versions: ((u.item.versions as unknown[] | undefined)?.length ?? 0) + 1,
          addedBy: u.version ? u.version.addedBy ?? null : (u.item.versionBy as string | null | undefined) ?? null,
          addedAt: u.version ? u.version.addedAt ?? null : (u.item.versionAt as number | null | undefined) ?? null,
        };
      });
      // Who and when: the upload's own record; else whoever added that version; else unknown (file date).
      const firstUse = used[0];
      const by = record?.by ?? firstUse?.addedBy ?? null;
      // Older uploads didn't record who: the owner of the board it's on is the likeliest.
      const guess = by ? null : firstUse ? boards[firstUse.boardId]?.owner ?? null : null;
      const at = record?.at ?? firstUse?.addedAt ?? st.mtimeMs;
      total += st.size + extra;
      files.push({
        file,
        url: `/uploads/${file}`,
        type: /^(mp4|webm|mov)$/i.test(m[2]) ? 'video' : 'image',
        mime: record?.mime ?? null,
        name: record?.name ?? firstUse?.name ?? file,
        size: st.size,
        extra,
        derived,
        poster: derived['poster.jpg'] != null ? `/uploads/${id}.poster.jpg` : null,
        by: by ?? guess,
        byGuess: !by && !!guess,
        at,
        known: !!record,
        uses: used,
      });
    }
    files.sort((a, b) => b.at - a.at);
    return { files, boards, users: profiles, total };
  }

  /** Take files off the boards, then off the disk. */
  async function remove(fileNames: string[]) {
    const wanted = new Set(fileNames.filter((f) => MEDIA_RE.test(f)));
    const { items } = sync.adminView() as { items: Record<string, AnyItem> };
    const upserts: AnyItem[] = [];
    const deletes = new Set<string>();
    const gone = (src: unknown) => typeof src === 'string' && src.startsWith('/uploads/') && wanted.has(src.slice(9));
    for (const it of Object.values(items)) {
      if (it.kind !== 'media') continue;
      let versions = (Array.isArray(it.versions) ? it.versions : []) as Version[];
      const before = versions.length;
      versions = versions.filter((v) => !gone(v.src));
      let next: AnyItem | null = versions.length !== before ? { ...it, versions } : null;
      if (gone(it.src)) {
        const prev = versions[versions.length - 1];
        if (prev) {
          // The version before becomes the current one.
          const { src, name, meta, addedAt, addedBy, label, status } = prev;
          next = {
            ...it, src, name, meta: meta ?? {}, versions: versions.slice(0, -1), versionLabel: label ?? null, status: status ?? null,
            versionAt: versions.length > 1 ? addedAt ?? null : null, versionBy: versions.length > 1 ? addedBy ?? null : null,
          };
        } else {
          next = null;
          deletes.add(it.id);
        }
      }
      if (next) upserts.push(next);
    }
    // Comments on deleted cards go too.
    for (const it of Object.values(items)) if (it.kind === 'comment' && deletes.has(String(it.targetId))) deletes.add(it.id);
    const cardsDeleted = [...deletes].filter((id) => items[id]?.kind === 'media').length;
    sync.adminApply(upserts, [...deletes]);

    let freed = 0;
    for (const file of wanted) {
      const id = file.split('.')[0];
      for (const name of [file, ...DERIVED.map((d) => `${id}.${d}`)]) {
        const p = join(dir, name);
        const st = await stat(p).catch(() => null);
        if (!st) continue;
        await unlink(p).catch(() => {});
        freed += st.size;
      }
    }
    return { deleted: wanted.size, freed, cardsUpdated: upserts.length, cardsDeleted };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const ok = authorised(req);
    if (ok === 'locked') return json(res, 429, { error: 'Too many wrong keys. Try again in a minute.' });
    if (!ok) return json(res, 401, { error: 'Wrong key.' });
    try {
      if (path === '/api/admin/files' && req.method === 'GET') return json(res, 200, await list());
      if (path === '/api/admin/delete' && req.method === 'POST') {
        const b = (await body(req)) as { files?: unknown };
        const files = Array.isArray(b.files) ? b.files.filter((f): f is string => typeof f === 'string') : [];
        return json(res, 200, await remove(files));
      }
      json(res, 404, { error: 'Not found' });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message ?? e) });
    }
  }

  return { handle };
}
