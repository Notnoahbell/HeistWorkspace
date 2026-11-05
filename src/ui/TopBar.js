import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Top bar: where you are (breadcrumb path) and what you're looking at
// (the open board's name, centred). Click a crumb to go up to it.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, House } from 'lucide-react';
import { useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { pathTo, useBoardId } from '../board/nav';
import { enterBoard } from '../board/actions';
import { BoardIcon } from './BoardIcon';
import { CollabBar } from './Collab';
import { HeistLogo } from './HeistLogo';
import { useSecretClicks } from './AdminPage';
import { useMyColor } from '../sync/presence';
/** Crumbs shown in full before the middle collapses into "…". */
const MAX_CRUMBS = 4;
const TAIL = 2;
function CrumbIcon({ crumb }) {
    if (crumb.home)
        return _jsx(House, { size: 14, strokeWidth: 1.9, strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": "true" });
    return _jsx(BoardIcon, { icon: crumb.icon, color: crumb.color, size: 11, className: "crumb-swatch" });
}
function CrumbButton({ crumb, current }) {
    const dropTarget = useUi((s) => s.boardDrop === crumb.id);
    return (_jsxs("button", { "data-crumb-id": crumb.id, "data-drop-target": dropTarget || undefined, className: "crumb", "aria-current": current ? 'page' : undefined, title: current ? crumb.title : `Go to ${crumb.title}`, onClick: () => !current && enterBoard(crumb.id), children: [_jsx(CrumbIcon, { crumb: crumb }), _jsx("span", { children: crumb.title })] }));
}
function Overflow({ hidden }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const close = (e) => { if (!ref.current?.contains(e.target))
            setOpen(false); };
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [open]);
    return (_jsxs("div", { className: "crumb-overflow", ref: ref, children: [_jsx("button", { className: "crumb", "aria-label": `${hidden.length} more levels`, "aria-expanded": open, title: "Show hidden levels", onClick: () => setOpen((v) => !v), children: "\u2026" }), open && (_jsx("div", { className: "crumb-menu", role: "menu", children: hidden.map((c) => (_jsxs("button", { role: "menuitem", className: "crumb-menu-item", onClick: () => { setOpen(false); enterBoard(c.id); }, children: [_jsx(CrumbIcon, { crumb: c }), _jsx("span", { children: c.title })] }, c.id))) }))] }));
}
export function TopBar() {
    const boardId = useBoardId();
    // The logo wears your personal colour (the same everywhere, for you).
    const myColor = useMyColor();
    const secret = useSecretClicks();
    // Serialise so we only re-render when the path itself changes.
    const pathKey = useBoard((s) => JSON.stringify(pathTo(boardId, s.items)));
    const path = JSON.parse(pathKey);
    const current = path[path.length - 1];
    const collapsed = path.length > MAX_CRUMBS;
    const head = path[0];
    const hidden = collapsed ? path.slice(1, -TAIL) : [];
    const tail = collapsed ? path.slice(-TAIL) : path.slice(1);
    const sep = _jsx("span", { className: "crumb-sep", "aria-hidden": "true", children: "/" });
    return (_jsxs("header", { className: "topbar", children: [_jsx("div", { className: "top-brand", title: "Heist Workspace", onClick: secret, children: _jsx(HeistLogo, { color: myColor, height: 26 }) }), _jsxs("nav", { className: "crumbs", "aria-label": "Board path", children: [_jsx(CrumbButton, { crumb: head, current: path.length === 1 }), collapsed && _jsxs(_Fragment, { children: [sep, _jsx(Overflow, { hidden: hidden })] }), tail.map((c, i) => (_jsxs("span", { className: "crumb-wrap", children: [sep, _jsx(CrumbButton, { crumb: c, current: i === tail.length - 1 })] }, c.id)))] }), _jsxs("button", { className: "top-title", title: current.home ? 'Your home board' : 'Board settings', disabled: current.home, onClick: () => useUi.getState().set({ selectedId: current.id, editingId: null }), children: [current.home
                        ? _jsx(House, { size: 18, strokeWidth: 1.9, strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": "true" })
                        : _jsx(BoardIcon, { icon: current.icon, color: current.color, size: 14, className: "title-swatch" }), _jsx("span", { children: current.title }), !current.home && _jsx(ChevronDown, { size: 14, strokeWidth: 2, "aria-hidden": "true", className: "top-title-caret" })] }), _jsx(CollabBar, {})] }));
}
