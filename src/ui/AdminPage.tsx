// Admin file manager (#/admin; the secret way in is clicking the logo five
// times quickly). Every uploaded file, which boards it's on, who uploaded it
// and when; open, download or delete them. Needs the admin key (ADMIN_KEY on
// the server, or the one it prints at startup); everything is checked server-side.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownWideNarrow, Download, ExternalLink, FileImage, FileVideo, Folder, FolderX, Files, KeyRound, Lock, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import { Avatar } from './Collab';
import { personalColor } from '../sync/presence';

const KEY_STORE = 'heist:admin-key';
const ROUTE = '#/admin';
const ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const;

interface Use { itemId: string; boardId: string; name: string; version: number; current: boolean; versions: number; addedBy: string | null; addedAt: number | null }
interface AdminFile {
  file: string; url: string; type: 'video' | 'image'; mime: string | null; name: string; size: number; extra: number;
  derived: Record<string, number>; poster: string | null; by: string | null; byGuess: boolean; at: number; known: boolean; uses: Use[];
  /** Unused files: when the automatic clean-up deletes it. */
  deletesAt: number | null;
}
interface Listing {
  files: AdminFile[];
  boards: Record<string, { path: string[]; owner: string | null }>;
  users: Record<string, { id: string; name: string; icon: string | null }>;
  total: number;
  /** How long a file sits unused before it's cleared automatically. */
  graceHours: number;
}
type Scope = { kind: 'all' } | { kind: 'unused' } | { kind: 'board'; id: string };
type SortKey = 'at' | 'size' | 'name' | 'by';

// --- Route ---------------------------------------------------------------------------

const subscribeHash = (fn: () => void) => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); };
export const isAdminOpen = () => location.hash.startsWith(ROUTE);
let returnTo = '#/';

/** Open the file manager (remembering where to come back to). */
export function openAdmin() {
  if (isAdminOpen()) return;
  returnTo = location.hash || '#/';
  location.hash = ROUTE;
}
const closeAdmin = () => { location.hash = returnTo; };

/** Five quick clicks: the secret way in. */
export function useSecretClicks(count = 5, within = 1600) {
  const times = useRef<number[]>([]);
  return () => {
    const now = Date.now();
    times.current = [...times.current.filter((t) => now - t < within), now];
    if (times.current.length >= count) { times.current = []; openAdmin(); }
  };
}

// --- Data ------------------------------------------------------------------------------

function readKey() { try { return sessionStorage.getItem(KEY_STORE) ?? localStorage.getItem(KEY_STORE); } catch { return null; } }
function storeKey(key: string | null, remember: boolean) {
  try {
    sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY_STORE, key);
  } catch { /* fine: asked again next time */ }
}

async function api<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), 'x-admin-key': key, 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Error ${res.status}`), { status: res.status });
  return body as T;
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const fmtWhen = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
/** "in 23 h", "in 40 min", "soon". */
const fmtUntil = (t: number) => {
  const s = (t - Date.now()) / 1000;
  if (s < 60) return 'soon';
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  if (s < 86400 * 2) return `in ${Math.ceil(s / 3600)} h`;
  return `in ${Math.ceil(s / 86400)} days`;
};
const fmtFull = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// --- Page ------------------------------------------------------------------------------

export function AdminPage() {
  const open = useSyncExternalStore(subscribeHash, isAdminOpen);
  if (!open) return null;
  return createPortal(<Admin />, document.body);
}

function Admin() {
  const [key, setKey] = useState(readKey);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (k = key) => {
    if (!k) return;
    setLoading(true);
    try {
      setData(await api<Listing>(k, '/api/admin/files'));
      setError(null);
    } catch (e) {
      if ((e as { status?: number }).status === 401) { storeKey(null, false); setKey(null); }
      setError((e as Error).message);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [key]);

  // Esc closes (the page; dialogs and the drawer catch it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeAdmin(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!key) return <Unlock error={error} onUnlock={(k, remember) => { storeKey(k, remember); setError(null); setKey(k); }} />;
  return (
    <FileManager
      data={data}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      onLock={() => { storeKey(null, false); setKey(null); setData(null); }}
      onSweep={async () => {
        const r = await api<{ deleted: number; freed: number; waiting: number }>(key, '/api/admin/sweep', { method: 'POST', body: JSON.stringify({ now: true }) });
        await load();
        return r;
      }}
      onDelete={async (files) => {
        const r = await api<{ deleted: number; freed: number; cardsUpdated: number; cardsDeleted: number }>(key, '/api/admin/delete', { method: 'POST', body: JSON.stringify({ files }) });
        await load();
        return r;
      }}
    />
  );
}

function Unlock({ error, onUnlock }: { error: string | null; onUnlock: (key: string, remember: boolean) => void }) {
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(true);
  return (
    <div className="admin admin-lock" role="dialog" aria-modal="true" aria-label="Admin">
      <form className="admin-lock-card" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onUnlock(value.trim(), remember); }}>
        <button type="button" className="admin-icon-btn admin-lock-close" onClick={closeAdmin} aria-label="Back to the board" title="Back to the board (Esc)"><X {...ICON} /></button>
        <span className="admin-lock-glyph"><Lock size={22} strokeWidth={2} aria-hidden="true" /></span>
        <h1>Admin</h1>
        <p>Enter the admin key to manage uploaded files.</p>
        <label className="admin-field">
          <KeyRound {...ICON} />
          <input autoFocus type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin key" autoComplete="current-password" spellCheck={false} />
        </label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <label className="admin-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device</label>
        <button className="admin-primary" type="submit" disabled={!value.trim()}>Unlock</button>
      </form>
    </div>
  );
}

function FileManager({ data, loading, error, onRefresh, onLock, onSweep, onDelete }: {
  data: Listing | null; loading: boolean; error: string | null;
  onRefresh: () => void; onLock: () => void;
  onSweep: () => Promise<{ deleted: number; freed: number; waiting: number }>;
  onDelete: (files: string[]) => Promise<{ deleted: number; freed: number; cardsUpdated: number; cardsDeleted: number }>;
}) {
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'video' | 'image'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'at', dir: -1 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const files = data?.files ?? [];
  const userName = (id: string | null) => (id ? data?.users[id]?.name ?? 'Unknown user' : 'Unknown');
  const boardPath = (id: string) => data?.boards[id]?.path ?? ['(unknown board)'];

  // Boards that have files, grouped under whose Home they're in.
  const groups = useMemo(() => {
    const per = new Map<string, { count: number; size: number }>();
    for (const f of files) for (const b of new Set(f.uses.map((u) => u.boardId))) {
      const e = per.get(b) ?? { count: 0, size: 0 };
      e.count++; e.size += f.size + f.extra;
      per.set(b, e);
    }
    const byHome = new Map<string, { id: string; path: string[]; count: number; size: number }[]>();
    for (const [id, e] of per) {
      const path = data?.boards[id]?.path ?? ['(unknown)'];
      const home = path[0];
      const list = byHome.get(home) ?? [];
      list.push({ id, path, ...e });
      byHome.set(home, list);
    }
    for (const list of byHome.values()) list.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')));
    return [...byHome].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const unused = files.filter((f) => !f.uses.length);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = files.filter((f) => {
      if (scope.kind === 'unused' && f.uses.length) return false;
      if (scope.kind === 'board' && !f.uses.some((u) => u.boardId === scope.id)) return false;
      if (type !== 'all' && f.type !== type) return false;
      if (q && ![f.name, f.file, userName(f.by), ...f.uses.flatMap((u) => [u.name, ...boardPath(u.boardId)])].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
    const val = (f: AdminFile) => (sort.key === 'at' ? f.at : sort.key === 'size' ? f.size + f.extra : sort.key === 'name' ? f.name.toLowerCase() : userName(f.by).toLowerCase());
    return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [files, scope, query, type, sort]);

  const allChecked = shown.length > 0 && shown.every((f) => checked.has(f.file));
  const toggle = (file: string) => setChecked((c) => { const n = new Set(c); if (n.has(file)) n.delete(file); else n.add(file); return n; });
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'by' ? 1 : -1 }));
  const detail = files.find((f) => f.file === open) ?? null;
  const selectedSize = files.filter((f) => checked.has(f.file)).reduce((n, f) => n + f.size + f.extra, 0);
  const scopeTitle = scope.kind === 'all' ? 'All files' : scope.kind === 'unused' ? 'Not on any board' : boardPath(scope.id).join(' / ');

  const Th = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button onClick={() => sortBy(k)}>
        {children}
        {sort.key === k && <ArrowDownWideNarrow size={13} strokeWidth={2} aria-hidden="true" style={{ transform: sort.dir === 1 ? 'scaleY(-1)' : undefined }} />}
      </button>
    </th>
  );

  return (
    <div className="admin" role="dialog" aria-modal="true" aria-label="File manager">
      <header className="admin-top">
        <span className="admin-title"><Files size={18} strokeWidth={2} aria-hidden="true" /> File manager</span>
        <span className="admin-total">{data ? `${files.length} files · ${fmtBytes(data.total)}` : ''}</span>
        <label className="admin-field admin-search">
          <Search {...ICON} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, people, boards" spellCheck={false} />
        </label>
        <div className="admin-seg" role="radiogroup" aria-label="Type">
          {(['all', 'video', 'image'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)}>{t === 'all' ? 'All' : t === 'video' ? 'Videos' : 'Photos'}</button>
          ))}
        </div>
        <button className="admin-icon-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh" data-spin={loading || undefined}><RefreshCw {...ICON} /></button>
        <button className="admin-icon-btn" onClick={onLock} title="Lock (forget the key here)" aria-label="Lock"><Lock {...ICON} /></button>
        <button className="admin-icon-btn" onClick={closeAdmin} title="Back to the board (Esc)" aria-label="Close"><X {...ICON} /></button>
      </header>

      <div className="admin-body">
        <nav className="admin-side" aria-label="Boards">
          <button className="admin-scope" aria-current={scope.kind === 'all' || undefined} onClick={() => setScope({ kind: 'all' })}>
            <Files {...ICON} /><span>All files</span><em>{files.length}</em>
          </button>
          <button className="admin-scope" aria-current={scope.kind === 'unused' || undefined} onClick={() => setScope({ kind: 'unused' })}>
            <FolderX {...ICON} /><span>Not on any board</span><em>{unused.length}</em>
          </button>
          {groups.map(([home, boards]) => (
            <div key={home} className="admin-group">
              <div className="admin-group-name">{home}</div>
              {boards.map((b) => (
                <button
                  key={b.id}
                  className="admin-scope"
                  aria-current={(scope.kind === 'board' && scope.id === b.id) || undefined}
                  onClick={() => setScope({ kind: 'board', id: b.id })}
                  title={`${b.path.join(' / ')} · ${fmtBytes(b.size)}`}
                  style={{ paddingLeft: 10 + Math.min(4, b.path.length - 2) * 12 }}
                >
                  <Folder {...ICON} /><span>{b.path.length > 1 ? b.path[b.path.length - 1] : 'Home'}</span><em>{b.count}</em>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="admin-main">
          <div className="admin-main-head">
            <h2>{scopeTitle}</h2>
            <span>{shown.length} {shown.length === 1 ? 'file' : 'files'} · {fmtBytes(shown.reduce((n, f) => n + f.size + f.extra, 0))}</span>
            {scope.kind === 'unused' && unused.length > 0 && (
              <button
                className="admin-ghost"
                disabled={sweeping}
                title="Delete every file that isn't on a board (except ones uploaded in the last couple of minutes)"
                onClick={async () => {
                  setSweeping(true);
                  try {
                    const r = await onSweep();
                    setNotice(r.deleted ? `Cleared ${r.deleted} unused ${r.deleted === 1 ? 'file' : 'files'} · ${fmtBytes(r.freed)} freed` : 'Nothing to clear yet');
                  } finally { setSweeping(false); }
                }}
              >
                <Trash2 {...ICON} /> {sweeping ? 'Clearing…' : 'Clear unused now'}
              </button>
            )}
          </div>
          {scope.kind === 'unused' && data && (
            <p className="admin-hint">Files that aren't on any board are deleted automatically once they've been unused for {data.graceHours} hours.</p>
          )}
          {error && <p className="admin-error" role="alert">{error}</p>}
          {notice && <p className="admin-notice" role="status" onAnimationEnd={() => setNotice(null)}>{notice}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-col-check">
                    <input type="checkbox" aria-label="Select all shown" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(shown.map((f) => f.file)))} />
                  </th>
                  <th className="admin-col-thumb" aria-label="Preview" />
                  <Th k="name">Name</Th>
                  <Th k="size" className="admin-col-num">Size</Th>
                  <Th k="by">Uploaded by</Th>
                  <Th k="at">Uploaded</Th>
                  <th>On</th>
                  <th className="admin-col-actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const boardsOn = [...new Set(f.uses.map((u) => u.boardId))];
                  return (
                    <tr key={f.file} data-checked={checked.has(f.file) || undefined} data-open={open === f.file || undefined} onClick={() => setOpen(f.file)}>
                      <td className="admin-col-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${f.name}`} checked={checked.has(f.file)} onChange={() => toggle(f.file)} />
                      </td>
                      <td className="admin-col-thumb"><Thumb f={f} /></td>
                      <td className="admin-col-name">
                        <span className="admin-name" title={f.name}>{f.name}</span>
                        <span className="admin-sub">{f.type === 'video' ? <FileVideo size={12} strokeWidth={2} aria-hidden="true" /> : <FileImage size={12} strokeWidth={2} aria-hidden="true" />} {f.file}</span>
                      </td>
                      <td className="admin-col-num" title={f.extra ? `${fmtBytes(f.size)} + ${fmtBytes(f.extra)} posters / proxy` : undefined}>{fmtBytes(f.size + f.extra)}</td>
                      <td><Who id={f.by} guess={f.byGuess} users={data!.users} /></td>
                      <td title={fmtFull(f.at)}>{fmtWhen(f.at)}</td>
                      <td className="admin-col-on">
                        {boardsOn.length ? (
                          <>
                            <span className="admin-chip" title={boardPath(boardsOn[0]).join(' / ')}>{boardPath(boardsOn[0]).slice(-1)[0]}</span>
                            {boardsOn.length > 1 && <span className="admin-chip admin-chip-more">+{boardsOn.length - 1}</span>}
                          </>
                        ) : (
                          <span className="admin-chip admin-chip-none" title={f.deletesAt ? `Not on any board; deleted automatically ${fmtFull(f.deletesAt)}` : undefined}>
                            Unused{f.deletesAt ? ` · clears ${fmtUntil(f.deletesAt)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="admin-col-actions" onClick={(e) => e.stopPropagation()}>
                        <a className="admin-icon-btn" href={f.url} target="_blank" rel="noopener noreferrer" title="Open" aria-label="Open"><ExternalLink {...ICON} /></a>
                        <a className="admin-icon-btn" href={f.url} download={f.name} title="Download" aria-label="Download"><Download {...ICON} /></a>
                        <button className="admin-icon-btn admin-danger" onClick={() => setConfirm([f.file])} title="Delete" aria-label="Delete"><Trash2 {...ICON} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && !shown.length && <p className="admin-empty">Nothing here{query ? ` matching “${query}”` : ''}.</p>}
            {!data && !error && <p className="admin-empty">Loading…</p>}
          </div>
          {checked.size > 0 && (
            <div className="admin-bulk" role="toolbar" aria-label="Selected files">
              <span>{checked.size} selected · {fmtBytes(selectedSize)}</span>
              <button className="admin-ghost" onClick={() => setChecked(new Set())}>Clear</button>
              <button className="admin-danger-btn" onClick={() => setConfirm([...checked])}><Trash2 {...ICON} /> Delete {checked.size}</button>
            </div>
          )}
        </main>

        {detail && data && (
          <Detail f={detail} data={data} onClose={() => setOpen(null)} onDelete={() => setConfirm([detail.file])} />
        )}
      </div>

      {confirm && data && (
        <ConfirmDelete
          files={files.filter((f) => confirm.includes(f.file))}
          boardPath={boardPath}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await onDelete(confirm);
            setChecked((c) => { const n = new Set(c); for (const x of confirm) n.delete(x); return n; });
            if (open && confirm.includes(open)) setOpen(null);
            setConfirm(null);
            setNotice(`Deleted ${r.deleted} ${r.deleted === 1 ? 'file' : 'files'} · ${fmtBytes(r.freed)} freed${r.cardsDeleted ? ` · ${r.cardsDeleted} ${r.cardsDeleted === 1 ? 'card' : 'cards'} removed` : ''}${r.cardsUpdated ? ` · ${r.cardsUpdated} ${r.cardsUpdated === 1 ? 'card' : 'cards'} updated` : ''}`);
          }}
        />
      )}
    </div>
  );
}

function Thumb({ f }: { f: AdminFile }) {
  const src = f.type === 'image' ? f.url : f.poster;
  return (
    <span className="admin-thumb" data-type={f.type}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : f.type === 'video' ? <FileVideo size={18} strokeWidth={1.8} aria-hidden="true" /> : <FileImage size={18} strokeWidth={1.8} aria-hidden="true" />}
    </span>
  );
}

function Who({ id, guess, users }: { id: string | null; guess?: boolean; users: Listing['users'] }) {
  if (!id) return <span className="admin-who admin-dim">Unknown</span>;
  const p = users[id];
  return (
    <span className="admin-who" title={guess ? 'Not recorded (uploaded before uploads were tracked): this is the owner of the board it’s on' : undefined}>
      <Avatar profile={{ name: p?.name ?? '?', icon: p?.icon ?? null }} color={personalColor(id)} size={20} />
      <span>{p?.name ?? 'Unknown user'}</span>
      {guess && <span className="admin-dim">(board owner)</span>}
    </span>
  );
}

function Detail({ f, data, onClose, onDelete }: { f: AdminFile; data: Listing; onClose: () => void; onDelete: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const path = (id: string) => data.boards[id]?.path ?? ['(unknown board)'];
  return (
    <aside className="admin-detail" aria-label="File details">
      <div className="admin-detail-head">
        <h3 title={f.name}>{f.name}</h3>
        <button className="admin-icon-btn" onClick={onClose} aria-label="Close details"><X {...ICON} /></button>
      </div>
      <div className="admin-preview">
        {f.type === 'video'
          ? <video key={f.url} src={f.url} poster={f.poster ?? undefined} controls preload="metadata" />
          : <img src={f.url} alt={f.name} />}
      </div>
      <dl className="admin-facts">
        <dt>Uploaded by</dt><dd><Who id={f.by} guess={f.byGuess} users={data.users} /></dd>
        <dt>Uploaded</dt><dd>{fmtFull(f.at)}{!f.known && <span className="admin-dim"> (file date)</span>}</dd>
        <dt>Size</dt><dd>{fmtBytes(f.size)}{f.extra > 0 && <span className="admin-dim"> + {fmtBytes(f.extra)} posters / proxy</span>}</dd>
        <dt>Type</dt><dd>{f.mime ?? f.file.split('.').pop()?.toUpperCase()}</dd>
        <dt>File</dt><dd className="admin-mono">{f.file}</dd>
      </dl>
      <h4>{f.uses.length ? `On ${f.uses.length} ${f.uses.length === 1 ? 'card' : 'cards'}` : 'Not on any board'}</h4>
      {!f.uses.length && f.deletesAt && <p className="admin-hint admin-hint-tight">Deleted automatically {fmtUntil(f.deletesAt)} ({fmtFull(f.deletesAt)}) unless it's put on a board.</p>}
      <ul className="admin-uses">
        {f.uses.map((u) => (
          <li key={`${u.itemId}-${u.version}`}>
            <span className="admin-uses-path">{path(u.boardId).join(' / ')}</span>
            <span className="admin-uses-card">
              {u.name || 'Untitled'}
              {u.versions > 1 && <span className="admin-chip">v{u.version}{u.current ? ' · current' : ''}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="admin-detail-actions">
        <a className="admin-ghost" href={f.url} target="_blank" rel="noopener noreferrer"><ExternalLink {...ICON} /> Open</a>
        <a className="admin-ghost" href={f.url} download={f.name}><Download {...ICON} /> Download</a>
        <button className="admin-danger-btn" onClick={onDelete}><Trash2 {...ICON} /> Delete</button>
      </div>
    </aside>
  );
}

function ConfirmDelete({ files, boardPath, onCancel, onConfirm }: {
  files: AdminFile[]; boardPath: (id: string) => string[]; onCancel: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  // What happens to the cards that use them.
  const gone = new Set(files.map((f) => f.file));
  const effects: string[] = [];
  for (const f of files) for (const u of f.uses) {
    const where = boardPath(u.boardId).slice(-1)[0];
    if (!u.current) effects.push(`v${u.version} is dropped from “${u.name || 'Untitled'}” on ${where}`);
    else if (u.versions > 1) effects.push(`“${u.name || 'Untitled'}” on ${where} goes back to v${u.version - 1}`);
    else effects.push(`“${u.name || 'Untitled'}” is removed from ${where}, with its comments`);
  }
  const size = files.reduce((n, f) => n + f.size + f.extra, 0);
  return (
    <div className="admin-modal" role="alertdialog" aria-modal="true" aria-label="Delete files" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="admin-modal-card">
        <h3>Delete {files.length === 1 ? `“${files[0].name}”` : `${files.length} files`}?</h3>
        <p>{fmtBytes(size)} will be freed. This can’t be undone.</p>
        {effects.length > 0 && (
          <>
            <p className="admin-modal-sub">On the boards:</p>
            <ul className="admin-effects">
              {effects.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {effects.length > 8 && <li className="admin-dim">and {effects.length - 8} more</li>}
            </ul>
          </>
        )}
        {gone.size > 0 && error && <p className="admin-error">{error}</p>}
        <div className="admin-modal-actions">
          <button className="admin-ghost" onClick={onCancel} autoFocus>Cancel</button>
          <button
            className="admin-danger-btn"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } catch (e) { setError((e as Error).message); setBusy(false); } }}
          >
            <Trash2 {...ICON} /> {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
