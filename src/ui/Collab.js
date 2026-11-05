import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Top-right of the top bar: who's here, boards shared with you, sharing the
// open board, and your profile (name + icon).
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, Link2, Share2 } from 'lucide-react';
import { useBoard } from '../board/store';
import { useBoardId } from '../board/nav';
import { isHome, session } from '../session';
import { BOARD_ICONS } from '../lib/icons';
import { useMyColor, usePresence } from '../sync/presence';
import { camera } from '../canvas/camera';
import { setProfile } from '../sync/client';
import { NotificationBell } from './Notifications';
const ICON = { size: 16, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true };
const PROFILE_ICONS = [
    'Smile', 'Star', 'Heart', 'Flame', 'Zap', 'Rocket', 'Camera', 'Film', 'Clapperboard', 'Music',
    'Palette', 'Brush', 'PenTool', 'Coffee', 'Pizza', 'Cat', 'Dog', 'Bird', 'Fish', 'Ghost',
    'Crown', 'Gem', 'Leaf', 'Sun', 'Moon', 'Mountain', 'Gamepad2', 'Atom',
];
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
export function Avatar({ profile, color, size = 26 }) {
    const Icon = profile.icon ? BOARD_ICONS[profile.icon] : null;
    return (_jsx("span", { className: "avatar", style: { width: size, height: size, background: color ?? 'var(--accent)' }, title: profile.name, children: Icon ? _jsx(Icon, { size: size * 0.55, strokeWidth: 2, strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": "true" }) : initials(profile.name) }));
}
function useDismiss(ref, open, close) {
    useEffect(() => {
        if (!open)
            return;
        const onDown = (e) => { if (!ref.current?.contains(e.target))
            close(); };
        const onKey = (e) => { if (e.key === 'Escape')
            close(); };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);
}
export function Popover({ button, label, children }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const close = () => setOpen(false);
    useDismiss(ref, open, close);
    return (_jsxs("div", { className: "top-pop", ref: ref, children: [button(open, () => setOpen((v) => !v)), open && _jsx("div", { className: "top-pop-panel", role: "dialog", "aria-label": label, children: children(close) })] }));
}
const STACK_MAX = 4;
/** Jump the view to someone's cursor. */
function goTo(p) {
    if (p.at)
        camera.centerOn(p.at.x, p.at.y, camera.z, camera.width, camera.height);
}
function PersonButton({ peer, onPick }) {
    return (_jsx("button", { className: "here-person", title: peer.at ? `${peer.name} — click to go to their cursor` : `${peer.name} (cursor off the board)`, "aria-label": `Go to ${peer.name}`, onClick: () => { goTo(peer); onPick?.(); }, children: _jsx(Avatar, { profile: peer, color: peer.color, size: 28 }) }));
}
/**
 * People on this board right now: overlapping circles that fan out on hover.
 * Click someone to jump to their cursor.
 */
function HereNow() {
    const boardId = useBoardId();
    const peers = usePresence(useShallow((s) => {
        const seen = new Set();
        return Object.values(s.peers).filter((p) => p.boardId === boardId && !seen.has(p.userId) && seen.add(p.userId));
    }));
    if (!peers.length)
        return null;
    const shown = peers.slice(0, STACK_MAX);
    const rest = peers.slice(STACK_MAX);
    return (_jsxs("div", { className: "here-now", "aria-label": `${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`, children: [shown.map((p) => _jsx(PersonButton, { peer: p }, p.userId)), rest.length > 0 && (_jsx(Popover, { label: "Everyone here", button: (open, toggle) => (_jsxs("button", { className: "here-person here-more", "aria-expanded": open, onClick: toggle, title: `${rest.length} more`, children: ["+", rest.length] })), children: (close) => (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Everyone here" }), peers.map((p) => (_jsxs("button", { className: "pop-row", onClick: () => { goTo(p); close(); }, children: [_jsx(Avatar, { profile: p, color: p.color, size: 22 }), _jsx("span", { children: p.name })] }, p.userId)))] })) }))] }));
}
/** Is this board in your own Home tree (so you own it and can share it)? */
function ownsBoard(items, boardId) {
    const all = items;
    for (let b = boardId, guard = 0; b && guard < 64; guard++) {
        if (isHome(b))
            return b === `home:${session.userId}`;
        b = all[b]?.boardId;
    }
    return false;
}
/** Share the open board with other people. */
function ShareBoard() {
    const boardId = useBoardId();
    const board = useBoard((s) => (s.items[boardId]?.kind === 'board' ? s.items[boardId] : null));
    const owns = useBoard((s) => ownsBoard(s.items, boardId));
    const online = usePresence((s) => s.status === 'online');
    const others = usePresence(useShallow((s) => Object.values(s.users).filter((u) => u.id !== session.userId)));
    const [copied, setCopied] = useState(false);
    if (!board || !owns)
        return null;
    const shared = board.sharedWith ?? [];
    const toggle = (id) => useBoard.getState().updateItem(board.id, {
        sharedWith: shared.includes(id) ? shared.filter((u) => u !== id) : [...shared, id],
    });
    return (_jsx(Popover, { label: "Share board", button: (open, toggleOpen) => (_jsxs("button", { className: "top-btn top-share", "aria-expanded": open, onClick: toggleOpen, disabled: !online, title: online ? 'Share this board' : 'Sharing needs the sync server', children: [_jsx(Share2, { ...ICON }), _jsx("span", { children: "Share" }), shared.length > 0 && _jsx("span", { className: "top-badge", children: shared.length })] })), children: () => (_jsxs(_Fragment, { children: [_jsxs("h3", { children: ["Share \u201C", board.title || 'Untitled board', "\u201D"] }), _jsx("p", { className: "pop-note", children: "People you add can see and edit everything in this board." }), others.length === 0 && _jsx("p", { className: "pop-empty", children: "Nobody else has opened Heist Workspace yet. Send teammates this page's address." }), others.map((u) => (_jsxs("button", { className: "pop-row", role: "checkbox", "aria-checked": shared.includes(u.id), onClick: () => toggle(u.id), children: [_jsx(Avatar, { profile: u, size: 22 }), _jsx("span", { children: u.name }), _jsx("span", { className: "pop-check", children: shared.includes(u.id) && _jsx(Check, { ...ICON, size: 14 }) })] }, u.id))), _jsxs("button", { className: "pop-link", onClick: async () => {
                        try {
                            await navigator.clipboard.writeText(location.href);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                        }
                        catch { }
                    }, children: [_jsx(Link2, { ...ICON }), " ", copied ? 'Link copied' : 'Copy link to this board'] })] })) }));
}
/** Your name and icon, as others see them. */
function ProfileMenu() {
    const me = usePresence((s) => s.me);
    const status = usePresence((s) => s.status);
    const color = useMyColor();
    const [name, setName] = useState(me?.name ?? '');
    useEffect(() => setName(me?.name ?? ''), [me?.name]);
    const profile = me ?? { id: session.userId, name: 'You', icon: null };
    return (_jsx(Popover, { label: "Your profile", button: (open, toggle) => (_jsxs("button", { className: "top-btn top-profile", "aria-expanded": open, onClick: toggle, title: `${profile.name} (${status})`, children: [_jsx(Avatar, { profile: profile, color: color, size: 26 }), _jsx("span", { className: "status-dot", "data-status": status })] })), children: () => (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Your profile" }), status !== 'online' && _jsx("p", { className: "pop-note", children: "Offline \u2014 changes are saved on this computer and sync when the server is back." }), _jsxs("label", { className: "pop-field", children: [_jsx("span", { children: "Name" }), _jsx("input", { className: "panel-input", value: name, maxLength: 32, disabled: !me, onChange: (e) => setName(e.target.value), onBlur: () => { if (name.trim() && name !== me?.name)
                                setProfile({ name: name.trim() }); }, onKeyDown: (e) => { if (e.key === 'Enter')
                                e.currentTarget.blur(); } })] }), _jsxs("div", { className: "pop-field", children: [_jsx("span", { children: "Icon" }), _jsxs("div", { className: "profile-icons", children: [_jsx("button", { "aria-pressed": !profile.icon, onClick: () => setProfile({ icon: null }), title: "Initials", disabled: !me, children: _jsx(Avatar, { profile: { ...profile, icon: null }, size: 26 }) }), PROFILE_ICONS.map((n) => (_jsx("button", { "aria-pressed": profile.icon === n, onClick: () => setProfile({ icon: n }), title: n, disabled: !me, children: _jsx(Avatar, { profile: { ...profile, icon: n }, size: 26 }) }, n)))] })] }), _jsx("p", { className: "pop-note", children: "Testing build: there are no logins yet \u2014 you're recognised by this browser." })] })) }));
}
export function CollabBar() {
    return (_jsxs("div", { className: "top-right", children: [_jsx(HereNow, {}), _jsx(ShareBoard, {}), _jsx(NotificationBell, {}), _jsx(ProfileMenu, {})] }));
}
