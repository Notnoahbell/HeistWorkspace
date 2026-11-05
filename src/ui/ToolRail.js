import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Tool rail down the left: things to add (raised tiles — click, or drag one
// out onto the board) and view controls at the bottom, each with a short
// label. It never changes state: item settings live in the floating toolbar
// above whatever's selected.
import { Fragment, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ImageUp, LayoutGrid, Link2, ListChecks, Magnet, Maximize, Minus, Plus } from 'lucide-react';
import { camera } from '../canvas/camera';
import { ZOOM_STEP, zoomAtCenter } from '../canvas/input';
import { useUi } from '../board/ui';
import { createItem, SPAWN_GRIP, spawnAndDrag, viewportCenterWorld, zoomToFit } from '../board/actions';
import { BOARD_HEIGHT, BOARD_SWATCH, BOARD_WIDTH, COLUMN_EMPTY, COLUMN_HEADER, COLUMN_WIDTH, NOTE_MIN_HEIGHT, NOTE_WIDTH, } from '../board/constants';
import { BoardIcon } from './BoardIcon';
import { SectionIcon } from './SectionIcon';
import { ACCEPT, addMediaFiles } from '../board/media';
const ICON = { size: 18, strokeWidth: 1.8, 'aria-hidden': true };
const TILE_ICON = { size: 18, strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true };
/** One raised tile per thing you can add, all in the same style. */
const TOOLS = [
    { kind: 'note', name: 'Note', label: 'Note', key: 'N', group: 'cards', tile: _jsxs("span", { className: "rail-tile tile-note", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }) },
    { kind: 'link', name: 'Link', label: 'Link', key: 'L', group: 'cards', tile: _jsx("span", { className: "rail-tile", children: _jsx(Link2, { ...TILE_ICON }) }) },
    { kind: 'todo', name: 'To-do list', label: 'To-do', key: 'T', group: 'cards', tile: _jsx("span", { className: "rail-tile", children: _jsx(ListChecks, { ...TILE_ICON }) }) },
    { kind: 'board', name: 'Board', label: 'Board', key: 'B', group: 'containers', tile: _jsx("span", { className: "rail-tile", children: _jsx(LayoutGrid, { ...TILE_ICON }) }) },
    // A column with cards in it: a section's default single column.
    { kind: 'column', name: 'Section', label: 'Section', key: 'S', group: 'containers', tile: _jsx("span", { className: "rail-tile", children: _jsx(SectionIcon, {}) }) },
];
const SIZE = {
    note: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
    link: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
    todo: { w: NOTE_WIDTH, h: NOTE_MIN_HEIGHT },
    column: { w: COLUMN_WIDTH, h: COLUMN_HEADER + COLUMN_EMPTY },
    board: { w: BOARD_WIDTH, h: BOARD_HEIGHT },
};
/** What a new item looks like while it's being dragged out of the rail. */
function Preview({ kind }) {
    const { w, h } = SIZE[kind];
    switch (kind) {
        case 'note':
            return _jsx("div", { className: "note", style: { width: w, minHeight: h }, children: _jsx("div", { className: "note-text", "data-empty": "true", children: "Note" }) });
        case 'link':
            return _jsx("div", { className: "link", style: { width: w }, children: _jsxs("div", { className: "link-bar", children: [_jsx(Link2, { size: 18, strokeWidth: 1.8, "aria-hidden": "true" }), _jsx("span", { children: "Enter a link URL" })] }) });
        case 'todo':
            return _jsx("div", { className: "todo", style: { width: w }, children: _jsx("ul", { className: "todo-list", children: _jsx("li", { className: "todo-empty", children: "To-do list" }) }) });
        case 'column':
            return (_jsx("div", { className: "column", style: { width: w, height: h }, children: _jsxs("header", { className: "column-header", children: [_jsx("span", { className: "column-title", "data-empty": "true", children: "Untitled section" }), _jsx("span", { className: "column-count", children: "0 items" })] }) }));
        case 'board':
            return (_jsxs("div", { className: "board-tile", style: { width: w }, children: [_jsx("div", { className: "board-swatch-wrap", children: _jsx(BoardIcon, { icon: null, color: null, size: 28, squircle: BOARD_SWATCH }) }), _jsxs("div", { className: "board-meta", children: [_jsx("div", { className: "board-name", children: "New board" }), _jsx("div", { className: "board-count", children: "Empty" })] })] }));
    }
}
/**
 * Click to add at the centre of the view, or drag it out: a preview follows
 * the cursor and becomes a real, still-held item once it leaves the rail.
 */
function AddButton({ kind, name, label, keyHint, tile, rail }) {
    const press = useRef(null);
    const previewRef = useRef(null);
    const movePreview = (cx, cy) => {
        const el = previewRef.current;
        el.style.display = 'block';
        el.style.transform = `translate3d(${cx - SPAWN_GRIP.x * camera.z}px, ${cy - SPAWN_GRIP.y * camera.z}px, 0) scale(${camera.z})`;
    };
    const hidePreview = () => { if (previewRef.current)
        previewRef.current.style.display = 'none'; };
    return (_jsxs(_Fragment, { children: [_jsxs("button", { className: "rail-add", title: `${name} (${keyHint}) — click, or drag onto the board`, "aria-label": `Add ${name.toLowerCase()}`, onPointerDown: (e) => {
                    if (e.button !== 0)
                        return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    press.current = { x: e.clientX, y: e.clientY, dragging: false, spawned: false };
                }, onPointerMove: (e) => {
                    const p = press.current;
                    if (!p || p.spawned)
                        return;
                    if (!p.dragging) {
                        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4)
                            return;
                        p.dragging = true;
                    }
                    movePreview(e.clientX, e.clientY);
                    // Hand over once the pointer is out of the rail, over the board.
                    const r = rail()?.getBoundingClientRect();
                    if (!r || e.clientX > r.right) {
                        p.spawned = true;
                        spawnAndDrag(kind, e.pointerId, e.clientX, e.clientY, hidePreview);
                    }
                }, onPointerUp: () => {
                    const p = press.current;
                    if (p?.dragging && !p.spawned)
                        hidePreview(); // let go over the rail: cancel
                    // Clear after the click event that follows has had a chance to see it.
                    setTimeout(() => { press.current = null; });
                }, onPointerCancel: () => { hidePreview(); press.current = null; }, onClick: () => {
                    if (press.current?.dragging)
                        return;
                    createItem(kind, viewportCenterWorld());
                }, children: [tile, _jsx("span", { className: "rail-label", children: label })] }), createPortal(_jsx("div", { ref: previewRef, className: "spawn-preview", "aria-hidden": "true", children: _jsx(Preview, { kind: kind }) }), document.body)] }));
}
/**
 * Pick photos/videos to add at the centre of the view. An inset button rather
 * than a raised tile: it opens a file picker, it isn't something you drag out.
 */
function UploadButton() {
    const input = useRef(null);
    return (_jsxs(_Fragment, { children: [_jsxs("button", { className: "rail-add rail-upload", title: "Upload photos, GIFs or videos \u2014 or drop files onto the board", "aria-label": "Upload photos or videos", onClick: () => input.current?.click(), children: [_jsx("span", { className: "rail-inset", children: _jsx(ImageUp, { ...TILE_ICON }) }), _jsx("span", { className: "rail-label", children: "Upload" })] }), _jsx("input", { ref: input, type: "file", accept: ACCEPT, multiple: true, hidden: true, onChange: (e) => {
                    const files = [...(e.currentTarget.files ?? [])];
                    e.currentTarget.value = '';
                    if (files.length)
                        void addMediaFiles(files, viewportCenterWorld());
                } })] }));
}
export function ToolRail() {
    const ref = useRef(null);
    const snap = useUi((s) => s.snap);
    const z = useSyncExternalStore(camera.subscribe, () => camera.z);
    return (_jsxs("nav", { className: "tool-rail", ref: ref, "aria-label": "Tools", children: [_jsxs("div", { className: "rail-group", children: [TOOLS.map((t, i) => (_jsxs(Fragment, { children: [i > 0 && TOOLS[i - 1].group !== t.group && _jsx("div", { className: "rail-divider", role: "separator" }), _jsx(AddButton, { kind: t.kind, name: t.name, label: t.label, keyHint: t.key, tile: t.tile, rail: () => ref.current })] }, t.kind))), _jsx("div", { className: "rail-divider", role: "separator" }), _jsx(UploadButton, {})] }), _jsx("div", { className: "rail-spacer" }), _jsxs("div", { className: "rail-group rail-view", children: [_jsxs("button", { className: "rail-btn rail-labelled", "aria-pressed": snap, title: "Snap to grid (G) \u2014 hold Alt while dragging to place freely", "aria-label": "Snap to grid", onClick: () => useUi.getState().set({ snap: !snap }), children: [_jsx(Magnet, { ...ICON }), _jsx("span", { className: "rail-label", children: "Snap" })] }), _jsxs("button", { className: "rail-btn rail-labelled", title: "Zoom to fit (Shift+1)", "aria-label": "Zoom to fit", onClick: zoomToFit, children: [_jsx(Maximize, { ...ICON }), _jsx("span", { className: "rail-label", children: "Fit" })] }), _jsxs("div", { className: "rail-zoom", children: [_jsx("button", { className: "rail-btn", title: "Zoom in (Ctrl +)", "aria-label": "Zoom in", onClick: () => zoomAtCenter(camera.z * ZOOM_STEP), children: _jsx(Plus, { ...ICON }) }), _jsxs("button", { className: "rail-btn rail-pct", title: "Reset to 100% (Ctrl 0)", "aria-label": "Reset zoom", onClick: () => zoomAtCenter(1), children: [Math.round(z * 100), "%"] }), _jsx("button", { className: "rail-btn", title: "Zoom out (Ctrl \u2212)", "aria-label": "Zoom out", onClick: () => zoomAtCenter(camera.z / ZOOM_STEP), children: _jsx(Minus, { ...ICON }) })] })] })] }));
}
