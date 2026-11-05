import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// A pop-up panel. Closes on outside press; Escape is handled globally.
// Portalled to <body> so transformed/clipped parents can't affect it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../board/ui';
const MARGIN = 8;
export function Flyout({ left, top, notchY, label, children }) {
    const ref = useRef(null);
    const [y, setY] = useState(top);
    // Keep the whole panel on screen once we know its height.
    useLayoutEffect(() => {
        const h = ref.current.offsetHeight;
        const minTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) + MARGIN;
        setY(Math.max(minTop, Math.min(top, window.innerHeight - h - MARGIN)));
    });
    useEffect(() => {
        const onDown = (e) => {
            const t = e.target;
            // Trigger buttons toggle the pop-up themselves.
            if (ref.current?.contains(t) || t.closest('[data-flyout-trigger]'))
                return;
            useUi.getState().set({ flyout: null });
        };
        window.addEventListener('pointerdown', onDown, true);
        return () => window.removeEventListener('pointerdown', onDown, true);
    }, []);
    const notch = notchY != null ? Math.max(14, notchY - y) : null;
    return createPortal(_jsxs("div", { ref: ref, className: "flyout", role: "dialog", "aria-label": label, style: { left, top: y }, onPointerDown: (e) => e.stopPropagation(), children: [notch != null && _jsx("span", { className: "flyout-notch", style: { top: notch }, "aria-hidden": "true" }), _jsx("div", { className: "flyout-body", children: children })] }), document.body);
}
