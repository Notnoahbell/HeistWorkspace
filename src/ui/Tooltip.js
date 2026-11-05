import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Hover tooltips for the whole app, in one style: a dark pill with an arrow,
// above whatever's hovered (below when there's no room).
//
// Nothing to wire up per component:
// - Any element with a `title` gets this instead of the browser's slow, plain
//   one (the title moves to data-tip on first hover). `data-tip` works too.
//   New lines make more lines; the first reads brighter than the rest.
// - Text cut off with "…" shows in full on hover, title or not.
// Shows after a short pause, then instantly while moving between things that
// have one. Never while a button is held (dragging), and hides on any press,
// key, scroll or wheel.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
const SHOW_MS = 450;
/** After one hides, the next shows at once for this long. */
const WARM_MS = 500;
const GAP = 8;
const MARGIN = 8;
/** The tooltip for an element (and the element it belongs to), if any. */
function tipFor(target) {
    // A tooltip someone wrote (on the thing or around it) says more than cut-off text does.
    for (let el = target, depth = 0; el && el !== document.body && depth < 12; el = el.parentElement, depth++) {
        const title = el.getAttribute('title');
        if (title) {
            // Ours from now on (the browser's would show as well).
            el.dataset.tip = title;
            el.removeAttribute('title');
        }
        const tip = el.dataset?.tip;
        if (tip)
            return { anchor: el, text: tip };
    }
    // Cut-off text: show it whole.
    for (let el = target, depth = 0; el && el !== document.body && depth < 4; el = el.parentElement, depth++) {
        if (el instanceof HTMLElement && el.clientWidth > 0) {
            const cs = getComputedStyle(el);
            const clipped = (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
                || (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' && el.scrollHeight > el.clientHeight + 1);
            const text = el.innerText?.trim();
            if (clipped && text && !el.isContentEditable && !(el instanceof HTMLInputElement))
                return { anchor: el, text };
        }
    }
    return null;
}
export function TooltipLayer() {
    const [tip, setTip] = useState(null);
    const [pos, setPos] = useState(null);
    const box = useRef(null);
    const timer = useRef(0);
    const warmUntil = useRef(0);
    /** Pressed on: don't show again until the pointer leaves it. */
    const quiet = useRef(null);
    const current = useRef(null);
    useEffect(() => {
        const hide = (warm = true) => {
            clearTimeout(timer.current);
            if (current.current && warm)
                warmUntil.current = performance.now() + WARM_MS;
            current.current = null;
            setTip(null);
            setPos(null);
        };
        const over = (e) => {
            if (e.pointerType === 'touch' || e.buttons)
                return;
            const t = tipFor(e.target);
            if (!t || t.anchor === quiet.current) {
                if (current.current && !current.current.anchor.contains(e.target))
                    hide();
                return;
            }
            if (current.current?.anchor === t.anchor && current.current.text === t.text)
                return;
            clearTimeout(timer.current);
            const show = () => { current.current = t; setTip(t); };
            if (current.current || performance.now() < warmUntil.current) {
                show();
                return;
            }
            timer.current = window.setTimeout(() => { if (t.anchor.isConnected)
                show(); }, SHOW_MS);
        };
        const out = (e) => {
            const to = e.relatedTarget;
            if (quiet.current && !(to && quiet.current.contains(to)))
                quiet.current = null;
            const a = current.current?.anchor;
            if (a && !(to && a.contains(to)))
                hide();
            else if (!a && !(to && e.target.contains(to)))
                clearTimeout(timer.current);
        };
        const press = (e) => {
            quiet.current = tipFor(e.target)?.anchor ?? null;
            hide(false);
        };
        const quietAll = () => hide(false);
        document.addEventListener('pointerover', over, true);
        document.addEventListener('pointerout', out, true);
        document.addEventListener('pointerdown', press, true);
        document.addEventListener('keydown', quietAll, true);
        document.addEventListener('wheel', quietAll, { capture: true, passive: true });
        document.addEventListener('scroll', quietAll, true);
        window.addEventListener('blur', quietAll);
        return () => {
            clearTimeout(timer.current);
            document.removeEventListener('pointerover', over, true);
            document.removeEventListener('pointerout', out, true);
            document.removeEventListener('pointerdown', press, true);
            document.removeEventListener('keydown', quietAll, true);
            document.removeEventListener('wheel', quietAll, true);
            document.removeEventListener('scroll', quietAll, true);
            window.removeEventListener('blur', quietAll);
        };
    }, []);
    // Place it once it's measured: centred above, or below when there's no room; kept on screen.
    useLayoutEffect(() => {
        if (!tip || !box.current)
            return;
        const r = tip.anchor.getBoundingClientRect();
        const { offsetWidth: w, offsetHeight: h } = box.current;
        const below = r.top - h - GAP < MARGIN;
        const top = below ? r.bottom + GAP : r.top - h - GAP;
        const cx = r.left + r.width / 2;
        const left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, cx - w / 2));
        setPos({ left, top, below, arrow: Math.max(12, Math.min(w - 12, cx - left)) });
    }, [tip]);
    if (!tip)
        return null;
    const [first, ...rest] = tip.text.split('\n');
    return createPortal(_jsxs("div", { ref: box, className: "tooltip", role: "tooltip", "data-below": pos?.below || undefined, style: { left: pos?.left ?? -9999, top: pos?.top ?? -9999, '--arrow': `${pos?.arrow ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }, children: [_jsx("span", { className: "tooltip-main", children: first }), rest.filter((l) => l.trim()).map((l, i) => _jsx("span", { className: "tooltip-more", children: l }, i))] }), document.body);
}
