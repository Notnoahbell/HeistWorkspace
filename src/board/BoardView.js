import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useLayoutEffect, useRef } from 'react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { Users } from 'lucide-react';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { boardSummary, enterBoard, itemHooks } from './actions';
import { BOARD_SWATCH, NOTE_WIDTH } from './constants';
import { BoardIcon, SquircleRing } from '../ui/BoardIcon';
import { effectiveIcon } from '../lib/iconGuess';
import { useAddedBy } from './details';
/**
 * A board's tile on its parent board. Floating, it's an icon square with the
 * name underneath; stacked in a column it becomes a row. While dragged it is
 * always the square (the column shows a preview row where it would land).
 * Double-click opens it.
 */
export const BoardView = memo(function BoardView({ id }) {
    const item = useBoard((s) => s.items[id]);
    const board = item?.kind === 'board' ? item : null;
    /** Who added it and when, for the hover details. */
    const added = useAddedBy(item);
    const parentId = board?.parentId ?? null;
    const stackIndex = useBoard((s) => stackZ(s.items, id));
    const depth = useBoard((s) => stackDepth(s.items, id));
    // A shortcut (e.g. a board shared with you, on your Home) shows and opens its target.
    const linkTo = board?.linkTo ?? null;
    const target = useBoard((s) => (linkTo ? (s.items[linkTo]?.kind === 'board' ? s.items[linkTo] : null) : board));
    const targetId = linkTo ?? id;
    const summary = useBoard((s) => boardSummary(s.items, targetId));
    const slot = useLayout((s) => (parentId ? s.slots[id] : undefined));
    const fill = useLayout((s) => (parentId ? s.fills[id] : undefined));
    const selected = useUi((s) => s.selectedIds.includes(id));
    const editing = useUi((s) => s.editingId === id);
    const dropTarget = useUi((s) => s.boardDrop === targetId);
    const received = useUi((s) => s.toast?.boardId === targetId ? s.toast.at : 0);
    const nameRef = useRef(null);
    const lifted = useLiftedZ(id);
    const dragging = useUi((s) => s.dragId === id);
    const row = !!parentId && !dragging;
    // The lift shadow belongs on the solid part: the whole row, or just the square.
    const swatchRef = useRef(null);
    const rest = !board ? null : parentId ? (slot ?? null) : { x: board.x, y: board.y };
    const { body, posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, () => (row ? visRef.current : swatchRef.current), 
    // The floating square is clipped to smoothed corners: shadow it with a filter.
    () => !row, 
    // Clicking a selected board's name renames it; anywhere else opens it.
    // (Shortcuts just open: rename the board itself from inside it.)
    (e) => {
        const r = nameRef.current?.getBoundingClientRect();
        const onName = !linkTo && r && e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
        if (onName)
            useUi.getState().set({ selectedId: id, editingId: id });
        else if (useBoard.getState().items[targetId])
            enterBoard(targetId);
    });
    useReportHeight(id, visRef);
    // Something was just dropped into this board: a quick pulse to confirm it.
    useLayoutEffect(() => {
        if (!received)
            return;
        const el = row ? visRef.current : swatchRef.current;
        el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' });
    }, [received]);
    // Lifting a board out of a column: it turns back into its square, so move
    // the grip to the square's centre and drop the row's shadow from the
    // now-transparent tile.
    useLayoutEffect(() => {
        if (row || !visRef.current)
            return;
        visRef.current.style.boxShadow = '';
        if (swatchRef.current)
            swatchRef.current.style.filter = '';
        if (dragging && parentId)
            body.regrip({ x: (board?.w ?? 0) / 2, y: BOARD_SWATCH / 2 });
    }, [row]);
    if (!board)
        return null;
    const zIndex = lifted ?? stackIndex;
    const shown = target ?? board;
    const name = linkTo && !target ? 'Unavailable board' : shown.title || 'Untitled board';
    const icon = effectiveIcon(shown);
    return (_jsx("div", { ref: posRef, className: "item-pos", "data-item": true, style: { zIndex, visibility: rest ? undefined : 'hidden' }, onPointerDown: onPointerDown, onContextMenu: onContextMenu, onClick: onClick, children: _jsxs("div", { ref: visRef, className: row ? 'board-row' : 'board-tile', "data-stacked": row ? stackTone(depth) : undefined, "data-drop-target": dropTarget || undefined, "data-selected": selected, "data-shortcut": linkTo ? true : undefined, "data-missing": linkTo && !target ? true : undefined, style: { width: row ? fill ?? NOTE_WIDTH : board.w }, children: [row ? (_jsx(BoardIcon, { icon: icon, color: shown.color, size: 28, squircle: BOARD_SWATCH })) : (_jsxs("div", { ref: swatchRef, className: "board-swatch-wrap", children: [_jsx(BoardIcon, { icon: icon, color: shown.color, size: 28, squircle: BOARD_SWATCH }), (selected || dropTarget) && _jsx(SquircleRing, { size: BOARD_SWATCH }), linkTo && (_jsx("span", { className: "shared-badge", title: "Shared with you", children: _jsx(Users, { size: 11, strokeWidth: 2.4, "aria-hidden": "true" }) }))] })), _jsxs("div", { className: "board-meta", "data-tip": editing ? undefined : [name, linkTo && !target ? 'No longer shared with you' : summary, linkTo ? 'Shared with you' : '', added].filter(Boolean).join('\n'), children: [editing && !linkTo ? (_jsx(BoardNameInput, { id: id, title: board.title })) : (_jsx("div", { ref: nameRef, className: "board-name", "data-empty": !shown.title, children: name })), _jsx("div", { className: "board-count", children: linkTo && !target ? 'No longer shared with you' : summary })] })] }) }));
});
/** Inline rename: bare text in place of the name, like a column title. */
function BoardNameInput({ id, title }) {
    return (_jsx("input", { className: "board-name board-name-input", defaultValue: title, placeholder: "Untitled board", spellCheck: false, ref: (el) => {
            if (el && document.activeElement !== el) {
                el.focus({ preventScroll: true });
                el.select();
            }
        }, onChange: (e) => useBoard.getState().updateItem(id, { title: e.target.value }), onBlur: () => { if (useUi.getState().editingId === id)
            useUi.getState().set({ editingId: null }); }, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === 'Escape')
            e.currentTarget.blur(); } }));
}
