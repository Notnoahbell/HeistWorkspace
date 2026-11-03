// Connects the board store to the sync server (/sync on the same host).
//
// - On connect the server says who you are; your local Home moves to that
//   user's Home, and anything local the server hasn't seen gets uploaded.
// - The server then sends everything you can see (your tree + boards shared
//   with you), which replaces the local copy.
// - After that, every local change is diffed and sent as item upserts and
//   deletes; remote ones are applied without echoing back.
// - Cursor position and cursor chat go out at most once per frame.
//
// Offline (no server), the app just works locally as before.

import type { Point } from '../canvas/camera';
import { useBoard, type Item } from '../board/store';
import { currentBoardId, refreshBoard, subscribeBoard } from '../board/nav';
import { homeId, isHome, session, setSessionUser } from '../session';
import { usePresence, type Peer, type Profile } from './presence';
import { newId } from '../lib/id';

type ServerMsg =
  | { t: 'welcome'; userId: string; connId: string; profile: Profile }
  | { t: 'users'; users: Profile[] }
  | { t: 'snapshot'; items: Item[] }
  | { t: 'ops'; upserts: Item[]; deletes: string[] }
  | { t: 'you'; color: string | null }
  | ({ t: 'presence'; at: Point | null } & Omit<Peer, 'at'>)
  | { t: 'leave'; connId: string };

let ws: WebSocket | null = null;
let ready = false; // true once the first snapshot is in
let applyingRemote = false;
let retry = 0;

const MSG_LIMIT = 60;
const DEVICE_KEY = 'heist:device';
/** Shared boards whose Home shortcut you removed (so it isn't re-added). */
const DISMISSED_KEY = 'heist:dismissed-shares';
const PROFILE_KEY = 'heist:profile';

function socketUrl() {
  const url = new URL('/sync', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('device', deviceId());
  // Testing aid: ?as=<name> makes this tab a different user in the same browser.
  const as = new URLSearchParams(location.search).get('as');
  if (as) url.searchParams.set('as', as);
  return url.href;
}

/** This browser's anonymous id (no logins yet). */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = newId(24);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Your own name/icon, kept so it can be restored if the server forgot it. */
function savedProfile(): Partial<Profile> | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'); } catch { return null; }
}

const send = (msg: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

/** Apply a change that came from the server without sending it back. */
function remote(fn: (items: Record<string, Item>) => Record<string, Item>) {
  applyingRemote = true;
  try {
    useBoard.setState((s) => ({ items: fn(s.items) }));
  } finally {
    applyingRemote = false;
  }
}

/** Items in this user's own Home tree (what they can upload). */
function ownItems(items: Record<string, Item>): Item[] {
  const home = homeId();
  const mine = (it: Item) => {
    for (let b: string | undefined = it.boardId, guard = 0; b && guard < 64; guard++) {
      if (isHome(b)) return b === home;
      b = items[b]?.boardId;
    }
    return false;
  };
  return Object.values(items).filter(mine);
}

function onMessage(m: ServerMsg) {
  switch (m.t) {
    case 'welcome': {
      const prev = setSessionUser(m.userId);
      usePresence.setState({ me: m.profile, status: 'online' });
      // Local work done as someone else (e.g. "local", before first connecting) becomes yours.
      if (prev !== m.userId) {
        const from = homeId(prev), to = homeId(m.userId);
        remote((items) => {
          const next = { ...items };
          for (const it of Object.values(items)) if (it.boardId === from) next[it.id] = { ...it, boardId: to } as Item;
          return next;
        });
      }
      refreshBoard();
      send({ t: 'push', items: ownItems(useBoard.getState().items) });
      // A server that restarted with an empty disk forgets names: put yours back.
      const saved = savedProfile();
      if (saved && (saved.name !== m.profile.name || saved.icon !== m.profile.icon)) setProfile(saved);
      break;
    }
    case 'users':
      usePresence.setState((s) => ({
        users: Object.fromEntries(m.users.map((u) => [u.id, u])),
        me: m.users.find((u) => u.id === session.userId) ?? s.me,
      }));
      break;
    case 'snapshot':
      remote(() => Object.fromEntries(m.items.map((it) => [it.id, it])));
      ready = true;
      syncShortcuts();
      refreshBoard();
      sendPresenceNow();
      break;
    case 'ops':
      remote((items) => {
        const next = { ...items };
        for (const it of m.upserts) next[it.id] = it;
        for (const id of m.deletes) delete next[id];
        return next;
      });
      syncShortcuts();
      break;
    case 'you':
      usePresence.setState({ myColor: m.color });
      break;
    case 'presence': {
      const peer: Peer = { ...m, at: m.at };
      usePresence.setState((s) => ({ peers: { ...s.peers, [m.connId]: peer } }));
      break;
    }
    case 'leave':
      usePresence.setState((s) => {
        const { [m.connId]: _gone, ...peers } = s.peers;
        return { peers };
      });
      break;
  }
}

export function connect() {
  usePresence.setState({ status: 'connecting' });
  try {
    ws = new WebSocket(socketUrl());
  } catch {
    scheduleRetry();
    return;
  }
  ws.onopen = () => { retry = 0; };
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch (err) { console.warn('[sync]', err); }
  };
  ws.onclose = () => {
    ws = null;
    ready = false;
    usePresence.setState({ status: 'offline', peers: {}, myColor: null });
    scheduleRetry();
  };
}

function scheduleRetry() {
  const delay = Math.min(15000, 500 * 2 ** retry++);
  setTimeout(connect, delay);
}

// --- Shortcuts on your Home to boards shared with you ------------------------------

/** Same id in every tab, so two tabs can't both add a shortcut for the same board. */
const shortcutId = (boardId: string) => `link-${session.userId}-${boardId}`;

function dismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); } catch { return []; }
}

/** Removing a shortcut by hand: remember, so it isn't put back. */
export function dismissShortcut(boardId: string) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissed(), boardId])])); } catch {}
}

/**
 * Every board shared with you gets a shortcut tile on your Home (to the right
 * of what's there), and shortcuts to boards you've lost access to go away.
 */
function syncShortcuts() {
  const items = useBoard.getState().items;
  const home = homeId();
  const skip = new Set(dismissed());
  // Shared roots: boards whose parent you can't see (someone else's board or Home).
  const roots = Object.values(items).filter((it) => it.kind === 'board' && !it.linkTo && it.boardId !== home && !items[it.boardId]);
  const linked = new Set(Object.values(items).flatMap((it) => (it.kind === 'board' && it.linkTo ? [it.linkTo] : [])));
  const add = roots.filter((r) => !linked.has(r.id) && !skip.has(r.id));
  const stale = Object.values(items).filter((it) => it.kind === 'board' && it.linkTo && it.boardId === home && !items[it.linkTo]);
  if (!add.length && !stale.length) return;

  // Lay new shortcuts out in a row to the right of everything on your Home.
  const mine = Object.values(items).filter((it) => it.boardId === home);
  let x = mine.length ? Math.max(...mine.map((it) => it.x + it.w)) + 48 : 0;
  const y = mine.length ? Math.min(...mine.map((it) => it.y)) : 0;
  x = Math.round(x / 16) * 16;
  const store = useBoard.getState();
  for (const r of add) {
    const id = shortcutId(r.id);
    if (items[id]) continue;
    store.insertItems([{ id, kind: 'board', boardId: home, x, y, w: 160, z: 0, title: '', color: null, icon: null, parentId: null, linkTo: r.id }]);
    x += 192;
  }
  for (const s of stale) store.removeItem(s.id);
}

// --- Local edits → server -------------------------------------------------------

useBoard.subscribe((state, prev) => {
  if (applyingRemote || !ready || state.items === prev.items) return;
  const upserts: Item[] = [];
  const deletes: string[] = [];
  for (const [id, it] of Object.entries(state.items)) if (prev.items[id] !== it) upserts.push(it);
  for (const id of Object.keys(prev.items)) if (!(id in state.items)) deletes.push(id);
  if (upserts.length || deletes.length) send({ t: 'ops', upserts, deletes });
});

// --- Presence → server -------------------------------------------------------------

let cursor: Point | null = null;
let chat = '';
let frame = 0;

function sendPresenceNow() {
  frame = 0;
  if (!ready) return;
  send({ t: 'presence', boardId: currentBoardId(), at: cursor, msg: chat });
}

const schedule = () => { if (!frame) frame = requestAnimationFrame(sendPresenceNow); };

// New board: forget the old board's cursors (the server re-sends whoever's here).
subscribeBoard(() => {
  usePresence.setState({ peers: {}, myColor: null });
  cursor = null;
  sendPresenceNow();
});

/** Your cursor in world space (null = off the canvas). Not smoothed or interpolated. */
export function setCursor(p: Point | null) {
  cursor = p;
  schedule();
}

/** Cursor chat text, shown to others in place of your name ('' = name again). */
export function setChat(text: string) {
  chat = text.slice(0, MSG_LIMIT);
  schedule();
}

export const CHAT_LIMIT = MSG_LIMIT;

export function setProfile(patch: Partial<Pick<Profile, 'name' | 'icon'>>) {
  send({ t: 'profile', ...patch });
  usePresence.setState((s) => ({ me: s.me ? { ...s.me, ...patch } : s.me }));
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...savedProfile(), ...patch }));
  } catch {}
}
