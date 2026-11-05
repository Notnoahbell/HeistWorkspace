import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { Link2 } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { isLight } from '../lib/color';
import { fetchPreview, hostOf, normalizeUrl } from '../lib/links';
import { CommentBadge } from '../ui/Comments';
import { useAddedBy } from './details';
const LINK_ICON = { size: 18, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true };
/** A web link with a preview card. Double-click opens the page. */
export const LinkView = memo(function LinkView({ id }) {
    const item = useBoard((s) => s.items[id]);
    const link = item?.kind === 'link' ? item : null;
    /** Who added it and when, for the hover details. */
    const added = useAddedBy(item);
    const stackIndex = useBoard((s) => stackZ(s.items, id));
    const depth = useBoard((s) => stackDepth(s.items, id));
    const slot = useLayout((s) => (link?.parentId ? s.slots[id] : undefined));
    const fill = useLayout((s) => (link?.parentId ? s.fills[id] : undefined));
    const selected = useUi((s) => s.selectedIds.includes(id));
    const editing = useUi((s) => s.editingId === id);
    const lifted = useLiftedZ(id);
    const stacked = useUi((s) => (s.dragId === id ? undefined : stackTone(depth)));
    const rest = !link ? null : link.parentId ? (slot ?? null) : { x: link.x, y: link.y };
    const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined, () => {
        const now = useBoard.getState().items[id];
        if (now?.kind === 'link' && now.url)
            window.open(now.url, '_blank', 'noopener,noreferrer');
        else
            useUi.getState().set({ selectedId: id, editingId: id });
    });
    useReportHeight(id, visRef);
    // Fetch the preview once we have a URL and haven't got one yet.
    const url = link?.url ?? '';
    const needsPreview = !!url && link?.preview == null;
    useEffect(() => {
        if (!needsPreview)
            return;
        let live = true;
        fetchPreview(url).then((preview) => {
            const now = useBoard.getState().items[id];
            if (live && now?.kind === 'link' && now.url === url)
                useBoard.getState().updateItem(id, { preview });
        });
        return () => { live = false; };
    }, [id, url, needsPreview]);
    if (!link)
        return null;
    const zIndex = lifted ?? stackIndex;
    const tone = link.color ? (isLight(link.color) ? 'light' : 'dark') : undefined;
    const p = link.preview;
    let body;
    if (editing || !link.url) {
        body = _jsx(LinkInput, { id: id, url: link.url, editing: editing });
    }
    else if (!p) {
        body = (_jsxs("div", { className: "link-bar", "data-loading": "true", children: [_jsx(Link2, { ...LINK_ICON }), _jsxs("span", { children: ["Loading preview of ", hostOf(link.url), "\u2026"] })] }));
    }
    else if (p.failed || (!p.title && !p.image)) {
        body = (_jsxs("div", { className: "link-bar", children: [_jsx(Link2, { ...LINK_ICON }), _jsx("span", { className: "link-url", children: link.url })] }));
    }
    else {
        body = (_jsxs(_Fragment, { children: [p.image && (_jsx("img", { className: "link-image", src: p.image, alt: "", draggable: false, referrerPolicy: "no-referrer", loading: "lazy", onError: (e) => { e.currentTarget.hidden = true; } })), _jsxs("div", { className: "link-body", children: [_jsxs("div", { className: "link-site", children: [p.favicon && (_jsx("img", { src: p.favicon, alt: "", width: 14, height: 14, draggable: false, referrerPolicy: "no-referrer", onError: (e) => { e.currentTarget.hidden = true; } })), _jsx("span", { children: p.siteName || hostOf(link.url) })] }), p.title && _jsx("div", { className: "link-title", children: p.title }), p.description && _jsx("div", { className: "link-desc", children: p.description })] })] }));
    }
    return (_jsx("div", { ref: posRef, className: "item-pos", "data-item": true, style: { zIndex, visibility: rest ? undefined : 'hidden' }, onPointerDown: onPointerDown, onContextMenu: onContextMenu, onClick: (e) => { if (!editing)
            onClick(e); }, children: _jsxs("div", { ref: visRef, className: "link", "data-stacked": stacked, "data-selected": selected, "data-tone": tone, title: link.url ? [link.preview?.title, link.url, added, 'Click again to open'].filter(Boolean).join('\n') : undefined, style: { width: fill ?? link.w, '--item-bg': link.color ?? undefined }, children: [body, _jsx(CommentBadge, { id: id })] }) }));
});
function LinkInput({ id, url, editing }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        if (editing) {
            ref.current?.focus({ preventScroll: true });
            ref.current?.select();
        }
    }, [editing]);
    const commit = () => {
        const next = normalizeUrl(ref.current?.value ?? '');
        const ui = useUi.getState();
        if (next && next !== url)
            useBoard.getState().updateItem(id, { url: next, preview: null });
        if (ui.editingId === id)
            ui.set({ editingId: null });
    };
    return (_jsxs("div", { className: "link-bar link-entry", children: [_jsx(Link2, { ...LINK_ICON }), _jsx("input", { ref: ref, className: "link-input", defaultValue: url, placeholder: "Enter a link URL", spellCheck: false, readOnly: !editing, tabIndex: editing ? 0 : -1, onBlur: commit, onKeyDown: (e) => {
                    if (e.key === 'Enter')
                        e.currentTarget.blur();
                    if (e.key === 'Escape') {
                        e.currentTarget.value = url;
                        e.currentTarget.blur();
                    }
                } })] }));
}
