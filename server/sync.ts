// Real-time sync + presence over WebSocket (/sync).
//
// The server holds every item, keyed by id, and is the source of truth.
// Edits are whole-item upserts/deletes (last write wins per item), routed to
// everyone who can see the item. Presence (cursors, cursor chat) is ephemeral
// and routed per board.
//
// Identity (testing only, no logins): each browser keeps a random anonymous
// device id and sends it on connect; the user id is a hash of it. (IP isn't
// enough online: everyone in one office shares a public address.) Without a
// device id it falls back to the IP. `?as=<name>` mixes into the hash, to be
// several users from one browser. Ids don't depend on server state, so they
// survive the server restarting with an empty disk.
//
// Access: you can see your own Home tree, plus any board shared with you
// (`sharedWith` on a board) and everything inside it.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

interface Item {
  id: string;
  kind: string;
  boardId: string;
  sharedWith?: string[];
  [key: string]: unknown;
}

interface Profile { id: string; name: string; icon: string | null }

interface Db {
  salt: string;
  items: Record<string, Item>;
  profiles: Record<string, Profile>;
}

interface Conn {
  id: string;
  userId: string;
  boardId: string | null;
  color: string | null;
  presence: { x: number; y: number } | null;
  msg: string;
}

/** Cursor colours, chosen to be distinct from each other. */
const PALETTE = [
  '#E5484D', '#F76B15', '#E2A300', '#30A46C', '#12A594', '#0090FF',
  '#3E63DD', '#8E4EC6', '#D6409F', '#7C5E46', '#5F6B7A', '#29A383',
];

const ADJECTIVES = [
  'Teal', 'Amber', 'Coral', 'Indigo', 'Olive', 'Plum', 'Slate', 'Saffron', 'Jade', 'Rust', 'Azure', 'Mint',
  'Copper', 'Crimson', 'Ivory', 'Cobalt', 'Sage', 'Ochre', 'Violet', 'Umber', 'Pearl', 'Scarlet', 'Lilac', 'Moss',
];
const ANIMALS = [
  'Otter', 'Heron', 'Lynx', 'Falcon', 'Badger', 'Marten', 'Ibis', 'Gecko', 'Orca', 'Hare', 'Wren', 'Bison',
  'Puffin', 'Ocelot', 'Tapir', 'Kestrel', 'Narwhal', 'Pika', 'Stoat', 'Toucan', 'Quokka', 'Mole', 'Crane', 'Newt',
];
const MSG_LIMIT = 60;
const NAME_LIMIT = 32;

const isHome = (id: string) => id.startsWith('home:');

export function createSyncServer({ dataFile }: { dataFile: string }) {
  const db: Db = load();
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<WebSocket, Conn>();

  function load(): Db {
    try {
      if (existsSync(dataFile)) return JSON.parse(readFileSync(dataFile, 'utf8')) as Db;
    } catch (e) {
      console.warn('[sync] could not read', dataFile, e);
    }
    return { salt: randomBytes(16).toString('hex'), items: {}, profiles: {} };
  }

  let saveTimer: NodeJS.Timeout | null = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      mkdirSync(dirname(dataFile), { recursive: true });
      writeFileSync(dataFile, JSON.stringify(db));
    }, 500);
  }

  // --- Access ------------------------------------------------------------------

  /** Users who can see things on board `boardId` (walking up to its Home). */
  function accessFromBoard(boardId: string | undefined): Set<string> {
    const users = new Set<string>();
    for (let b = boardId, guard = 0; b && guard < 64; guard++) {
      if (isHome(b)) { users.add(b.slice(5)); break; }
      const board = db.items[b];
      if (!board) break;
      for (const u of board.sharedWith ?? []) users.add(u);
      b = board.boardId;
    }
    return users;
  }

  const accessOf = (it: Item) => {
    const users = accessFromBoard(it.boardId);
    if (it.kind === 'board') for (const u of it.sharedWith ?? []) users.add(u);
    return users;
  };

  /** The user whose Home this item ultimately sits in. */
  function ownerOf(it: Item): string | null {
    for (let b: string | undefined = it.boardId, guard = 0; b && guard < 64; guard++) {
      if (isHome(b)) return b.slice(5);
      b = db.items[b]?.boardId;
    }
    return null;
  }

  const visibleTo = (userId: string) => Object.values(db.items).filter((it) => accessOf(it).has(userId));

  // --- Messaging -------------------------------------------------------------------

  const send = (ws: WebSocket, msg: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const connsOf = (userId: string) => [...conns].filter(([, c]) => c.userId === userId).map(([ws]) => ws);

  function snapshotTo(userId: string) {
    const items = visibleTo(userId);
    for (const ws of connsOf(userId)) send(ws, { t: 'snapshot', items });
  }

  function sendUsers(to?: WebSocket) {
    const msg = { t: 'users', users: Object.values(db.profiles) };
    if (to) send(to, msg);
    else for (const ws of conns.keys()) send(ws, msg);
  }

  // --- Edits ---------------------------------------------------------------------

  /** Insert items a client had locally that the server hasn't seen (first sync). */
  function push(userId: string, list: Item[]) {
    let pending = list.filter((it) => it && typeof it.id === 'string' && !db.items[it.id]);
    // Parents may arrive after children: keep going while something gets placed.
    for (let progress = true; progress && pending.length;) {
      progress = false;
      pending = pending.filter((it) => {
        if (!accessFromBoard(it.boardId).has(userId)) return true;
        db.items[it.id] = it;
        progress = true;
        return false;
      });
    }
    save();
  }

  function ops(from: WebSocket, userId: string, upserts: Item[], deletes: string[]) {
    const out = new Map<WebSocket, { upserts: Item[]; deletes: string[] }>();
    const queue = (users: Set<string>, kind: 'upserts' | 'deletes', value: Item | string) => {
      for (const [ws, c] of conns) {
        if (ws === from || !users.has(c.userId)) continue;
        const o = out.get(ws) ?? { upserts: [], deletes: [] };
        (o[kind] as unknown[]).push(value);
        out.set(ws, o);
      }
    };
    let sharingChanged = false;

    for (const next of upserts) {
      if (!next || typeof next.id !== 'string' || typeof next.boardId !== 'string') continue;
      const old = db.items[next.id];
      if (old && !accessOf(old).has(userId)) continue;
      if (!accessFromBoard(next.boardId).has(userId)) continue;
      // Something shared with you can't be moved out of its owner's tree…
      if (old && old.boardId !== next.boardId && !accessFromBoard(old.boardId).has(userId)) continue;
      // …and only a board's owner decides who it's shared with.
      if (next.kind === 'board') {
        const owner = old ? ownerOf(old) : userId;
        if (owner !== userId) next.sharedWith = old?.sharedWith ?? [];
        else next.sharedWith = (Array.isArray(next.sharedWith) ? next.sharedWith : []).filter((u) => typeof u === 'string' && u !== userId);
        if (JSON.stringify(old?.sharedWith ?? []) !== JSON.stringify(next.sharedWith) || old?.boardId !== next.boardId) {
          sharingChanged = true;
        }
      }
      const before = old ? accessOf(old) : new Set<string>();
      db.items[next.id] = next;
      queue(new Set([...before, ...accessOf(next)]), 'upserts', next);
    }

    for (const id of deletes) {
      const old = db.items[id];
      if (!old || !accessOf(old).has(userId)) continue;
      if (!accessFromBoard(old.boardId).has(userId)) continue; // can't delete a board shared with you
      if (old.kind === 'board' && old.sharedWith?.length) sharingChanged = true;
      const users = accessOf(old);
      delete db.items[id];
      queue(users, 'deletes', id);
    }

    for (const [ws, o] of out) send(ws, { t: 'ops', ...o });
    // Who can see what changed: resend everyone's view (small team, small data).
    if (sharingChanged) for (const u of new Set([...conns.values()].map((c) => c.userId))) snapshotTo(u);
    save();
  }

  // --- Presence --------------------------------------------------------------------

  function peersOn(boardId: string | null, except: WebSocket) {
    return [...conns].filter(([ws, c]) => ws !== except && boardId && c.boardId === boardId);
  }

  function presenceMsg(c: Conn) {
    const p = db.profiles[c.userId];
    return { t: 'presence', connId: c.id, userId: c.userId, name: p?.name, icon: p?.icon ?? null, color: c.color, boardId: c.boardId, at: c.presence, msg: c.msg };
  }

  /** A free colour on this board (random among the unused ones). */
  function pickColor(boardId: string, except: WebSocket) {
    const used = new Set(peersOn(boardId, except).map(([, c]) => c.color));
    const free = PALETTE.filter((c) => !used.has(c));
    const pool = free.length ? free : PALETTE;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function leaveBoard(ws: WebSocket, c: Conn) {
    for (const [peer] of peersOn(c.boardId, ws)) send(peer, { t: 'leave', connId: c.id });
  }

  function presence(ws: WebSocket, c: Conn, boardId: string | null, at: { x: number; y: number } | null, msg: string) {
    // Only boards this user can actually see.
    if (boardId && !isHome(boardId) && !(db.items[boardId] && accessOf(db.items[boardId]).has(c.userId))) boardId = null;
    if (boardId && isHome(boardId) && boardId !== `home:${c.userId}`) boardId = null;
    if (boardId !== c.boardId) {
      leaveBoard(ws, c);
      c.boardId = boardId;
      c.color = boardId ? pickColor(boardId, ws) : null;
      send(ws, { t: 'you', color: c.color });
      // Catch up on who's already here.
      for (const [, peer] of peersOn(boardId, ws)) send(ws, presenceMsg(peer));
    }
    c.presence = at;
    c.msg = msg.slice(0, MSG_LIMIT);
    for (const [peer] of peersOn(c.boardId, ws)) send(peer, presenceMsg(c));
  }

  // --- Connections -------------------------------------------------------------------

  function userIdFor(req: IncomingMessage) {
    const params = new URL(req.url ?? '/', 'http://local').searchParams;
    const device = (params.get('device') ?? '').slice(0, 64);
    const as = (params.get('as') ?? '').slice(0, 64);
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    const who = device ? `device:${device}` : `ip:${db.salt}|${ip}`;
    return 'u' + createHash('sha256').update(`heist|${who}|${as}`).digest('hex').slice(0, 12);
  }

  /** A friendly default name from the id, skipping names someone already has. */
  function defaultProfile(userId: string): Profile {
    const taken = new Set(Object.values(db.profiles).map((p) => p.name));
    const total = ADJECTIVES.length * ANIMALS.length;
    const start = parseInt(userId.slice(1, 9), 16) % total; // plain arithmetic: values reach 2^32
    let name = '';
    for (let k = 0; k < total; k++) {
      const n = (start + k) % total;
      name = `${ADJECTIVES[n % ADJECTIVES.length]} ${ANIMALS[Math.floor(n / ADJECTIVES.length)]}`;
      if (!taken.has(name)) break;
    }
    return { id: userId, name, icon: null };
  }

  function onConnect(ws: WebSocket, req: IncomingMessage) {
    const userId = userIdFor(req);
    const isNew = !db.profiles[userId];
    const profile = (db.profiles[userId] ??= defaultProfile(userId));
    const conn: Conn = { id: randomBytes(6).toString('hex'), userId, boardId: null, color: null, presence: null, msg: '' };
    conns.set(ws, conn);
    if (isNew) save();
    send(ws, { t: 'welcome', userId, connId: conn.id, profile });
    sendUsers(isNew ? undefined : ws);

    ws.on('message', (raw) => {
      let m: { t?: string; [k: string]: unknown };
      try { m = JSON.parse(String(raw)); } catch { return; }
      switch (m.t) {
        case 'push':
          push(userId, Array.isArray(m.items) ? m.items as Item[] : []);
          snapshotTo(userId);
          break;
        case 'ops':
          ops(ws, userId, Array.isArray(m.upserts) ? m.upserts as Item[] : [], Array.isArray(m.deletes) ? m.deletes as string[] : []);
          break;
        case 'presence': {
          const at = m.at && typeof m.at === 'object' ? m.at as { x: number; y: number } : null;
          presence(ws, conn, typeof m.boardId === 'string' ? m.boardId : null, at, typeof m.msg === 'string' ? m.msg : '');
          break;
        }
        case 'profile': {
          const p = db.profiles[userId];
          if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.trim().slice(0, NAME_LIMIT);
          if (m.icon === null || typeof m.icon === 'string') p.icon = m.icon as string | null;
          save();
          sendUsers();
          for (const [peer] of peersOn(conn.boardId, ws)) send(peer, presenceMsg(conn));
          break;
        }
      }
    });

    ws.on('close', () => {
      leaveBoard(ws, conn);
      conns.delete(ws);
    });
  }

  /** Hand WebSocket upgrades for /sync to us. Returns false for other paths. */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!req.url?.startsWith('/sync')) return false;
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, req));
    return true;
  }

  return { handleUpgrade };
}
