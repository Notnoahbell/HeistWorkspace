// Other people's cursors (with a name / message bubble), and cursor chat:
// press "/" to type a short message that shows beside your cursor for others.

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { camera } from '../canvas/camera';
import { isTyping } from '../canvas/input';
import { useBoardId } from '../board/nav';
import { CURSOR_PATH } from '../lib/cursor';
import { useMyColor, usePresence, type Peer } from '../sync/presence';
import { useBoard } from '../board/store';
import { useLayout } from '../board/layout';
import { itemSize, posOf } from '../board/actions';
import { Avatar } from './Collab';
import { CHAT_LIMIT, setChat, setCursor } from '../sync/client';

export function CursorShape({ color }: { color: string }) {
  return (
    <svg className="peer-cursor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d={CURSOR_PATH} fill={color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Everyone else's cursor on this board, exactly where they report it (no smoothing). */
export function PeerCursors() {
  const boardId = useBoardId();
  const peers = usePresence(useShallow((s) => Object.values(s.peers).filter((p) => p.boardId === boardId && p.at)));
  useSyncExternalStore(camera.subscribe, () => camera.version);

  return (
    <div className="presence-layer" aria-hidden="true">
      {peers.map((p) => {
        const at = camera.worldToScreen(p.at!.x, p.at!.y);
        return (
          <div key={p.connId} className="peer" style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)` }}>
            <CursorShape color={p.color} />
            <span className="peer-bubble" data-msg={!!p.msg} style={{ background: p.color }}>{p.msg || p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Padding between an item and the outline round it (matches your own selection's). */
const SEL_GAP = 3;
const SEL_AVATAR = 20;

/**
 * What everyone else has selected: an outline in their colour round each
 * thing, with their avatar on its top-right corner (several people on the
 * same thing line up from the corner leftwards).
 */
export function PeerSelections() {
  const boardId = useBoardId();
  const peers = usePresence(useShallow((s) => Object.values(s.peers).filter((p) => p.boardId === boardId && p.sel?.length)));
  const items = useBoard((s) => s.items);
  useLayout((s) => s.slots);
  useLayout((s) => s.heights);
  useSyncExternalStore(camera.subscribe, () => camera.version);
  if (!peers.length) return null;

  // Who has each item selected, in a steady order.
  const by = new Map<string, Peer[]>();
  for (const p of [...peers].sort((a, b) => a.connId.localeCompare(b.connId))) {
    for (const id of p.sel!) {
      const it = items[id];
      if (!it || it.boardId !== boardId) continue;
      const list = by.get(id) ?? [];
      if (!list.some((q) => q.userId === p.userId)) list.push(p);
      by.set(id, list);
    }
  }

  return (
    <div className="presence-layer peer-sel-layer" aria-hidden="true">
      {[...by].map(([id, who]) => {
        const it = items[id];
        const o = posOf(it), { w, h } = itemSize(it);
        const a = camera.worldToScreen(o.x, o.y);
        const pad = SEL_GAP;
        return (
          <div
            key={id}
            className="peer-sel"
            style={{
              transform: `translate3d(${a.x - pad}px, ${a.y - pad}px, 0)`,
              width: w * camera.z + pad * 2,
              height: h * camera.z + pad * 2,
              '--peer': who[0].color,
            } as CSSProperties}
          >
            <span className="peer-sel-who">
              {who.map((p) => (
                <span key={p.userId} title={`${p.name} has this selected`}>
                  <Avatar profile={{ name: p.name, icon: p.icon }} color={p.color} size={SEL_AVATAR} />
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Your cursor position goes out as you move; off the canvas it's hidden.
 * "/" opens cursor chat beside your pointer: others see the text in place of
 * your name. Enter, Esc, clicking away or clearing it puts your name back.
 */
export function CursorChat() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const closing = useRef(false);
  const color = useMyColor();
  const online = usePresence((s) => s.status === 'online');

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (open) setPos(pointer.current);
      const overCanvas = (e.target as Element | null)?.closest?.('.viewport');
      setCursor(overCanvas ? camera.clientToWorld(e.clientX, e.clientY) : null);
    };
    const onLeave = () => setCursor(null);
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || open || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setPos(pointer.current);
      setText('');
      setChat('');
      closing.current = false;
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !online) return null;

  const close = () => {
    // Removing the focused input can fire a blur; only the first close counts.
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    setChat('');
  };

  return (
    <div
      className="chat-bubble"
      // A hidden copy of the text sizes the box to exactly what's typed.
      data-value={text || 'Say something'}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, background: color }}
    >
      <input
        ref={(el) => el?.focus({ preventScroll: true })}
        value={text}
        maxLength={CHAT_LIMIT}
        // Tiny built-in width: the hidden copy of the text sizes the box.
        size={1}
        placeholder="Say something"
        aria-label="Cursor chat"
        spellCheck={false}
        onChange={(e) => { setText(e.target.value); setChat(e.target.value); }}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
        }}
      />
    </div>
  );
}
