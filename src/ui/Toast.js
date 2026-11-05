import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// A brief confirmation at the bottom of the canvas, e.g. after moving things
// into another board ("Moved 2 items to Moodboard · Open"). A busy one (e.g.
// fetching a Pinterest pin) stays until it's replaced. It slides in, and
// slides down and fades out when it goes, rather than just vanishing.
import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import { useUi } from '../board/ui';
import { enterBoard } from '../board/actions';
const SHOW_MS = 3500;
export function Toast() {
    const toast = useUi((s) => s.toast);
    // What's on screen: the current toast, or the last one while it leaves.
    const [shown, setShown] = useState(toast);
    const leaving = !toast && !!shown;
    useEffect(() => { if (toast)
        setShown(toast); }, [toast]);
    useEffect(() => {
        if (!toast || toast.busy)
            return;
        const t = setTimeout(() => {
            if (useUi.getState().toast === toast)
                useUi.getState().set({ toast: null });
        }, toast.ms ?? SHOW_MS);
        return () => clearTimeout(t);
    }, [toast]);
    const t = toast ?? shown;
    if (!t)
        return null;
    return (_jsxs("div", { className: "toast", role: "status", "data-busy": t.busy || undefined, "data-leaving": leaving || undefined, onAnimationEnd: (e) => { if (leaving && e.animationName === 'toast-out')
            setShown(null); }, children: [t.icon === 'pin' && (_jsx("span", { className: "toast-icon", "aria-hidden": "true", children: _jsx("span", { className: "toast-pin", children: _jsx(Pin, { size: 17, strokeWidth: 2.2 }) }) })), _jsx("span", { children: t.text }), t.boardId && (_jsx("button", { onClick: () => {
                    useUi.getState().set({ toast: null });
                    enterBoard(t.boardId);
                }, children: "Open" }))] }, t.at));
}
