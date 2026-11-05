import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Admin file manager (#/admin; the secret way in is clicking the logo five
// times quickly). Every uploaded file, which boards it's on, who uploaded it
// and when; open, download or delete them. Needs the admin key (ADMIN_KEY on
// the server, or the one it prints at startup); everything is checked server-side.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownWideNarrow, Download, ExternalLink, FileImage, FileVideo, Folder, FolderX, Files, KeyRound, Lock, RefreshCw, Search, Trash2, X, } from 'lucide-react';
import { Avatar } from './Collab';
import { personalColor } from '../sync/presence';
import { fullDate } from '../lib/time';
const KEY_STORE = 'heist:admin-key';
const ROUTE = '#/admin';
const ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true };
// --- Route ---------------------------------------------------------------------------
const subscribeHash = (fn) => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); };
export const isAdminOpen = () => location.hash.startsWith(ROUTE);
let returnTo = '#/';
/** Open the file manager (remembering where to come back to). */
export function openAdmin() {
    if (isAdminOpen())
        return;
    returnTo = location.hash || '#/';
    location.hash = ROUTE;
}
const closeAdmin = () => { location.hash = returnTo; };
/** Five quick clicks: the secret way in. */
export function useSecretClicks(count = 5, within = 1600) {
    const times = useRef([]);
    return () => {
        const now = Date.now();
        times.current = [...times.current.filter((t) => now - t < within), now];
        if (times.current.length >= count) {
            times.current = [];
            openAdmin();
        }
    };
}
// --- Data ------------------------------------------------------------------------------
function readKey() { try {
    return sessionStorage.getItem(KEY_STORE) ?? localStorage.getItem(KEY_STORE);
}
catch {
    return null;
} }
function storeKey(key, remember) {
    try {
        sessionStorage.removeItem(KEY_STORE);
        localStorage.removeItem(KEY_STORE);
        if (key)
            (remember ? localStorage : sessionStorage).setItem(KEY_STORE, key);
    }
    catch { /* fine: asked again next time */ }
}
async function api(key, path, init) {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), 'x-admin-key': key, 'Content-Type': 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw Object.assign(new Error(body.error ?? `Error ${res.status}`), { status: res.status });
    return body;
}
const fmtBytes = (n) => {
    if (n < 1024)
        return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do {
        n /= 1024;
        i++;
    } while (n >= 1024 && i < u.length - 1);
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const fmtWhen = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60)
        return 'just now';
    if (s < 3600)
        return `${Math.floor(s / 60)} min ago`;
    if (s < 86400)
        return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7)
        return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
/** "in 23 h", "in 40 min", "soon". */
const fmtUntil = (t) => {
    const s = (t - Date.now()) / 1000;
    if (s < 60)
        return 'soon';
    if (s < 3600)
        return `in ${Math.ceil(s / 60)} min`;
    if (s < 86400 * 2)
        return `in ${Math.ceil(s / 3600)} h`;
    return `in ${Math.ceil(s / 86400)} days`;
};
const fmtFull = fullDate;
// --- Page ------------------------------------------------------------------------------
export function AdminPage() {
    const open = useSyncExternalStore(subscribeHash, isAdminOpen);
    if (!open)
        return null;
    return createPortal(_jsx(Admin, {}), document.body);
}
function Admin() {
    const [key, setKey] = useState(readKey);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const load = async (k = key) => {
        if (!k)
            return;
        setLoading(true);
        try {
            setData(await api(k, '/api/admin/files'));
            setError(null);
        }
        catch (e) {
            if (e.status === 401) {
                storeKey(null, false);
                setKey(null);
            }
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, [key]);
    // Esc closes (the page; dialogs and the drawer catch it first).
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented)
            closeAdmin(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    if (!key)
        return _jsx(Unlock, { error: error, onUnlock: (k, remember) => { storeKey(k, remember); setError(null); setKey(k); } });
    return (_jsx(FileManager, { data: data, loading: loading, error: error, onRefresh: () => void load(), onLock: () => { storeKey(null, false); setKey(null); setData(null); }, onSweep: async () => {
            const r = await api(key, '/api/admin/sweep', { method: 'POST', body: JSON.stringify({ now: true }) });
            await load();
            return r;
        }, onDelete: async (files) => {
            const r = await api(key, '/api/admin/delete', { method: 'POST', body: JSON.stringify({ files }) });
            await load();
            return r;
        } }));
}
function Unlock({ error, onUnlock }) {
    const [value, setValue] = useState('');
    const [remember, setRemember] = useState(true);
    return (_jsx("div", { className: "admin admin-lock", role: "dialog", "aria-modal": "true", "aria-label": "Admin", children: _jsxs("form", { className: "admin-lock-card", onSubmit: (e) => { e.preventDefault(); if (value.trim())
                onUnlock(value.trim(), remember); }, children: [_jsx("button", { type: "button", className: "admin-icon-btn admin-lock-close", onClick: closeAdmin, "aria-label": "Back to the board", title: "Back to the board (Esc)", children: _jsx(X, { ...ICON }) }), _jsx("span", { className: "admin-lock-glyph", children: _jsx(Lock, { size: 22, strokeWidth: 2, "aria-hidden": "true" }) }), _jsx("h1", { children: "Admin" }), _jsx("p", { children: "Enter the admin key to manage uploaded files." }), _jsxs("label", { className: "admin-field", children: [_jsx(KeyRound, { ...ICON }), _jsx("input", { autoFocus: true, type: "password", value: value, onChange: (e) => setValue(e.target.value), placeholder: "Admin key", autoComplete: "current-password", spellCheck: false })] }), error && _jsx("p", { className: "admin-error", role: "alert", children: error }), _jsxs("label", { className: "admin-check", children: [_jsx("input", { type: "checkbox", checked: remember, onChange: (e) => setRemember(e.target.checked) }), " Remember on this device"] }), _jsx("button", { className: "admin-primary", type: "submit", disabled: !value.trim(), children: "Unlock" })] }) }));
}
function FileManager({ data, loading, error, onRefresh, onLock, onSweep, onDelete }) {
    const [scope, setScope] = useState({ kind: 'all' });
    const [query, setQuery] = useState('');
    const [type, setType] = useState('all');
    const [sort, setSort] = useState({ key: 'at', dir: -1 });
    const [checked, setChecked] = useState(new Set());
    const [open, setOpen] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [notice, setNotice] = useState(null);
    const [sweeping, setSweeping] = useState(false);
    const files = data?.files ?? [];
    const userName = (id) => (id ? data?.users[id]?.name ?? 'Unknown user' : 'Unknown');
    const boardPath = (id) => data?.boards[id]?.path ?? ['(unknown board)'];
    // Boards that have files, grouped under whose Home they're in.
    const groups = useMemo(() => {
        const per = new Map();
        for (const f of files)
            for (const b of new Set(f.uses.map((u) => u.boardId))) {
                const e = per.get(b) ?? { count: 0, size: 0 };
                e.count++;
                e.size += f.size + f.extra;
                per.set(b, e);
            }
        const byHome = new Map();
        for (const [id, e] of per) {
            const path = data?.boards[id]?.path ?? ['(unknown)'];
            const home = path[0];
            const list = byHome.get(home) ?? [];
            list.push({ id, path, ...e });
            byHome.set(home, list);
        }
        for (const list of byHome.values())
            list.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')));
        return [...byHome].sort((a, b) => a[0].localeCompare(b[0]));
    }, [data]);
    const unused = files.filter((f) => !f.uses.length);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = files.filter((f) => {
            if (scope.kind === 'unused' && f.uses.length)
                return false;
            if (scope.kind === 'board' && !f.uses.some((u) => u.boardId === scope.id))
                return false;
            if (type !== 'all' && f.type !== type)
                return false;
            if (q && ![f.name, f.file, userName(f.by), ...f.uses.flatMap((u) => [u.name, ...boardPath(u.boardId)])].some((s) => s.toLowerCase().includes(q)))
                return false;
            return true;
        });
        const val = (f) => (sort.key === 'at' ? f.at : sort.key === 'size' ? f.size + f.extra : sort.key === 'name' ? f.name.toLowerCase() : userName(f.by).toLowerCase());
        return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
    }, [files, scope, query, type, sort]);
    const allChecked = shown.length > 0 && shown.every((f) => checked.has(f.file));
    const toggle = (file) => setChecked((c) => { const n = new Set(c); if (n.has(file))
        n.delete(file);
    else
        n.add(file); return n; });
    const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'by' ? 1 : -1 }));
    const detail = files.find((f) => f.file === open) ?? null;
    const selectedSize = files.filter((f) => checked.has(f.file)).reduce((n, f) => n + f.size + f.extra, 0);
    const scopeTitle = scope.kind === 'all' ? 'All files' : scope.kind === 'unused' ? 'Not on any board' : boardPath(scope.id).join(' / ');
    const Th = ({ k, children, className }) => (_jsx("th", { className: className, "aria-sort": sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined, children: _jsxs("button", { onClick: () => sortBy(k), children: [children, sort.key === k && _jsx(ArrowDownWideNarrow, { size: 13, strokeWidth: 2, "aria-hidden": "true", style: { transform: sort.dir === 1 ? 'scaleY(-1)' : undefined } })] }) }));
    return (_jsxs("div", { className: "admin", role: "dialog", "aria-modal": "true", "aria-label": "File manager", children: [_jsxs("header", { className: "admin-top", children: [_jsxs("span", { className: "admin-title", children: [_jsx(Files, { size: 18, strokeWidth: 2, "aria-hidden": "true" }), " File manager"] }), _jsx("span", { className: "admin-total", children: data ? `${files.length} files · ${fmtBytes(data.total)}` : '' }), _jsxs("label", { className: "admin-field admin-search", children: [_jsx(Search, { ...ICON }), _jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search names, people, boards", spellCheck: false })] }), _jsx("div", { className: "admin-seg", role: "radiogroup", "aria-label": "Type", children: ['all', 'video', 'image'].map((t) => (_jsx("button", { role: "radio", "aria-checked": type === t, onClick: () => setType(t), children: t === 'all' ? 'All' : t === 'video' ? 'Videos' : 'Photos' }, t))) }), _jsx("button", { className: "admin-icon-btn", onClick: onRefresh, title: "Refresh", "aria-label": "Refresh", "data-spin": loading || undefined, children: _jsx(RefreshCw, { ...ICON }) }), _jsx("button", { className: "admin-icon-btn", onClick: onLock, title: "Lock (forget the key here)", "aria-label": "Lock", children: _jsx(Lock, { ...ICON }) }), _jsx("button", { className: "admin-icon-btn", onClick: closeAdmin, title: "Back to the board (Esc)", "aria-label": "Close", children: _jsx(X, { ...ICON }) })] }), _jsxs("div", { className: "admin-body", children: [_jsxs("nav", { className: "admin-side", "aria-label": "Boards", children: [_jsxs("button", { className: "admin-scope", "aria-current": scope.kind === 'all' || undefined, onClick: () => setScope({ kind: 'all' }), children: [_jsx(Files, { ...ICON }), _jsx("span", { children: "All files" }), _jsx("em", { children: files.length })] }), _jsxs("button", { className: "admin-scope", "aria-current": scope.kind === 'unused' || undefined, onClick: () => setScope({ kind: 'unused' }), children: [_jsx(FolderX, { ...ICON }), _jsx("span", { children: "Not on any board" }), _jsx("em", { children: unused.length })] }), groups.map(([home, boards]) => (_jsxs("div", { className: "admin-group", children: [_jsx("div", { className: "admin-group-name", children: home }), boards.map((b) => (_jsxs("button", { className: "admin-scope", "aria-current": (scope.kind === 'board' && scope.id === b.id) || undefined, onClick: () => setScope({ kind: 'board', id: b.id }), title: `${b.path.join(' / ')} · ${fmtBytes(b.size)}`, style: { paddingLeft: 10 + Math.min(4, b.path.length - 2) * 12 }, children: [_jsx(Folder, { ...ICON }), _jsx("span", { children: b.path.length > 1 ? b.path[b.path.length - 1] : 'Home' }), _jsx("em", { children: b.count })] }, b.id)))] }, home)))] }), _jsxs("main", { className: "admin-main", children: [_jsxs("div", { className: "admin-main-head", children: [_jsx("h2", { children: scopeTitle }), _jsxs("span", { children: [shown.length, " ", shown.length === 1 ? 'file' : 'files', " \u00B7 ", fmtBytes(shown.reduce((n, f) => n + f.size + f.extra, 0))] }), scope.kind === 'unused' && unused.length > 0 && (_jsxs("button", { className: "admin-ghost", disabled: sweeping, title: "Delete every file that isn't on a board (except ones uploaded in the last couple of minutes)", onClick: async () => {
                                            setSweeping(true);
                                            try {
                                                const r = await onSweep();
                                                setNotice(r.deleted ? `Cleared ${r.deleted} unused ${r.deleted === 1 ? 'file' : 'files'} · ${fmtBytes(r.freed)} freed` : 'Nothing to clear yet');
                                            }
                                            finally {
                                                setSweeping(false);
                                            }
                                        }, children: [_jsx(Trash2, { ...ICON }), " ", sweeping ? 'Clearing…' : 'Clear unused now'] }))] }), scope.kind === 'unused' && data && (_jsxs("p", { className: "admin-hint", children: ["Files that aren't on any board are deleted automatically once they've been unused for ", data.graceMinutes >= 120 ? `${Math.round(data.graceMinutes / 60)} hours` : `${data.graceMinutes} minutes`, "."] })), error && _jsx("p", { className: "admin-error", role: "alert", children: error }), notice && _jsx("p", { className: "admin-notice", role: "status", onAnimationEnd: () => setNotice(null), children: notice }), _jsxs("div", { className: "admin-table-wrap", children: [_jsxs("table", { className: "admin-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "admin-col-check", children: _jsx("input", { type: "checkbox", "aria-label": "Select all shown", checked: allChecked, onChange: () => setChecked(allChecked ? new Set() : new Set(shown.map((f) => f.file))) }) }), _jsx("th", { className: "admin-col-thumb", "aria-label": "Preview" }), _jsx(Th, { k: "name", children: "Name" }), _jsx(Th, { k: "size", className: "admin-col-num", children: "Size" }), _jsx(Th, { k: "by", children: "Uploaded by" }), _jsx(Th, { k: "at", children: "Uploaded" }), _jsx("th", { children: "On" }), _jsx("th", { className: "admin-col-actions", "aria-label": "Actions" })] }) }), _jsx("tbody", { children: shown.map((f) => {
                                                    const boardsOn = [...new Set(f.uses.map((u) => u.boardId))];
                                                    return (_jsxs("tr", { "data-checked": checked.has(f.file) || undefined, "data-open": open === f.file || undefined, onClick: () => setOpen(f.file), children: [_jsx("td", { className: "admin-col-check", onClick: (e) => e.stopPropagation(), children: _jsx("input", { type: "checkbox", "aria-label": `Select ${f.name}`, checked: checked.has(f.file), onChange: () => toggle(f.file) }) }), _jsx("td", { className: "admin-col-thumb", children: _jsx(Thumb, { f: f }) }), _jsxs("td", { className: "admin-col-name", children: [_jsx("span", { className: "admin-name", title: f.name, children: f.name }), _jsxs("span", { className: "admin-sub", children: [f.type === 'video' ? _jsx(FileVideo, { size: 12, strokeWidth: 2, "aria-hidden": "true" }) : _jsx(FileImage, { size: 12, strokeWidth: 2, "aria-hidden": "true" }), " ", f.file] })] }), _jsx("td", { className: "admin-col-num", title: f.extra ? `${fmtBytes(f.size)} + ${fmtBytes(f.extra)} posters / proxy` : undefined, children: fmtBytes(f.size + f.extra) }), _jsx("td", { children: _jsx(Who, { id: f.by, guess: f.byGuess, users: data.users }) }), _jsx("td", { title: fmtFull(f.at), children: fmtWhen(f.at) }), _jsx("td", { className: "admin-col-on", children: boardsOn.length ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "admin-chip", title: boardPath(boardsOn[0]).join(' / '), children: boardPath(boardsOn[0]).slice(-1)[0] }), boardsOn.length > 1 && _jsxs("span", { className: "admin-chip admin-chip-more", children: ["+", boardsOn.length - 1] })] })) : (_jsxs("span", { className: "admin-chip admin-chip-none", title: f.deletesAt ? `Not on any board; deleted automatically ${fmtFull(f.deletesAt)}` : undefined, children: ["Unused", f.deletesAt ? ` · clears ${fmtUntil(f.deletesAt)}` : ''] })) }), _jsxs("td", { className: "admin-col-actions", onClick: (e) => e.stopPropagation(), children: [_jsx("a", { className: "admin-icon-btn", href: f.url, target: "_blank", rel: "noopener noreferrer", title: "Open", "aria-label": "Open", children: _jsx(ExternalLink, { ...ICON }) }), _jsx("a", { className: "admin-icon-btn", href: f.url, download: f.name, title: "Download", "aria-label": "Download", children: _jsx(Download, { ...ICON }) }), _jsx("button", { className: "admin-icon-btn admin-danger", onClick: () => setConfirm([f.file]), title: "Delete", "aria-label": "Delete", children: _jsx(Trash2, { ...ICON }) })] })] }, f.file));
                                                }) })] }), data && !shown.length && _jsxs("p", { className: "admin-empty", children: ["Nothing here", query ? ` matching “${query}”` : '', "."] }), !data && !error && _jsx("p", { className: "admin-empty", children: "Loading\u2026" })] }), checked.size > 0 && (_jsxs("div", { className: "admin-bulk", role: "toolbar", "aria-label": "Selected files", children: [_jsxs("span", { children: [checked.size, " selected \u00B7 ", fmtBytes(selectedSize)] }), _jsx("button", { className: "admin-ghost", onClick: () => setChecked(new Set()), children: "Clear" }), _jsxs("button", { className: "admin-danger-btn", onClick: () => setConfirm([...checked]), children: [_jsx(Trash2, { ...ICON }), " Delete ", checked.size] })] }))] }), detail && data && (_jsx(Detail, { f: detail, data: data, onClose: () => setOpen(null), onDelete: () => setConfirm([detail.file]) }))] }), confirm && data && (_jsx(ConfirmDelete, { files: files.filter((f) => confirm.includes(f.file)), boardPath: boardPath, onCancel: () => setConfirm(null), onConfirm: async () => {
                    const r = await onDelete(confirm);
                    setChecked((c) => { const n = new Set(c); for (const x of confirm)
                        n.delete(x); return n; });
                    if (open && confirm.includes(open))
                        setOpen(null);
                    setConfirm(null);
                    setNotice(`Deleted ${r.deleted} ${r.deleted === 1 ? 'file' : 'files'} · ${fmtBytes(r.freed)} freed${r.cardsDeleted ? ` · ${r.cardsDeleted} ${r.cardsDeleted === 1 ? 'card' : 'cards'} removed` : ''}${r.cardsUpdated ? ` · ${r.cardsUpdated} ${r.cardsUpdated === 1 ? 'card' : 'cards'} updated` : ''}`);
                } }))] }));
}
function Thumb({ f }) {
    const src = f.type === 'image' ? f.url : f.poster;
    return (_jsx("span", { className: "admin-thumb", "data-type": f.type, children: src ? _jsx("img", { src: src, alt: "", loading: "lazy", decoding: "async" }) : f.type === 'video' ? _jsx(FileVideo, { size: 18, strokeWidth: 1.8, "aria-hidden": "true" }) : _jsx(FileImage, { size: 18, strokeWidth: 1.8, "aria-hidden": "true" }) }));
}
function Who({ id, guess, users }) {
    if (!id)
        return _jsx("span", { className: "admin-who admin-dim", children: "Unknown" });
    const p = users[id];
    return (_jsxs("span", { className: "admin-who", title: guess ? 'Not recorded (uploaded before uploads were tracked): this is the owner of the board it’s on' : undefined, children: [_jsx(Avatar, { profile: { name: p?.name ?? '?', icon: p?.icon ?? null }, color: personalColor(id), size: 20 }), _jsx("span", { children: p?.name ?? 'Unknown user' }), guess && _jsx("span", { className: "admin-dim", children: "(board owner)" })] }));
}
function Detail({ f, data, onClose, onDelete }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);
    const path = (id) => data.boards[id]?.path ?? ['(unknown board)'];
    return (_jsxs("aside", { className: "admin-detail", "aria-label": "File details", children: [_jsxs("div", { className: "admin-detail-head", children: [_jsx("h3", { title: f.name, children: f.name }), _jsx("button", { className: "admin-icon-btn", onClick: onClose, "aria-label": "Close details", children: _jsx(X, { ...ICON }) })] }), _jsx("div", { className: "admin-preview", children: f.type === 'video'
                    ? _jsx("video", { src: f.url, poster: f.poster ?? undefined, controls: true, preload: "metadata" }, f.url)
                    : _jsx("img", { src: f.url, alt: f.name }) }), _jsxs("dl", { className: "admin-facts", children: [_jsx("dt", { children: "Uploaded by" }), _jsx("dd", { children: _jsx(Who, { id: f.by, guess: f.byGuess, users: data.users }) }), _jsx("dt", { children: "Uploaded" }), _jsxs("dd", { children: [fmtFull(f.at), !f.known && _jsx("span", { className: "admin-dim", children: " (file date)" })] }), _jsx("dt", { children: "Size" }), _jsxs("dd", { children: [fmtBytes(f.size), f.extra > 0 && _jsxs("span", { className: "admin-dim", children: [" + ", fmtBytes(f.extra), " posters / proxy"] })] }), _jsx("dt", { children: "Type" }), _jsx("dd", { children: f.mime ?? f.file.split('.').pop()?.toUpperCase() }), _jsx("dt", { children: "File" }), _jsx("dd", { className: "admin-mono", children: f.file })] }), _jsx("h4", { children: f.uses.length ? `On ${f.uses.length} ${f.uses.length === 1 ? 'card' : 'cards'}` : 'Not on any board' }), !f.uses.length && f.deletesAt && _jsxs("p", { className: "admin-hint admin-hint-tight", children: ["Deleted automatically ", fmtUntil(f.deletesAt), " (", fmtFull(f.deletesAt), ") unless it's put on a board."] }), _jsx("ul", { className: "admin-uses", children: f.uses.map((u) => (_jsxs("li", { children: [_jsx("span", { className: "admin-uses-path", children: path(u.boardId).join(' / ') }), _jsxs("span", { className: "admin-uses-card", children: [u.name || 'Untitled', u.versions > 1 && _jsxs("span", { className: "admin-chip", children: ["v", u.version, u.current ? ' · current' : ''] })] })] }, `${u.itemId}-${u.version}`))) }), _jsxs("div", { className: "admin-detail-actions", children: [_jsxs("a", { className: "admin-ghost", href: f.url, target: "_blank", rel: "noopener noreferrer", children: [_jsx(ExternalLink, { ...ICON }), " Open"] }), _jsxs("a", { className: "admin-ghost", href: f.url, download: f.name, children: [_jsx(Download, { ...ICON }), " Download"] }), _jsxs("button", { className: "admin-danger-btn", onClick: onDelete, children: [_jsx(Trash2, { ...ICON }), " Delete"] })] })] }));
}
function ConfirmDelete({ files, boardPath, onCancel, onConfirm }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);
    // What happens to the cards that use them.
    const gone = new Set(files.map((f) => f.file));
    const effects = [];
    for (const f of files)
        for (const u of f.uses) {
            const where = boardPath(u.boardId).slice(-1)[0];
            if (!u.current)
                effects.push(`v${u.version} is dropped from “${u.name || 'Untitled'}” on ${where}`);
            else if (u.versions > 1)
                effects.push(`“${u.name || 'Untitled'}” on ${where} goes back to v${u.version - 1}`);
            else
                effects.push(`“${u.name || 'Untitled'}” is removed from ${where}, with its comments`);
        }
    const size = files.reduce((n, f) => n + f.size + f.extra, 0);
    return (_jsx("div", { className: "admin-modal", role: "alertdialog", "aria-modal": "true", "aria-label": "Delete files", onPointerDown: (e) => { if (e.target === e.currentTarget)
            onCancel(); }, children: _jsxs("div", { className: "admin-modal-card", children: [_jsxs("h3", { children: ["Delete ", files.length === 1 ? `“${files[0].name}”` : `${files.length} files`, "?"] }), _jsxs("p", { children: [fmtBytes(size), " will be freed. This can\u2019t be undone."] }), effects.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { className: "admin-modal-sub", children: "On the boards:" }), _jsxs("ul", { className: "admin-effects", children: [effects.slice(0, 8).map((e, i) => _jsx("li", { children: e }, i)), effects.length > 8 && _jsxs("li", { className: "admin-dim", children: ["and ", effects.length - 8, " more"] })] })] })), gone.size > 0 && error && _jsx("p", { className: "admin-error", children: error }), _jsxs("div", { className: "admin-modal-actions", children: [_jsx("button", { className: "admin-ghost", onClick: onCancel, autoFocus: true, children: "Cancel" }), _jsxs("button", { className: "admin-danger-btn", disabled: busy, onClick: async () => { setBusy(true); try {
                                await onConfirm();
                            }
                            catch (e) {
                                setError(e.message);
                                setBusy(false);
                            } }, children: [_jsx(Trash2, { ...ICON }), " ", busy ? 'Deleting…' : 'Delete'] })] })] }) }));
}
