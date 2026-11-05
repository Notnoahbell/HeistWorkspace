import { useLayoutEffect, useMemo, useRef } from 'react';
import { Body, bodies } from './body';
import { useUi } from './ui';
import { parentOf, stackDepth, useBoard } from './store';
import { useLayout } from './layout';
import { selectOnly, shiftSelect, toggleSelect } from './actions';
import { startMarquee } from '../ui/Marquee';
/**
 * Attach a physics Body to an item's elements. `rest` is where the item
 * should sit (null = not known yet; the item stays hidden until it is).
 */
export function useBody(id, makeHooks, rest, 
/** Element for the lift shadow, if not the visual element. Read every frame. */
shadow, 
/** Whether that shadow must be a filter (the element is clipped to a shape). */
shadowAsFilter, 
/**
 * The item's "open" action (edit text, open board…). Runs when an already
 * selected item is clicked again, which also covers a double-click.
 */
onActivate) {
    const activate = useRef(onActivate);
    activate.current = onActivate;
    /** How the current press began: on an already-selected item, within a group? */
    const press = useRef(null);
    const posRef = useRef(null);
    const visRef = useRef(null);
    const shadowFn = useRef(shadow);
    shadowFn.current = shadow;
    const filterFn = useRef(shadowAsFilter);
    filterFn.current = shadowAsFilter;
    const body = useMemo(() => {
        const b = new Body(id, makeHooks(id));
        b.shadowEl = () => shadowFn.current?.() ?? null;
        b.shadowAsFilter = () => filterFn.current?.() ?? false;
        return b;
    }, [id, makeHooks]);
    const restRef = useRef(rest);
    restRef.current = rest;
    useLayoutEffect(() => {
        bodies.set(id, body);
        if (restRef.current)
            body.mount(posRef.current, visRef.current, restRef.current);
        return () => {
            if (bodies.get(id) === body)
                bodies.delete(id);
            body.unmount();
        };
    }, [id, body]);
    // Rest changes (store commits, column reflow, other users) animate in.
    useLayoutEffect(() => {
        if (!rest)
            return;
        if (!body.pos)
            body.mount(posRef.current, visRef.current, rest);
        else
            body.setRest(rest.x, rest.y);
    }, [body, rest?.x, rest?.y]);
    const onPointerDown = (e) => {
        press.current = null;
        const ui = useUi.getState();
        // Pan gestures (middle button, Space) belong to the canvas.
        if (e.button !== 0 || ui.spaceDown)
            return;
        // Let text fields inside the item behave normally while editing.
        if (ui.editingId === id && e.target.closest('textarea, input'))
            return;
        e.stopPropagation();
        // Shift: box-select inside a section or frame, a run of cards in a section, or add / remove.
        if (e.shiftKey) {
            const kind = useBoard.getState().items[id]?.kind;
            if (kind === 'column' || kind === 'frame')
                startMarquee(e, id);
            else
                shiftSelect(id);
            return;
        }
        // Ctrl/⌘-click adds to / removes from the selection.
        if (e.ctrlKey || e.metaKey) {
            toggleSelect(id);
            return;
        }
        const sel = ui.selectedIds;
        press.current = { wasSelected: sel.includes(id), inGroup: sel.length > 1 && sel.includes(id) };
        body.grab(e.pointerId, e.clientX, e.clientY);
    };
    const onClick = (e) => {
        const p = press.current;
        press.current = null;
        if (!p || body.moved)
            return;
        // Clicking one item of a group (without dragging) narrows to just it.
        if (p.inGroup)
            selectOnly(id);
        else if (p.wasSelected)
            activate.current?.(e);
    };
    /** Right-click: act on the selection (selecting this first if it isn't part of it). */
    const onContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ui = useUi.getState();
        if (!ui.selectedIds.includes(id))
            selectOnly(id);
        useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY }, flyout: null });
    };
    return { body, posRef, visRef, onPointerDown, onClick, onContextMenu };
}
/** Publish an item's rendered height so columns can stack it. */
export function useReportHeight(id, ref) {
    useLayoutEffect(() => {
        const el = ref.current;
        const report = () => {
            const h = el.offsetHeight;
            useLayout.setState((s) => (s.heights[id] === h ? s : { heights: { ...s.heights, [id]: h } }));
        };
        report();
        const ro = new ResizeObserver(report);
        ro.observe(el);
        return () => {
            ro.disconnect();
            useLayout.setState((s) => {
                const { [id]: _gone, ...heights } = s.heights;
                return { heights };
            });
        };
    }, [id]);
}
/** z-index band for whatever is being dragged, above everything at rest. */
const LIFTED_Z = 1_000_000;
/**
 * While something is dragged, it and everything riding along with it (a
 * column's contents at any depth, the rest of a dragged group) float above
 * the board, keeping their nesting order. null when this item isn't lifted.
 */
export function useLiftedZ(id) {
    const movingId = useUi((s) => s.movingId);
    const group = useUi((s) => s.movingId && s.selectedIds.length > 1 && s.selectedIds.includes(s.movingId) ? s.selectedIds : null);
    const carried = useUi((s) => (s.movingId ? s.carried : null));
    return useBoard((s) => {
        if (!movingId)
            return null;
        for (let cur = id; cur; cur = parentOf(s.items[cur])) {
            if (cur === movingId || group?.includes(cur) || carried?.includes(cur))
                return LIFTED_Z + stackDepth(s.items, id);
        }
        return null;
    });
}
