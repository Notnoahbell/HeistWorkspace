import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Drawing on a video frame in the player, and the comment being put together
// there: an optional time range (Shift-drag the timeline, or I / O) and any
// marks drawn on the frame. The comment box reads the draft when it posts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Check, MoveUpRight, PenLine, Square, Trash2, Undo2 } from 'lucide-react';
export const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'];
export const useDraft = create()(() => ({ range: null, shapes: [], drawing: false, tool: 'arrow', color: COLORS[0] }));
export const clearDraft = () => useDraft.setState({ range: null, shapes: [], drawing: false });
const round = (n) => Math.round(n * 10000) / 10000;
/** Where the picture really is in a video element that letterboxes it (object-fit: contain), relative to its parent. */
function pictureBox(v) {
    const W = v.offsetWidth, H = v.offsetHeight;
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    const w = vw * s, h = vh * s;
    return { x: v.offsetLeft + (W - w) / 2, y: v.offsetTop + (H - h) / 2, w, h };
}
/** One mark, drawn at the picture's current size. */
function Mark({ s, w, h }) {
    const pts = [];
    for (let i = 0; i < s.p.length; i += 2)
        pts.push([s.p[i] * w, s.p[i + 1] * h]);
    const common = { stroke: s.c, strokeWidth: 3.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (s.k === 'pen')
        return _jsx("polyline", { points: pts.map((p) => p.join(',')).join(' '), ...common });
    const [[x1, y1], [x2, y2]] = pts;
    if (s.k === 'box')
        return _jsx("rect", { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), rx: 3, ...common });
    // Arrow: a line and a head at the far end.
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = 16, spread = 0.45;
    const head = [
        [x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread)],
        [x2, y2],
        [x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread)],
    ];
    return (_jsxs("g", { children: [_jsx("line", { x1: x1, y1: y1, x2: x2, y2: y2, ...common }), _jsx("polyline", { points: head.map((p) => p.join(',')).join(' '), ...common })] }));
}
/**
 * Marks over the picture. Editable while drawing (press and drag to add one
 * with the current tool and colour); otherwise just shown.
 */
export function Annotation({ video, shapes, editable }) {
    const [box, setBox] = useState(null);
    const [live, setLive] = useState(null);
    const svg = useRef(null);
    // Follow the picture as the window (or the comments column) changes size.
    useLayoutEffect(() => {
        if (!video)
            return;
        const measure = () => setBox(pictureBox(video));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(video);
        video.addEventListener('loadedmetadata', measure);
        return () => { ro.disconnect(); video.removeEventListener('loadedmetadata', measure); };
    }, [video]);
    if (!box)
        return null;
    const at = (e) => {
        const r = svg.current.getBoundingClientRect();
        return [round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))), round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))];
    };
    return (_jsxs("svg", { ref: svg, className: "annot", "data-editable": editable || undefined, style: { left: box.x, top: box.y, width: box.w, height: box.h }, onPointerDown: editable ? (e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const [x, y] = at(e);
            const { tool, color } = useDraft.getState();
            setLive({ k: tool, c: color, p: tool === 'pen' ? [x, y] : [x, y, x, y] });
        } : undefined, onPointerMove: editable ? (e) => {
            if (!live)
                return;
            const [x, y] = at(e);
            if (live.k === 'pen') {
                const n = live.p.length;
                if (Math.hypot((x - live.p[n - 2]) * box.w, (y - live.p[n - 1]) * box.h) < 2)
                    return;
                setLive({ ...live, p: [...live.p, x, y] });
            }
            else
                setLive({ ...live, p: [live.p[0], live.p[1], x, y] });
        } : undefined, onPointerUp: editable ? () => {
            if (!live)
                return;
            const big = live.k === 'pen' ? live.p.length >= 4 : Math.hypot((live.p[2] - live.p[0]) * box.w, (live.p[3] - live.p[1]) * box.h) > 6;
            if (big)
                useDraft.setState((d) => ({ shapes: [...d.shapes, live] }));
            setLive(null);
        } : undefined, children: [shapes.map((s, i) => _jsx(Mark, { s: s, w: box.w, h: box.h }, i)), live && _jsx(Mark, { s: live, w: box.w, h: box.h })] }));
}
/** Tools while drawing: pen / arrow / box, colour, undo, clear, done. */
export function DrawTools() {
    const { tool, color, shapes } = useDraft();
    const set = useDraft.setState;
    // Z undoes the last mark while drawing.
    useEffect(() => {
        const key = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.stopPropagation();
                set((d) => ({ shapes: d.shapes.slice(0, -1) }));
            }
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, [set]);
    const tools = [
        { k: 'pen', label: 'Pen', icon: _jsx(PenLine, { size: 16, strokeWidth: 2.2, "aria-hidden": "true" }) },
        { k: 'arrow', label: 'Arrow', icon: _jsx(MoveUpRight, { size: 16, strokeWidth: 2.2, "aria-hidden": "true" }) },
        { k: 'box', label: 'Box', icon: _jsx(Square, { size: 15, strokeWidth: 2.2, "aria-hidden": "true" }) },
    ];
    return (_jsxs("div", { className: "draw-tools", role: "toolbar", "aria-label": "Drawing", children: [tools.map((t) => (_jsx("button", { className: "draw-btn", "aria-pressed": tool === t.k, title: t.label, "aria-label": t.label, onClick: () => set({ tool: t.k }), children: t.icon }, t.k))), _jsx("span", { className: "draw-sep" }), COLORS.map((c) => (_jsx("button", { className: "draw-swatch", "aria-pressed": color === c, title: c, "aria-label": `Colour ${c}`, style: { background: c }, onClick: () => set({ color: c }) }, c))), _jsx("span", { className: "draw-sep" }), _jsx("button", { className: "draw-btn", title: "Undo (Ctrl+Z)", "aria-label": "Undo", disabled: !shapes.length, onClick: () => set((d) => ({ shapes: d.shapes.slice(0, -1) })), children: _jsx(Undo2, { size: 16, strokeWidth: 2.2, "aria-hidden": "true" }) }), _jsx("button", { className: "draw-btn", title: "Clear", "aria-label": "Clear drawing", disabled: !shapes.length, onClick: () => set({ shapes: [] }), children: _jsx(Trash2, { size: 15, strokeWidth: 2.2, "aria-hidden": "true" }) }), _jsxs("button", { className: "draw-done", onClick: () => set({ drawing: false }), children: [_jsx(Check, { size: 15, strokeWidth: 2.6, "aria-hidden": "true" }), " Done"] })] }));
}
