import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Right-click menu: actions on the selection, or "add here" on empty canvas.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, Copy, CopyPlus, Frame, LayoutGrid, Link2, ListChecks, Play, Scissors, StickyNote, Trash2 } from 'lucide-react';
import { useUi } from '../board/ui';
import { useBoard } from '../board/store';
import { createItem, deleteSelection, groupIntoColumn, wrapInFrame } from '../board/actions';
import { MAX_WALL, openWall } from './MediaWall';
import { copySelection, cutSelection, duplicateSelection, hasClipboard, paste } from '../board/clipboard';
import { SectionIcon } from './SectionIcon';
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const ICON = { size: 16, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true };
const MARGIN = 8;
const close = () => useUi.getState().set({ contextMenu: null });
function Entry({ icon, label, hint, danger, disabled, onClick }) {
    return (_jsxs("button", { role: "menuitem", className: "menu-item", "data-danger": danger, disabled: disabled, onClick: () => { close(); onClick(); }, children: [icon, _jsx("span", { children: label }), hint && _jsx("kbd", { children: hint })] }));
}
const ADD = [
    { kind: 'note', label: 'Note', icon: _jsx(StickyNote, { ...ICON }), hint: 'N' },
    { kind: 'link', label: 'Link', icon: _jsx(Link2, { ...ICON }), hint: 'L' },
    { kind: 'todo', label: 'To-do list', icon: _jsx(ListChecks, { ...ICON }), hint: 'T' },
    { kind: 'board', label: 'Board', icon: _jsx(LayoutGrid, { ...ICON }), hint: 'B' },
    { kind: 'column', label: 'Section', icon: _jsx(SectionIcon, { size: ICON.size }), hint: 'S' },
];
export function ContextMenu() {
    const menu = useUi((s) => s.contextMenu);
    const ids = useUi((s) => s.selectedIds);
    const count = ids.length;
    const hasItems = useBoard((s) => ids.some((id) => s.items[id]));
    // Boards can't be copied; only offer copying when something else is selected.
    const canCopy = useBoard((s) => ids.some((id) => s.items[id] && s.items[id].kind !== 'board'));
    const media = useBoard((s) => ids.filter((id) => s.items[id]?.kind === 'media').length);
    const ref = useRef(null);
    const [pos, setPos] = useState({ left: 0, top: 0 });
    // Keep the menu inside the window.
    useLayoutEffect(() => {
        if (!menu || !ref.current)
            return;
        const { offsetWidth: w, offsetHeight: h } = ref.current;
        setPos({
            left: Math.min(menu.x, window.innerWidth - w - MARGIN),
            top: Math.min(menu.y, window.innerHeight - h - MARGIN),
        });
    }, [menu]);
    useEffect(() => {
        if (!menu)
            return;
        const onDown = (e) => { if (!ref.current?.contains(e.target))
            close(); };
        const onKey = (e) => { if (e.key === 'Escape')
            close(); };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', close, { passive: true });
        window.addEventListener('blur', close);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('wheel', close);
            window.removeEventListener('blur', close);
        };
    }, [menu]);
    if (!menu)
        return null;
    const onCanvas = !!menu.world;
    if (!onCanvas && !hasItems)
        return null;
    const things = count === 1 ? 'item' : `${count} items`;
    return (_jsx("div", { ref: ref, className: "context-menu", role: "menu", style: { left: pos.left, top: pos.top }, onContextMenu: (e) => e.preventDefault(), children: onCanvas ? (_jsxs(_Fragment, { children: [hasClipboard() && (_jsxs(_Fragment, { children: [_jsx(Entry, { icon: _jsx(ClipboardPaste, { ...ICON }), label: "Paste here", hint: `${MOD}V`, onClick: () => paste(menu.world) }), _jsx("div", { className: "menu-sep" })] })), _jsx("div", { className: "menu-label", children: "Add here" }), ADD.map((a) => (_jsx(Entry, { icon: a.icon, label: a.label, hint: a.hint, onClick: () => createItem(a.kind, menu.world) }, a.kind)))] })) : (_jsxs(_Fragment, { children: [media >= 2 && (_jsxs(_Fragment, { children: [_jsx(Entry, { icon: _jsx(Play, { ...ICON }), label: `Play ${Math.min(media, MAX_WALL)} together`, hint: "Enter", onClick: () => openWall(ids) }), _jsx("div", { className: "menu-sep" })] })), _jsx(Entry, { icon: _jsx(SectionIcon, { size: ICON.size }), label: `New section from ${count === 1 ? 'item' : 'selection'}`, onClick: () => groupIntoColumn() }), _jsx(Entry, { icon: _jsx(Frame, { ...ICON }), label: "Wrap in a frame", hint: `${MOD}G`, onClick: () => wrapInFrame() }), _jsx("div", { className: "menu-sep" }), _jsx(Entry, { icon: _jsx(Copy, { ...ICON }), label: "Copy", hint: `${MOD}C`, disabled: !canCopy, onClick: copySelection }), _jsx(Entry, { icon: _jsx(Scissors, { ...ICON }), label: "Cut", hint: `${MOD}X`, disabled: !canCopy, onClick: cutSelection }), _jsx(Entry, { icon: _jsx(CopyPlus, { ...ICON }), label: "Duplicate", hint: `${MOD}D`, disabled: !canCopy, onClick: duplicateSelection }), hasClipboard() && _jsx(Entry, { icon: _jsx(ClipboardPaste, { ...ICON }), label: "Paste", hint: `${MOD}V`, onClick: () => paste() }), _jsx("div", { className: "menu-sep" }), _jsx(Entry, { icon: _jsx(Trash2, { ...ICON }), label: `Delete ${things}`, hint: "Del", danger: true, onClick: deleteSelection })] })) }));
}
