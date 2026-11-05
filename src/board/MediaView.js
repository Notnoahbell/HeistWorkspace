import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Layers, Maximize2, Pause, Play, Repeat, RotateCw } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { ensureDerived, mediaSubtitle, playable, retryUpload, useLocalMedia, useVersionUploads } from './media';
import { Scrubber, stepFrame, useContrastTone } from '../ui/Scrubber';
import { cardVideos, commentIndex } from './comments';
import { useShallow } from 'zustand/react/shallow';
import { isTyping } from '../canvas/input';
import { openViewer } from '../ui/MediaViewer';
import { useCachedSrc } from '../lib/mediaCache';
import { mediaFacts, useAddedBy } from './details';
import { CommentBadge } from '../ui/Comments';
import { commentVersion, setStatus, STATUSES, statusInfo, versionOf } from './versions';
import { Check } from 'lucide-react';
const ICON = { strokeWidth: 2, 'aria-hidden': true };
/** Buttons on the card mustn't start a drag or select the card. */
const keep = { onPointerDown: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation() };
/**
 * A photo, GIF or video, with a caption (name + details) that tucks away
 * behind an arrow. Double-click (or click a selected card) to open it in the
 * player; click the name of a selected card to rename it. GIFs just loop.
 */
export const MediaView = memo(function MediaView({ id }) {
    const item = useBoard((s) => s.items[id]);
    const media = item?.kind === 'media' ? item : null;
    const stackIndex = useBoard((s) => stackZ(s.items, id));
    const depth = useBoard((s) => stackDepth(s.items, id));
    const slot = useLayout((s) => (media?.parentId ? s.slots[id] : undefined));
    const fill = useLayout((s) => (media?.parentId ? s.fills[id] : undefined));
    const local = useLocalMedia((s) => s[id]);
    const selected = useUi((s) => s.selectedIds.includes(id));
    const editing = useUi((s) => s.editingId === id);
    const stacked = useUi((s) => (s.dragId === id ? undefined : stackTone(depth)));
    const lifted = useLiftedZ(id);
    const [video, setVideo] = useState(null);
    const nameRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    /** Hover-scrub: where across the card the pointer is (0–1), while the video isn't playing. */
    const [skim, setSkim] = useState(null);
    const dragging = useUi((s) => s.dragId != null);
    const tone = useContrastTone(video);
    // Open timecoded comments on the current version, as marks on the timeline.
    const version = media ? versionOf(media) : 1;
    const marks = useBoard(useShallow((s) => (commentIndex(s.items).get(id) ?? [])
        .flatMap((c) => (c.time != null && commentVersion(c) === version ? [c.time] : []))));
    // Another video is being dragged over this one: it would become the next version.
    const versionTarget = useUi((s) => s.versionDrop === id);
    const incoming = useVersionUploads((s) => s[id]);
    // Let comments read and set this card's video time.
    useEffect(() => {
        if (!video)
            return;
        cardVideos.set(id, video);
        return () => { if (cardVideos.get(id) === video)
            cardVideos.delete(id); };
    }, [id, video]);
    const togglePlay = () => {
        if (!video)
            return;
        if (video.paused)
            void video.play();
        else
            video.pause();
    };
    const rest = !media ? null : media.parentId ? (slot ?? null) : { x: media.x, y: media.y };
    const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined, (e) => {
        const r = nameRef.current?.getBoundingClientRect();
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
            useUi.getState().set({ selectedId: id, editingId: id });
        }
        else {
            // Carry on in the player from where the card is.
            video?.pause();
            openViewer(id, video?.currentTime ?? 0);
        }
    });
    useReportHeight(id, visRef);
    // Have the server work out its frame rate, poster, filmstrip (and a proxy if needed), once.
    useEffect(() => {
        if (media?.mediaType === 'video' && media.src)
            ensureDerived(media.src, media.meta);
    }, [media?.mediaType, media?.src, media?.meta.derived]);
    // , and . step a selected video a frame at a time.
    useEffect(() => {
        if (!selected || !video)
            return;
        const onKey = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || useUi.getState().viewer || useUi.getState().wall)
                return;
            if (e.key !== ',' && e.key !== '.')
                return;
            e.preventDefault();
            stepFrame(video, e.key === '.' ? 1 : -1, media?.meta.fps);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selected, video]);
    // The proxy if the server made one; else a fresh upload's local copy; else the original;
    // and the copy saved on this device in place of any of those, when there is one (lib/mediaCache).
    const src = useCachedSrc(media ? playable(media.src, media.meta, local?.url) : undefined) ?? '';
    const added = useAddedBy(media ?? undefined);
    // Looping: plays on its own, silently, while it's on screen (paused when it isn't, so a
    // board full of them stays light).
    const looping = !!media?.loop && media.mediaType === 'video';
    useEffect(() => {
        if (!video)
            return;
        if (!looping) {
            video.muted = false;
            return;
        }
        video.muted = true;
        video.loop = true;
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting)
                void video.play().catch(() => { });
            else
                video.pause();
        }, { threshold: 0.05 });
        io.observe(video);
        return () => { io.disconnect(); video.pause(); };
        // (Again when the file changes, e.g. from the local copy to the uploaded one: that reloads it.)
    }, [video, looping, src]);
    if (!media)
        return null;
    const { width = 16, height = 9 } = media.meta;
    const failed = media.upload === 'failed';
    const uploading = media.upload === 'uploading';
    return (_jsx("div", { ref: posRef, className: "item-pos", "data-item": true, style: { zIndex: lifted ?? stackIndex, visibility: rest ? undefined : 'hidden' }, onPointerDown: onPointerDown, onContextMenu: onContextMenu, onClick: onClick, children: _jsxs("div", { ref: visRef, className: "media", "data-selected": selected, "data-stacked": stacked, "data-version-drop": versionTarget || undefined, style: { width: fill ?? media.w }, children: [_jsxs("div", { className: "media-frame", style: { aspectRatio: `${width} / ${height}` }, onPointerMove: media.mediaType === 'video' ? (e) => {
                        // Skim through it by moving across (not over its controls, not mid-drag, not while it plays).
                        const over = e.target.closest('button:not(.media-play), .media-scrub');
                        if (playing || dragging || over || e.buttons) {
                            if (skim != null)
                                setSkim(null);
                            return;
                        }
                        const r = e.currentTarget.getBoundingClientRect();
                        setSkim(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
                    } : undefined, onPointerLeave: () => setSkim(null), children: [src ? (media.mediaType === 'video' ? (_jsx("video", { ref: setVideo, src: src, poster: media.meta.poster, preload: media.loop ? 'auto' : 'metadata', muted: !!media.loop, playsInline: true, loop: true, onPlay: () => setPlaying(true), onPause: () => setPlaying(false) })) : (_jsx("img", { src: src, alt: media.name, draggable: false }))) : (_jsx("div", { className: "media-pending", children: failed ? 'Upload failed' : 'Uploading…' })), media.mediaType === 'video' && src && skim != null && (_jsx(Skim, { video: video, at: skim, strip: media.meta.strip })), media.mediaType === 'video' && src && (_jsxs(_Fragment, { children: [_jsx("button", { className: "media-play", "data-playing": playing || undefined, "aria-label": playing ? 'Pause' : 'Play', ...keep, onClick: (e) => { e.stopPropagation(); togglePlay(); }, children: playing ? _jsx(Pause, { size: 22, fill: "currentColor", ...ICON }) : _jsx(Play, { size: 22, fill: "currentColor", ...ICON }) }), _jsx(Scrubber, { video: video, className: "media-scrub", tone: tone, marks: marks })] })), media.status && statusInfo(media.status) && (_jsx("span", { className: "media-status-strip", style: { '--st': statusInfo(media.status).color }, "aria-hidden": "true" })), _jsxs("span", { className: "media-tags", children: [!uploading && !failed && _jsx(CardStatus, { id: id, version: version, value: media.status ?? null }), version > 1 && _jsxs("span", { className: "media-version", title: `Version ${version}`, children: ["v", version] }), looping && _jsx("span", { className: "media-version media-loop", title: "Loops on its own (silently)", children: _jsx(Repeat, { size: 11, strokeWidth: 2.6, "aria-hidden": "true" }) })] }), versionTarget && (_jsxs("div", { className: "media-version-drop", "aria-hidden": "true", children: [_jsx(Layers, { size: 20, ...ICON }), "Drop to add as v", version + 1] })), incoming && (_jsxs("div", { className: "media-version-drop media-incoming", "aria-live": "polite", children: [_jsx(Layers, { size: 20, ...ICON }), "Uploading v", version + 1, "\u2026 ", Math.round(incoming.progress * 100), "%", _jsx("span", { className: "media-incoming-bar", children: _jsx("span", { style: { width: `${Math.round(incoming.progress * 100)}%` } }) })] })), uploading && local && (_jsx("div", { className: "media-progress", "aria-label": "Uploading", children: _jsx("span", { style: { width: `${Math.round(local.progress * 100)}%` } }) })), failed && local && (_jsxs("button", { className: "media-retry", ...keep, onClick: (e) => { e.stopPropagation(); void retryUpload(id); }, children: [_jsx(RotateCw, { size: 14, ...ICON }), " Retry upload"] })), src && (_jsx("button", { className: "media-expand", title: "Open in player", "aria-label": "Open in player", ...keep, onClick: (e) => { e.stopPropagation(); openViewer(id, video?.currentTime ?? 0); }, children: _jsx(Maximize2, { size: 14, ...ICON }) })), media.captionHidden && (_jsx("button", { className: "media-reveal", title: "Show name", "aria-label": "Show name", ...keep, onClick: (e) => { e.stopPropagation(); useBoard.getState().updateItem(id, { captionHidden: false }); }, children: _jsx(ChevronUp, { size: 14, ...ICON }) }))] }), !media.captionHidden && (_jsxs("div", { className: "media-caption", children: [_jsxs("div", { className: "media-text", "data-tip": editing ? undefined : [
                                media.name || 'Untitled',
                                mediaFacts(media.meta, media.mediaType),
                                media.versions?.length ? `Version ${version} of ${media.versions.length + 1}` : '',
                                added,
                            ].filter(Boolean).join('\n'), children: [editing ? (_jsx("input", { className: "media-name media-name-input", defaultValue: media.name, placeholder: "Untitled", spellCheck: false, ref: (el) => { if (el && document.activeElement !== el) {
                                        el.focus({ preventScroll: true });
                                        el.select();
                                    } }, onChange: (e) => useBoard.getState().updateItem(id, { name: e.target.value }), onBlur: () => { if (useUi.getState().editingId === id)
                                        useUi.getState().set({ editingId: null }); }, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === 'Escape')
                                        e.currentTarget.blur(); } })) : (_jsx("div", { ref: nameRef, className: "media-name", "data-empty": !media.name, children: media.name || 'Untitled' })), _jsx("div", { className: "media-sub", children: uploading && local ? `Uploading… ${Math.round(local.progress * 100)}%` : mediaSubtitle(media.meta) })] }), _jsx("button", { className: "media-hide", title: "Hide name", "aria-label": "Hide name", ...keep, onClick: (e) => { e.stopPropagation(); useBoard.getState().updateItem(id, { captionHidden: true }); }, children: _jsx(ChevronDown, { size: 16, ...ICON }) })] })), _jsx(CommentBadge, { id: id })] }) }));
});
/**
 * Hover-scrub: the frame at the pointer, from the filmstrip the server made
 * (instant). Without one yet, the card's own video jumps there instead, and
 * goes back to where it was afterwards.
 */
function Skim({ video, at, strip }) {
    const was = useRef(null);
    useEffect(() => {
        if (strip || !video || !Number.isFinite(video.duration))
            return;
        if (was.current == null)
            was.current = video.currentTime;
        video.currentTime = at * video.duration;
    }, [at, strip, video]);
    useEffect(() => () => {
        if (video && was.current != null)
            video.currentTime = was.current;
    }, [video]);
    const frame = strip ? Math.min(strip.frames - 1, Math.floor(at * strip.frames)) : 0;
    return (_jsxs(_Fragment, { children: [strip && (_jsx("div", { className: "media-skim", "aria-hidden": "true", style: {
                    backgroundImage: `url(${strip.url})`,
                    backgroundSize: `${strip.frames * 100}% 100%`,
                    backgroundPosition: `${(frame / Math.max(1, strip.frames - 1)) * 100}% 0`,
                } })), _jsx("div", { className: "media-skim-line", "aria-hidden": "true", style: { left: `${at * 100}%` } })] }));
}
/**
 * Review status, in the card's top-left corner: the status tag when there is one
 * (click to change it), or a faint "Status" button while the card is hovered or
 * selected. Picks for the version on show. The list opens as a pop-up above the
 * board (so the card can't clip it, and it's the same size at any zoom).
 */
function CardStatus({ id, version, value }) {
    const [at, setAt] = useState(null);
    const ctl = useRef(null);
    const menu = useRef(null);
    const st = statusInfo(value);
    const open = !!at;
    useEffect(() => {
        if (!open)
            return;
        const close = () => setAt(null);
        const off = (e) => {
            const t = e.target;
            if (!menu.current?.contains(t) && !ctl.current?.contains(t))
                close();
        };
        const esc = (e) => { if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        } };
        window.addEventListener('pointerdown', off, true);
        window.addEventListener('keydown', esc, true);
        window.addEventListener('wheel', close, { passive: true });
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('pointerdown', off, true);
            window.removeEventListener('keydown', esc, true);
            window.removeEventListener('wheel', close);
            window.removeEventListener('resize', close);
        };
    }, [open]);
    // Its own clicks don't pick up or select the card.
    const keep = { onPointerDown: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation() };
    return (_jsxs("span", { ref: ctl, className: "media-status-ctl", "data-set": st ? true : undefined, "data-open": open || undefined, ...keep, children: [_jsxs("button", { className: "media-status", style: st ? { '--st': st.color } : undefined, "aria-haspopup": "menu", "aria-expanded": open, title: st ? `Review status: ${st.label} (click to change)` : 'Set a review status', onClick: (e) => {
                    if (open) {
                        setAt(null);
                        return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    setAt({ left: Math.min(r.left, window.innerWidth - 180), top: r.bottom + 6 });
                }, children: [st ? st.label : 'Status', _jsx(ChevronDown, { size: 11, strokeWidth: 2.6, "aria-hidden": "true" })] }), at && createPortal(_jsx("div", { ref: menu, className: "media-status-menu", role: "menu", style: { left: at.left, top: at.top }, children: [...STATUSES, null].map((s) => (_jsxs("button", { role: "menuitemradio", "aria-checked": (s?.value ?? null) === value, onClick: () => { setStatus(id, version, s?.value ?? null); setAt(null); }, children: [_jsx("span", { className: "review-dot", style: { background: s?.color ?? 'transparent' }, "data-none": !s || undefined }), _jsx("span", { children: s?.label ?? 'No status' }), (s?.value ?? null) === value && _jsx(Check, { size: 13, strokeWidth: 2.6, "aria-hidden": "true" })] }, s?.value ?? 'none'))) }), document.body)] }));
}
