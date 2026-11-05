import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Settings panels for the selected item, shown in pop-ups from either the
// sidebar's item menu or the toolbar above the item, plus the shared list of
// actions each item kind offers.
import { useMemo, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowUpRight, ArrowUpZA, Bold, Download, Maximize2, Repeat, ExternalLink, Link2, MessageSquare, PenLine, Search, Trash2, Type, } from 'lucide-react';
import { COMMENTABLE, useBoard } from '../board/store';
import { setStatus, STATUSES, versionOf } from '../board/versions';
import { useUi } from '../board/ui';
import { confirmDelete, enterBoard, sortedChildren, sortSection } from '../board/actions';
import { downloadItems } from '../board/download';
import { cardVideos } from '../board/comments';
import { COLOR_PRESETS } from '../lib/color';
import { BOARD_ICONS, iconLabel } from '../lib/icons';
import { ColorWheel } from './ColorWheel';
import { BoardIcon } from './BoardIcon';
import { gridCols, MAX_COLS } from '../board/layout';
import { effectiveIcon, guessIcon } from '../lib/iconGuess';
const update = (id, patch) => useBoard.getState().updateItem(id, patch);
export const ICON_PROPS = { size: 16, strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter' };
function PanelSection({ label, children }) {
    return (_jsxs("section", { className: "panel-section", children: [label && _jsx("h3", { children: label }), children] }));
}
function ColorPanel({ value, presets, noneLabel, noneBackground, onChange }) {
    const isCustom = value != null && !presets.includes(value.toUpperCase());
    const [custom, setCustom] = useState(isCustom);
    return (_jsxs(_Fragment, { children: [_jsx(PanelSection, { children: _jsxs("div", { className: "swatches", children: [_jsx("button", { className: noneBackground ? 'swatch' : 'swatch swatch-none', title: noneLabel, "aria-label": noneLabel, "aria-pressed": value == null, style: noneBackground ? { background: noneBackground } : undefined, onClick: () => onChange(null) }), presets.map((c) => (_jsx("button", { className: "swatch", title: c, "aria-label": c, "aria-pressed": value?.toUpperCase() === c, style: { background: c }, onClick: () => onChange(c) }, c)))] }) }), _jsx(PanelSection, { children: custom ? (_jsx(ColorWheel, { value: value, onChange: onChange })) : (_jsxs("button", { className: "panel-button", onClick: () => setCustom(true), children: [_jsx("span", { className: "rainbow-dot", "aria-hidden": "true" }), "Custom colour\u2026"] })) })] }));
}
// --- Text --------------------------------------------------------------------
function Segmented({ value, options, onChange, label }) {
    return (_jsx("div", { className: "segmented", role: "radiogroup", "aria-label": label, children: options.map((o) => (_jsx("button", { role: "radio", "aria-checked": value === o.value, "aria-label": o.title, title: o.title, onClick: () => onChange(o.value), children: o.label }, o.value))) }));
}
function TextPanel({ item }) {
    return (_jsxs(PanelSection, { label: "Text", children: [_jsx(Segmented, { label: "Text size", value: item.textSize, onChange: (v) => update(item.id, { textSize: v }), options: [
                    { value: 'sm', label: _jsx("span", { style: { fontSize: 11 }, children: "Small" }), title: 'Small text' },
                    { value: 'md', label: _jsx("span", { style: { fontSize: 13 }, children: "Medium" }), title: 'Medium text' },
                    { value: 'lg', label: _jsx("span", { style: { fontSize: 15 }, children: "Large" }), title: 'Large text' },
                ] }), _jsxs("div", { className: "panel-row", children: [_jsx(Segmented, { label: "Alignment", value: item.textAlign, onChange: (v) => update(item.id, { textAlign: v }), options: [
                            { value: 'left', label: _jsx(AlignLeft, { ...ICON_PROPS }), title: 'Align left' },
                            { value: 'center', label: _jsx(AlignCenter, { ...ICON_PROPS }), title: 'Align centre' },
                            { value: 'right', label: _jsx(AlignRight, { ...ICON_PROPS }), title: 'Align right' },
                        ] }), _jsx("button", { className: "panel-toggle", title: "Bold", "aria-label": "Bold", "aria-pressed": item.bold, onClick: () => update(item.id, { bold: !item.bold }), children: _jsx(Bold, { ...ICON_PROPS, strokeWidth: 2.4 }) })] })] }));
}
function IconPanel({ value, guess, color, onChange }) {
    const [query, setQuery] = useState('');
    const names = useMemo(() => {
        const q = query.trim().toLowerCase();
        const all = Object.keys(BOARD_ICONS);
        return q ? all.filter((n) => iconLabel(n).includes(q)) : all;
    }, [query]);
    return (_jsxs(PanelSection, { label: "Icon", children: [_jsxs("label", { className: "panel-search", children: [_jsx(Search, { ...ICON_PROPS, size: 14, "aria-hidden": "true" }), _jsx("input", { autoFocus: true, value: query, placeholder: "Search icons", onChange: (e) => setQuery(e.target.value) })] }), _jsxs("button", { className: "panel-auto", "aria-pressed": value == null, onClick: () => onChange(null), children: [_jsx(BoardIcon, { icon: guess, color: value == null ? color : null, size: 16, className: "icon-cell" }), _jsxs("span", { children: [_jsx("strong", { children: "Automatic" }), _jsx("small", { children: "Picked from the board's name" })] })] }), _jsxs("div", { className: "icon-grid", children: [names.map((n) => (_jsx("button", { title: iconLabel(n), "aria-label": iconLabel(n), "aria-pressed": value === n, onClick: () => onChange(n), children: _jsx(BoardIcon, { icon: n, color: value === n ? color : null, size: 18, className: "icon-cell" }) }, n))), names.length === 0 && _jsxs("p", { className: "panel-empty", children: ["No icons match \u201C", query, "\u201D."] })] })] }));
}
// --- Rename ------------------------------------------------------------------
function RenamePanel({ value, placeholder, onChange }) {
    return (_jsx(PanelSection, { label: "Name", children: _jsx("input", { className: "panel-input", autoFocus: true, value: value, placeholder: placeholder, onFocus: (e) => e.currentTarget.select(), onChange: (e) => onChange(e.target.value), onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === 'Escape')
                    useUi.getState().set({ flyout: null });
            } }) }));
}
/** The body of a settings pop-up for one item. */
export function Panel({ item, panel }) {
    switch (panel) {
        case 'color': {
            if (item.kind === 'media' || item.kind === 'comment')
                return null;
            const def = `var(--${item.kind}-default)`;
            return _jsx(ColorPanel, { value: item.color, presets: COLOR_PRESETS, noneLabel: "Default", noneBackground: def, onChange: (v) => update(item.id, { color: v }) });
        }
        case 'strip':
            if (item.kind !== 'column')
                return null;
            return _jsx(ColorPanel, { value: item.strip, presets: COLOR_PRESETS, noneLabel: "No strip", onChange: (v) => update(item.id, { strip: v }) });
        case 'text':
            return item.kind === 'note' ? _jsx(TextPanel, { item: item }) : null;
        case 'icon':
            return item.kind === 'board'
                ? _jsx(IconPanel, { value: item.icon, guess: guessIcon(item.title), color: item.color, onChange: (v) => update(item.id, { icon: v }) })
                : null;
        case 'rename':
            if (item.kind !== 'column' && item.kind !== 'board')
                return null;
            return _jsx(RenamePanel, { value: item.title, placeholder: `Untitled ${item.kind === 'column' ? 'section' : 'board'}`, onChange: (v) => update(item.id, { title: v }) });
        case 'status':
            if (item.kind !== 'media')
                return null;
            return (_jsx(PanelSection, { label: item.versions?.length ? `Status of v${versionOf(item)}` : 'Review status', children: _jsx("div", { className: "status-options", role: "radiogroup", "aria-label": "Review status", children: [...STATUSES, null].map((s) => (_jsxs("button", { role: "radio", "aria-checked": (item.status ?? null) === (s?.value ?? null), onClick: () => setStatus(item.id, versionOf(item), s?.value ?? null), children: [_jsx("span", { className: "review-dot", style: { background: s?.color ?? 'transparent' }, "data-none": !s || undefined }), s?.label ?? 'No status'] }, s?.value ?? 'none'))) }) }));
        case 'sort': {
            if (item.kind !== 'column')
                return null;
            // Ticked when the cards are already in that order.
            const now = item.childIds.join();
            const options = [
                { dir: 1, label: 'Name, A to Z', icon: _jsx(ArrowDownAZ, { ...ICON_PROPS }) },
                { dir: -1, label: 'Name, Z to A', icon: _jsx(ArrowUpZA, { ...ICON_PROPS }) },
            ];
            return (_jsxs(PanelSection, { label: "Sort cards", children: [_jsx("div", { className: "status-options sort-options", role: "radiogroup", "aria-label": "Sort cards", children: options.map((o) => (_jsxs("button", { role: "radio", "aria-checked": item.childIds.length > 1 && sortedChildren(item.id, o.dir).join() === now, onClick: () => sortSection(item.id, o.dir), children: [o.icon, o.label] }, o.dir))) }), _jsx("p", { className: "panel-hint", children: item.childIds.length > 1 ? 'Sorts once; drag cards to reorder after.' : 'Add a few cards to sort them.' })] }));
        }
        case 'layout':
            if (item.kind !== 'column')
                return null;
            return (_jsxs(PanelSection, { label: "Columns", children: [_jsx(Segmented, { label: "Columns", value: String(gridCols(item)), onChange: (v) => update(item.id, { cols: Number(v) }), options: Array.from({ length: MAX_COLS }, (_, i) => ({ value: String(i + 1), label: String(i + 1), title: `${i + 1} ${i ? 'columns' : 'column'}` })) }), _jsx("p", { className: "panel-hint", children: "Or drag the section's right edge." })] }));
    }
}
export const GROUP_ORDER = ['primary', 'review', 'look', 'organise', 'file', 'danger'];
/** What you can do with an item, in toolbar order. `isOpenBoard` = the board you're inside. */
export function itemActions(item, isOpenBoard = false) {
    const list = kindActions(item, isOpenBoard);
    if (COMMENTABLE.has(item.kind)) {
        // Comment: opens the comment box beside the item (again to close it).
        list.push({
            key: 'comment', label: 'Comment', group: 'review', glyph: _jsx(MessageSquare, { ...ICON_PROPS, size: 18 }),
            pressed: useUi.getState().commenting === item.id,
            run: () => {
                const ui = useUi.getState();
                ui.set({ commenting: ui.commenting === item.id ? null : item.id, flyout: null, editingId: null });
            },
        });
    }
    // Group order; within a group, the order they were listed in.
    return list
        .map((x, i) => ({ x, i }))
        .sort((p, q) => GROUP_ORDER.indexOf(p.x.group) - GROUP_ORDER.indexOf(q.x.group) || p.i - q.i)
        .map((e) => e.x);
}
function kindActions(item, isOpenBoard) {
    const colorGlyph = _jsx("span", { className: "glyph-swatch", style: { background: ('color' in item && item.color) || `var(--${item.kind}-default)` } });
    const color = { key: 'color', label: 'Colour', group: 'look', glyph: colorGlyph, panel: 'color' };
    const del = {
        key: 'delete', label: 'Delete (Del)', group: 'danger', glyph: _jsx(Trash2, { ...ICON_PROPS, size: 18 }), run: () => confirmDelete(item.id), danger: true,
    };
    const pen = _jsx(PenLine, { ...ICON_PROPS, size: 18 });
    /** Renames in place (the card's own name field). */
    const rename = (label = 'Rename') => ({
        key: 'rename', label, group: 'organise', glyph: pen,
        run: () => useUi.getState().set({ editingId: item.id, flyout: null }),
    });
    switch (item.kind) {
        case 'note':
            return [color, { key: 'text', label: 'Text style', group: 'look', panel: 'text', glyph: _jsx(Type, { ...ICON_PROPS, size: 18 }) }, del];
        case 'comment':
            return [];
        case 'todo':
            return [color, del];
        case 'media': {
            const video = item.mediaType === 'video';
            return [
                {
                    key: 'view', label: video ? 'Open in the player (Enter)' : 'View full size (Enter)', group: 'primary', text: video ? 'Play' : 'View',
                    // Opens it big (the same expand arrows as the card's own corner button).
                    glyph: _jsx(Maximize2, { ...ICON_PROPS, size: 16 }),
                    run: () => useUi.getState().set({ viewer: { id: item.id, time: cardVideos.get(item.id)?.currentTime ?? 0 }, flyout: null }),
                },
                {
                    ...rename(),
                    // Renames inline, in the caption (shown again if it was tucked away).
                    run: () => {
                        update(item.id, { captionHidden: false });
                        useUi.getState().set({ editingId: item.id, flyout: null });
                    },
                },
                ...(video ? [{
                        key: 'loop', group: 'organise',
                        label: item.loop ? 'Looping: plays on its own, silently. Click to stop' : 'Loop: play on its own, silently, like a GIF',
                        glyph: _jsx(Repeat, { ...ICON_PROPS, size: 18 }),
                        pressed: !!item.loop,
                        run: () => update(item.id, { loop: !item.loop }),
                    }] : []),
                ...(item.src && !item.upload ? [{
                        key: 'download', group: 'file', label: `Download ${video ? 'video' : 'image'}`,
                        glyph: _jsx(Download, { ...ICON_PROPS, size: 18 }), run: () => downloadItems([item.id]),
                    }] : []),
                del,
            ];
        }
        case 'link':
            return [
                ...(item.url
                    ? [{
                            key: 'open', label: `Open ${item.url}`, group: 'primary', text: 'Open', glyph: _jsx(ExternalLink, { ...ICON_PROPS, size: 16 }),
                            run: () => window.open(item.url, '_blank', 'noopener,noreferrer'),
                        }]
                    : []),
                color,
                { key: 'edit', label: 'Edit link', group: 'organise', glyph: _jsx(Link2, { ...ICON_PROPS, size: 18 }), run: () => useUi.getState().set({ editingId: item.id, flyout: null }) },
                del,
            ];
        case 'column':
            return [
                color,
                {
                    key: 'strip', label: 'Strip', group: 'look', panel: 'strip',
                    // A card with a band across the top: the strip colour, or hatched when there's none yet.
                    glyph: (_jsx("span", { className: "glyph-strip", "data-empty": !item.strip || undefined, style: { '--strip': item.strip ?? 'transparent' }, children: _jsx("i", {}) })),
                },
                // Sections rename inline, in their header.
                rename(),
                { key: 'sort', label: 'Sort by name', group: 'organise', panel: 'sort', glyph: _jsx(ArrowDownAZ, { ...ICON_PROPS, size: 18 }) },
                // The current count, so it reads at a glance.
                { key: 'layout', label: 'Columns', group: 'organise', panel: 'layout', glyph: _jsx("span", { className: "glyph-cols", children: gridCols(item) }) },
                del,
            ];
        case 'frame':
            return [
                color,
                // Frames rename inline, in their tag.
                rename(),
                { ...del, label: 'Remove frame (keeps what was in it)' },
            ];
        case 'board': {
            if (item.linkTo) {
                const target = item.linkTo;
                return [
                    { key: 'open', label: 'Open board', group: 'primary', text: 'Open', glyph: _jsx(ArrowUpRight, { ...ICON_PROPS, size: 16 }), run: () => enterBoard(target) },
                    { ...del, label: 'Remove shortcut' },
                ];
            }
            const icon = { key: 'icon', label: 'Icon', group: 'look', panel: 'icon', glyph: _jsx(BoardIcon, { icon: effectiveIcon(item), color: item.color, size: 14, className: "glyph-board" }) };
            // The board you're inside has no tile on screen: rename in a pop-up.
            if (isOpenBoard)
                return [color, icon, { key: 'rename', label: 'Rename', group: 'organise', panel: 'rename', glyph: pen }];
            return [
                { key: 'open', label: 'Open board (Enter)', group: 'primary', text: 'Open', glyph: _jsx(ArrowUpRight, { ...ICON_PROPS, size: 16 }), run: () => enterBoard(item.id) },
                color, icon, rename(), del,
            ];
        }
    }
}
