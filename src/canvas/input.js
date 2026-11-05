// Canvas navigation input: wheel/trackpad, mouse drag, touch pinch, keyboard.
// Pan/pinch is one unified gesture: every active pointer contributes to a
// centroid (-> pan) and a spread (-> zoom), so 1..n fingers just work.
import { camera as cam } from './camera';
import { useUi } from '../board/ui';
export const ZOOM_STEP = 1.25;
export const isTyping = (e) => e.target?.closest?.('input, textarea, [contenteditable="true"]') != null;
export function zoomAtCenter(z) {
    cam.zoomAt(cam.width / 2, cam.height / 2, z);
}
export function attachNavigation(viewport, onPointerWorld) {
    const pointers = new Map();
    const ui = useUi.getState;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const local = (e) => {
        const r = viewport.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const centroid = () => {
        let x = 0, y = 0;
        for (const p of pointers.values()) {
            x += p.x;
            y += p.y;
        }
        return { x: x / pointers.size, y: y / pointers.size };
    };
    const spread = (c) => {
        let d = 0;
        for (const p of pointers.values())
            d += Math.hypot(p.x - c.x, p.y - c.y);
        return d / pointers.size;
    };
    // --- Pointer drag / pinch -------------------------------------------------
    viewport.addEventListener('pointerdown', (e) => {
        // Middle button or Space pans from anywhere, and a finger pans from empty
        // canvas. A plain mouse drag on empty canvas is box selection (the app's).
        const onItem = e.target.closest('[data-item]') != null;
        const wantsPan = e.button === 1 || (e.button === 0 && ui().spaceDown) || (e.pointerType === 'touch' && !onItem);
        if (!wantsPan)
            return;
        e.preventDefault();
        viewport.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        ui().set({ panning: true });
    }, opts);
    viewport.addEventListener('pointermove', (e) => {
        const p = local(e);
        onPointerWorld?.(cam.screenToWorld(p.x, p.y));
        if (!pointers.has(e.pointerId))
            return;
        const before = centroid();
        const beforeSpread = spread(before);
        pointers.set(e.pointerId, p);
        const after = centroid();
        if (pointers.size > 1 && beforeSpread > 0) {
            cam.zoomAt(before.x, before.y, cam.z * (spread(after) / beforeSpread));
        }
        cam.panBy(after.x - before.x, after.y - before.y);
    }, opts);
    const release = (e) => {
        if (!pointers.delete(e.pointerId))
            return;
        if (pointers.size === 0)
            ui().set({ panning: false });
    };
    viewport.addEventListener('pointerup', release, opts);
    viewport.addEventListener('pointercancel', release, opts);
    // Stop Windows middle-click autoscroll.
    viewport.addEventListener('mousedown', (e) => { if (e.button === 1)
        e.preventDefault(); }, opts);
    // --- Wheel / trackpad -----------------------------------------------------
    viewport.addEventListener('wheel', (e) => {
        // Let focused text areas scroll normally.
        if (isTyping(e))
            return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        // Ctrl+wheel is also what trackpad pinch reports in Chromium/Firefox.
        if (e.ctrlKey || e.metaKey) {
            const p = local(e);
            const d = Math.max(-30, Math.min(30, dy));
            cam.zoomAt(p.x, p.y, cam.z * Math.exp(-d * 0.01));
            return;
        }
        if (e.shiftKey && dx === 0) {
            dx = dy;
            dy = 0;
        }
        cam.panBy(-dx, -dy);
    }, { passive: false, signal: ac.signal });
    // Safari trackpad pinch.
    let gestureStartZ = 1;
    viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureStartZ = cam.z; }, opts);
    viewport.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        const g = e;
        const p = local(g);
        cam.zoomAt(p.x, p.y, gestureStartZ * g.scale);
    }, opts);
    // --- Keyboard -------------------------------------------------------------
    window.addEventListener('keydown', (e) => {
        if (isTyping(e))
            return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.code === 'Space') {
            e.preventDefault();
            if (!e.repeat)
                ui().set({ spaceDown: true });
            return;
        }
        if (mod && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            zoomAtCenter(cam.z * ZOOM_STEP);
            return;
        }
        if (mod && e.key === '-') {
            e.preventDefault();
            zoomAtCenter(cam.z / ZOOM_STEP);
            return;
        }
        if (mod && e.key === '0') {
            e.preventDefault();
            zoomAtCenter(1);
        }
    }, opts);
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space')
            ui().set({ spaceDown: false });
    }, opts);
    // Losing focus mid-gesture shouldn't leave space "stuck" down.
    window.addEventListener('blur', () => ui().set({ spaceDown: false }), opts);
    return () => ac.abort();
}
