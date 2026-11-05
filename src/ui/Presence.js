import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Other people's cursors (with a name / message bubble), and cursor chat:
// press "/" to type a short message that shows beside your cursor for others.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { camera } from '../canvas/camera';
import { isTyping } from '../canvas/input';
import { useBoardId } from '../board/nav';
import { CURSOR_PATH } from '../lib/cursor';
import { useMyColor, usePresence } from '../sync/presence';
import { useBoard } from '../board/store';
import { useLayout } from '../board/layout';
import { itemSize, posOf } from '../board/actions';
import { Avatar } from './Collab';
import { CHAT_LIMIT, setChat, setCursor } from '../sync/client';
export function CursorShape({ color }) {
    return (_jsx("svg", { className: "peer-cursor", width: "24", height: "24", viewBox: "0 0 24 24", "aria-hidden": "true", children: _jsx("path", { d: CURSOR_PATH, fill: color, stroke: "#fff", strokeWidth: "1.6", strokeLinejoin: "round" }) }));
}
/** Everyone else's cursor on this board, exactly where they report it (no smoothing). */
export function PeerCursors() {
    const boardId = useBoardId();
    const peers = usePresence(useShallow((s) => Object.values(s.peers).filter((p) => p.boardId === boardId && p.at)));
    useSyncExternalStore(camera.subscribe, () => camera.version);
    return (_jsx("div", { className: "presence-layer", "aria-hidden": "true", children: peers.map((p) => {
            const at = camera.worldToScreen(p.at.x, p.at.y);
            return (_jsxs("div", { className: "peer", style: { transform: `translate3d(${at.x}px, ${at.y}px, 0)` }, children: [_jsx(CursorShape, { color: p.color }), _jsx("span", { className: "peer-bubble", "data-msg": !!p.msg, style: { background: p.color }, children: p.msg || p.name })] }, p.connId));
        }) }));
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
    if (!peers.length)
        return null;
    // Who has each item selected, in a steady order.
    const by = new Map();
    for (const p of [...peers].sort((a, b) => a.connId.localeCompare(b.connId))) {
        for (const id of p.sel) {
            const it = items[id];
            if (!it || it.boardId !== boardId)
                continue;
            const list = by.get(id) ?? [];
            if (!list.some((q) => q.userId === p.userId))
                list.push(p);
            by.set(id, list);
        }
    }
    return (_jsx("div", { className: "presence-layer peer-sel-layer", "aria-hidden": "true", children: [...by].map(([id, who]) => {
            const it = items[id];
            const o = posOf(it), { w, h } = itemSize(it);
            const a = camera.worldToScreen(o.x, o.y);
            const pad = SEL_GAP;
            return (_jsx("div", { className: "peer-sel", style: {
                    transform: `translate3d(${a.x - pad}px, ${a.y - pad}px, 0)`,
                    width: w * camera.z + pad * 2,
                    height: h * camera.z + pad * 2,
                    '--peer': who[0].color,
                }, children: _jsx("span", { className: "peer-sel-who", children: who.map((p) => (_jsx("span", { title: `${p.name} has this selected`, children: _jsx(Avatar, { profile: { name: p.name, icon: p.icon }, color: p.color, size: SEL_AVATAR }) }, p.userId))) }) }, id));
        }) }));
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
        const onMove = (e) => {
            pointer.current = { x: e.clientX, y: e.clientY };
            if (open)
                setPos(pointer.current);
            const overCanvas = e.target?.closest?.('.viewport');
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
        const onKey = (e) => {
            if (e.key !== '/' || open || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey)
                return;
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
    if (!open || !online)
        return null;
    const close = () => {
        // Removing the focused input can fire a blur; only the first close counts.
        if (closing.current)
            return;
        closing.current = true;
        setOpen(false);
        setChat('');
    };
    return (_jsx("div", { className: "chat-bubble", "data-value": text || 'Say something', style: { transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, background: color }, children: _jsx("input", { ref: (el) => el?.focus({ preventScroll: true }), value: text, maxLength: CHAT_LIMIT, 
            // Tiny built-in width: the hidden copy of the text sizes the box.
            size: 1, placeholder: "Say something", "aria-label": "Cursor chat", spellCheck: false, onChange: (e) => { setText(e.target.value); setChat(e.target.value); }, onBlur: close, onKeyDown: (e) => {
                if (e.key === 'Escape' || e.key === 'Enter') {
                    e.preventDefault();
                    close();
                }
            } }) }));
}
