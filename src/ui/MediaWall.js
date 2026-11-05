import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Several photos and videos at once: a grid in the player window, every video
// on one shared timeline so they play, pause and scrub together. No comments
// here; double-click a tile to open that one in the full player at the same
// moment (Esc comes back to the grid).
//
// Keeping 25 videos in step cheaply:
// - A master clock (not any one video) owns the time. It looks enough like a
//   <video> for the Scrubber and frame stepping to drive it.
// - Videos follow it by nudging their playback rate a few percent; they only
//   seek when they're well off (a seek on 25 decoders at once is what stutters).
// - While scrubbing, each video seeks to the latest time once its last seek
//   has landed, instead of queuing a seek per pointer move.
// - If one runs out of data the clock waits for it (and the others pause), so
//   they never drift apart over a slow load.
// - Per frame only the timecode and the timeline fill are touched, straight in
//   the DOM; React renders when the set of tiles or the controls change.
// - Proxies (720p) play where the server has made them; only one tile has sound.
// - Loading, two ways (the header's "Download first" switch, remembered):
//   Stream (default): every tile streams straight away, and playback starts once
//   each has a couple of seconds buffered; if one runs dry later, the clock waits.
//   Download first: each file is fetched whole and kept on this device
//   (lib/mediaCache), so playback and seeking never wait, and the next time is
//   instant. Copies kept earlier are used either way.
//   Nothing can be played until every video is ready: a ring in the middle shows
//   each one arriving.
//
// Keys: Space play-pause · K stop · ← → 5s · , . one frame · Home start · M sound · Esc close.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, HardDriveDownload, Maximize, Minimize, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import { useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { pathTo } from '../board/nav';
import { posOf } from '../board/actions';
import { playable, useLocalMedia } from '../board/media';
import { versionInfo, versionOf } from '../board/versions';
import { isTyping } from '../canvas/input';
import { cacheable, cachedUrl, warm } from '../lib/mediaCache';
import { fmtTimecode, FPS, Scrubber, stepFrame, useVideoFrame } from './Scrubber';
/** Most tiles at once (5 × 5). Past that, decoding and bandwidth stop keeping up on an ordinary laptop. */
export const MAX_WALL = 25;
const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true };
const CLOSE_MS = 110;
const IDLE_MS = 2200;
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
/** How far a playing video may be off before it's re-seeked rather than nudged. */
const SEEK_DRIFT = 0.35;
/** Most a video's rate is nudged by to catch up (±). */
const NUDGE = 0.08;
/** How close a paused video must be to the clock. */
const STILL_DRIFT = 0.02;
const SYNC_MS = 200;
const VOLUME_KEY = 'heist:volume';
/** After this long loading, offer to start with what's ready. */
const IMPATIENT_MS = 10_000;
/** Streaming: seconds each video needs buffered before they all start. */
const START_BUFFER = 2.5;
const MODE_KEY = 'heist:wall-mode';
function readMode() {
    try {
        return localStorage.getItem(MODE_KEY) === 'download' ? 'download' : 'stream';
    }
    catch {
        return 'stream';
    }
}
/** Seconds buffered from where the video is now. */
function bufferedAhead(v) {
    const t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= t + 0.05 && v.buffered.end(i) >= t)
            return v.buffered.end(i) - t;
    }
    return 0;
}
/** Open these together (the media among them, in reading order, at most MAX_WALL). */
export function openWall(ids) {
    const { items } = useBoard.getState();
    const media = ids.map((id) => items[id]).filter((it) => it?.kind === 'media')
        .map((it) => ({ id: it.id, p: posOf(it) }))
        .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)
        .map((e) => e.id);
    if (media.length < 2)
        return false;
    const shown = media.slice(0, MAX_WALL);
    useUi.getState().set({
        wall: shown,
        contextMenu: null,
        flyout: null,
        toast: media.length > MAX_WALL ? { text: `Playing the first ${MAX_WALL} of ${media.length} — ${MAX_WALL} at most at once`, at: Date.now() } : null,
    });
    return true;
}
/** How many photos and videos are in a selection. */
export const mediaCount = (ids) => {
    const { items } = useBoard.getState();
    return ids.filter((id) => items[id]?.kind === 'media').length;
};
/**
 * The shared time. Runs off the wall clock, so no one video's hiccups move
 * it; `hold` stops it while a video catches up. Shaped like a <video> (time,
 * duration, paused, play/pause, the same events) for Scrubber and stepFrame.
 */
class Clock extends EventTarget {
    duration = NaN;
    paused = true;
    loop = false;
    t = 0;
    since = 0;
    rate = 1;
    held = false;
    now() { return performance.now() / 1000; }
    emit(...names) { for (const n of names)
        this.dispatchEvent(new Event(n)); }
    get end() { return Number.isFinite(this.duration) ? this.duration : Infinity; }
    get currentTime() {
        if (this.paused || this.held)
            return this.t;
        return Math.min(this.end, this.t + (this.now() - this.since) * this.rate);
    }
    set currentTime(v) {
        this.t = Math.max(0, Math.min(this.end, v));
        this.since = this.now();
        this.emit('seeking', 'seeked', 'timeupdate');
    }
    get playbackRate() { return this.rate; }
    set playbackRate(r) {
        this.t = this.currentTime;
        this.since = this.now();
        this.rate = r;
        this.emit('ratechange');
    }
    get waiting() { return this.held && !this.paused; }
    setDuration(d) {
        if (d === this.duration)
            return;
        this.duration = d;
        this.emit('durationchange');
    }
    play() {
        if (!this.paused)
            return Promise.resolve();
        if (this.t >= this.end - 0.01)
            this.t = 0;
        this.paused = false;
        this.since = this.now();
        this.emit('play');
        return Promise.resolve();
    }
    pause() {
        if (this.paused)
            return;
        this.t = this.currentTime;
        this.paused = true;
        this.held = false;
        this.emit('pause');
    }
    /** Stop the clock (true) while something buffers, and carry on (false). */
    hold(on) {
        if (on === this.held)
            return;
        this.t = this.currentTime;
        this.since = this.now();
        this.held = on;
        this.emit(on ? 'waiting' : 'playing');
    }
}
/** Columns that make the tiles as big as possible for this area and picture shape. */
function bestColumns(n, w, h, aspect) {
    let best = 1, area = 0;
    for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        const cw = w / c, ch = h / r;
        const fit = Math.min(cw, ch * aspect);
        if (fit * (fit / aspect) > area + 0.5) {
            area = fit * (fit / aspect);
            best = c;
        }
    }
    return best;
}
/**
 * A video's length: its own, or the server's figure while the browser doesn't
 * know (recorded WebM reports Infinity until it's been read to the end).
 */
function lengthOf(v) {
    if (Number.isFinite(v.duration) && v.duration > 0)
        return v.duration;
    const d = parseFloat(v.dataset.duration ?? '');
    return Number.isFinite(d) && d > 0 ? d : null;
}
function readVolume() {
    try {
        const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    }
    catch {
        return 1;
    }
}
export function MediaWall() {
    const ids = useUi((s) => s.wall);
    const [mode, setMode] = useState(readMode);
    if (!ids?.length)
        return null;
    const pick = (m) => { setMode(m); try {
        localStorage.setItem(MODE_KEY, m);
    }
    catch { /* fine */ } };
    return createPortal(_jsx(Wall, { ids: ids, mode: mode, onMode: pick }, `${ids.join()}|${mode}`), document.body);
}
function Wall({ ids, mode, onMode }) {
    const items = useBoard(useShallow((s) => ids.map((id) => s.items[id]).filter((it) => it?.kind === 'media')));
    const locals = useLocalMedia(useShallow((s) => ids.map((id) => s[id]?.url)));
    const single = useUi((s) => s.viewer != null);
    const clock = useMemo(() => new Clock(), []);
    const videos = useRef(new Map());
    const everyVideo = useRef(new Set());
    const refFns = useRef(new Map());
    const panel = useRef(null);
    const grid = useRef(null);
    const stage = useRef(null);
    const timeRef = useRef(null);
    const [size, setSize] = useState({ w: 1200, h: 700 });
    const [playing, setPlaying] = useState(false);
    const [loop, setLoop] = useState(true);
    const [rate, setRate] = useState(1);
    const [speedMenu, setSpeedMenu] = useState(false);
    const [audible, setAudible] = useState(null);
    const [hasTime, setHasTime] = useState(false);
    const [full, setFull] = useState(false);
    const [idle, setIdle] = useState(false);
    const [closing, setClosing] = useState(false);
    /** Per video: download progress (0-1), how it'll play once fetched, and whether it can play. */
    const [progress, setProgress] = useState({});
    /** What each tile plays once its file is in: the saved copy (blob:), or the network if it couldn't be saved. */
    const [fetched, setFetched] = useState({});
    const [canPlay, setCanPlay] = useState({});
    const [fromCache, setFromCache] = useState(0);
    const [impatient, setImpatient] = useState(false);
    const [forced, setForced] = useState(false);
    const crumbs = useBoard(useShallow((s) => (items[0] ? pathTo(items[0].boardId, s.items).map((c) => c.title) : [])));
    const fps = items.find((it) => it.mediaType === 'video' && it.meta.fps)?.meta.fps ?? FPS;
    const fmt = (t) => fmtTimecode(t, fps);
    // --- Keeping the videos on the clock --------------------------------------------
    //
    // Playing, they follow the clock by nudging their speed. Anything bigger — starting,
    // a jump, one drifting well off, one running out of data — is a "line-up": the clock
    // stops, every video pauses and seeks to the same frame, and only when all of them
    // have landed and have data to play do they start again, on the same tick. (Seeking
    // while the clock runs on is a chase: slow seekers land late, are off again, seek
    // again, and never catch up.)
    const waitTicks = useRef(0);
    /** Set while lining up. */
    const lining = useRef(false);
    const showWaiting = (on) => stage.current?.toggleAttribute('data-waiting', on);
    /** Stop the clock and line everyone up at its time. */
    const lineUp = () => {
        clock.hold(true);
        lining.current = true;
        waitTicks.current = 0;
        showWaiting(true);
        syncRef.current();
    };
    const sync = () => {
        const t = clock.currentTime;
        const run = !clock.paused;
        const vids = [...videos.current.values()].filter((v) => !v.error);
        // Lining up: everyone to the same frame, then go together.
        if (run && lining.current) {
            let all = true;
            for (const v of vids) {
                const length = lengthOf(v);
                if (v.readyState < 1 || length == null) {
                    all = false;
                    continue;
                }
                const last = Math.max(0, length - 0.04);
                const want = Math.min(t, last);
                if (!v.paused)
                    v.pause();
                if (v.seeking) {
                    all = false;
                    continue;
                }
                if (Math.abs(v.currentTime - want) > STILL_DRIFT) {
                    v.currentTime = want;
                    all = false;
                    continue;
                }
                // Ones past their end just hold their last frame; the rest need data to play on.
                if (t < last && v.readyState < 3)
                    all = false;
            }
            if (!all)
                return;
            lining.current = false;
            showWaiting(false);
            clock.hold(false);
            for (const v of vids) {
                const length = lengthOf(v);
                if (length == null || clock.currentTime >= length - 0.04)
                    continue;
                v.playbackRate = clock.playbackRate;
                void v.play().catch(() => { });
            }
            return;
        }
        // Paused: everyone holds the clock's frame. (While scrubbing, each re-seeks to the
        // latest time once its last seek has landed, rather than queueing one per move.)
        if (!run) {
            for (const v of vids) {
                const length = lengthOf(v);
                if (v.readyState < 1 || length == null)
                    continue;
                const want = Math.min(t, Math.max(0, length - 0.04));
                if (!v.paused)
                    v.pause();
                if (!v.seeking && Math.abs(v.currentTime - want) > STILL_DRIFT)
                    v.currentTime = want;
            }
            return;
        }
        // Playing: follow by speed; line up again if anything is badly off or out of data.
        let lineUpNow = false, starving = false;
        for (const v of vids) {
            const length = lengthOf(v);
            if (v.readyState < 1 || length == null) {
                lineUpNow = true;
                continue;
            }
            const last = Math.max(0, length - 0.04);
            if (t >= last) {
                // Shorter than the longest: stop on its last frame.
                if (!v.paused)
                    v.pause();
                if (!v.seeking && Math.abs(v.currentTime - last) > STILL_DRIFT)
                    v.currentTime = last;
                continue;
            }
            if (v.seeking) {
                starving = true;
                continue;
            }
            const drift = v.currentTime - t;
            if (Math.abs(drift) > SEEK_DRIFT) {
                lineUpNow = true;
                continue;
            }
            // Behind: a touch faster; ahead: a touch slower.
            v.playbackRate = clock.playbackRate * (1 - Math.max(-NUDGE, Math.min(NUDGE, drift * 0.8)));
            if (v.paused && !v.ended)
                void v.play().catch(() => { });
            if (v.readyState < 3)
                starving = true;
        }
        // Out of data for a moment (not just a blip): line up and wait for it.
        waitTicks.current = starving ? waitTicks.current + 1 : 0;
        if (lineUpNow || waitTicks.current >= 2)
            lineUp();
    };
    const syncRef = useRef(sync);
    syncRef.current = sync;
    // Clock events → videos. Starting and jumps line everyone up; paused seeks are coalesced to one per frame.
    useEffect(() => {
        let raf = 0;
        const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => syncRef.current()); };
        const onPlay = () => { setPlaying(true); lineUp(); };
        const onPause = () => { setPlaying(false); lining.current = false; showWaiting(false); syncRef.current(); };
        const onSeek = () => { if (clock.paused)
            later();
        else
            lineUp(); };
        const onRate = () => { if (!clock.paused)
            lineUp(); };
        clock.addEventListener('play', onPlay);
        clock.addEventListener('pause', onPause);
        clock.addEventListener('seeked', onSeek);
        clock.addEventListener('ratechange', onRate);
        const tick = setInterval(() => { if (!clock.paused)
            syncRef.current(); }, SYNC_MS);
        return () => {
            cancelAnimationFrame(raf);
            clearInterval(tick);
            clock.removeEventListener('play', onPlay);
            clock.removeEventListener('pause', onPause);
            clock.removeEventListener('seeked', onSeek);
            clock.removeEventListener('ratechange', onRate);
        };
    }, [clock]);
    /** The timeline is as long as the longest video. */
    const measure = () => {
        let d = 0;
        for (const it of items)
            if (it.mediaType === 'video')
                d = Math.max(d, versionInfo(it, versionOf(it)).meta.duration ?? 0);
        for (const v of videos.current.values())
            d = Math.max(d, lengthOf(v) ?? 0);
        clock.setDuration(d || NaN);
        setHasTime(d > 0);
    };
    useEffect(measure, [items]);
    const videoRef = (id) => {
        let fn = refFns.current.get(id);
        if (!fn) {
            fn = (el) => {
                if (el) {
                    el.muted = true;
                    videos.current.set(id, el);
                    everyVideo.current.add(el);
                }
                else
                    videos.current.delete(id);
            };
            refFns.current.set(id, fn);
        }
        return fn;
    };
    // On close, let go of the decoders now (just unmounting can leave them busy for a while).
    // Only ones really gone from the page: development mode rehearses unmounting.
    useEffect(() => () => {
        for (const v of everyVideo.current) {
            if (v.isConnected)
                continue;
            v.pause();
            v.removeAttribute('src');
            v.load();
            everyVideo.current.delete(v);
        }
    }, []);
    // --- Loading -----------------------------------------------------------------------
    const srcOf = (it) => {
        const info = versionInfo(it, versionOf(it));
        return playable(info.src, info.meta, info.current ? locals[ids.indexOf(it.id)] : undefined);
    };
    const videoItems = items.filter((it) => it.mediaType === 'video');
    // Progress updates, batched to one render per frame.
    const pending = useRef({});
    const flushRaf = useRef(0);
    const report = (id, f) => {
        pending.current[id] = f;
        if (!flushRaf.current)
            flushRaf.current = requestAnimationFrame(() => {
                flushRaf.current = 0;
                const batch = pending.current;
                pending.current = {};
                setProgress((p) => ({ ...p, ...batch }));
            });
    };
    // What each tile plays: a copy kept on this device if there is one; otherwise
    // the network straight away (stream), or once it's been fetched whole (download first).
    useEffect(() => {
        let live = true;
        for (const it of videoItems) {
            const src = srcOf(it);
            void cachedUrl(src).then((url) => {
                if (!live)
                    return;
                if (url) {
                    setFromCache((n) => n + 1);
                    setFetched((m) => ({ ...m, [it.id]: url }));
                    return;
                }
                if (mode === 'stream') {
                    setFetched((m) => ({ ...m, [it.id]: src }));
                    return;
                }
                void warm(src, (f) => report(it.id, f)).then(async (how) => {
                    const kept = (how === 'cached' && (await cachedUrl(src))) || src;
                    if (live)
                        setFetched((m) => ({ ...m, [it.id]: kept }));
                });
            });
        }
        const slow = setTimeout(() => setImpatient(true), IMPATIENT_MS);
        return () => { live = false; cancelAnimationFrame(flushRaf.current); clearTimeout(slow); };
    }, [ids.join()]);
    const markPlayable = (id) => setCanPlay((m) => (m[id] ? m : { ...m, [id]: true }));
    /** Streaming, before the start: is there enough buffered to begin? (Kept copies and downloads always are.) */
    const checkBuffer = (id, v) => {
        if (canPlay[id])
            return;
        if (v.error) {
            markPlayable(id);
            return;
        }
        const length = lengthOf(v) ?? START_BUFFER;
        const need = Math.min(START_BUFFER, Math.max(0.1, length - v.currentTime - 0.05));
        const ahead = bufferedAhead(v);
        if (v.readyState >= 4 || (v.readyState >= 3 && ahead >= need) || (v.src.startsWith('blob:') && v.readyState >= 3))
            markPlayable(id);
        else if (mode === 'stream')
            report(id, Math.min(0.99, ahead / need));
    };
    const readyCount = videoItems.filter((it) => canPlay[it.id]).length;
    const ready = forced || readyCount === videoItems.length;
    /** 0-1 for each video: the download is most of it, the last bit is the browser being able to play it. */
    const share = (id) => (canPlay[id] ? 1 : Math.min(0.95, (progress[id] ?? 0) * 0.95));
    // Everything in: start (muted, so the browser allows it).
    useEffect(() => {
        if (!ready || !videoItems.length)
            return;
        measure();
        void clock.play();
    }, [ready]);
    // Sound from one tile at a time.
    useEffect(() => {
        const vol = readVolume();
        for (const [id, v] of videos.current) {
            v.muted = id !== audible;
            v.volume = vol;
        }
    }, [audible, items.length]);
    useEffect(() => { if (timeRef.current)
        timeRef.current.textContent = fmt(clock.currentTime); });
    // Every frame while playing: the timecode, and stopping or looping at the end.
    useVideoFrame(clock, () => {
        const t = clock.currentTime;
        if (timeRef.current)
            timeRef.current.textContent = fmt(t);
        if (!clock.paused && Number.isFinite(clock.duration) && t >= clock.duration - 0.005) {
            if (loop)
                clock.currentTime = 0;
            else
                clock.pause();
        }
    });
    // --- Layout ---------------------------------------------------------------------
    useEffect(() => {
        const el = grid.current;
        if (!el)
            return;
        const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const aspects = items.map((it) => (it.meta.width && it.meta.height ? it.meta.width / it.meta.height : 16 / 9)).sort((a, b) => a - b);
    const aspect = aspects[Math.floor(aspects.length / 2)] ?? 16 / 9;
    const cols = bestColumns(items.length, size.w, size.h, aspect);
    const rows = Math.ceil(items.length / cols);
    // --- Window -----------------------------------------------------------------------
    const dismiss = () => {
        if (closing)
            return;
        clock.pause();
        setClosing(true);
        setTimeout(() => useUi.getState().set({ wall: null }), CLOSE_MS);
    };
    const toggleFull = () => {
        if (document.fullscreenElement)
            void document.exitFullscreen();
        else
            void stage.current?.requestFullscreen().catch(() => { });
    };
    useEffect(() => {
        const onFs = () => setFull(document.fullscreenElement === stage.current);
        document.addEventListener('fullscreenchange', onFs);
        return () => document.removeEventListener('fullscreenchange', onFs);
    }, []);
    useEffect(() => {
        if (!playing || !full) {
            setIdle(false);
            return;
        }
        let t = setTimeout(() => setIdle(true), IDLE_MS);
        const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS); };
        window.addEventListener('pointermove', wake);
        return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); };
    }, [playing, full]);
    useEffect(() => {
        if (!speedMenu)
            return;
        const off = (e) => { if (!e.target.closest?.('.viewer-speed'))
            setSpeedMenu(false); };
        window.addEventListener('pointerdown', off, true);
        return () => window.removeEventListener('pointerdown', off, true);
    }, [speedMenu]);
    // Opening one tile in the full player stops these; back here, they carry on from there.
    useEffect(() => { if (single)
        clock.pause(); }, [single, clock]);
    const togglePlay = () => { if (!hasTime || !ready)
        return; if (clock.paused)
        void clock.play();
    else
        clock.pause(); };
    const pickRate = (r) => { setRate(r); clock.playbackRate = r; setSpeedMenu(false); };
    const firstVideo = items.find((it) => it.mediaType === 'video')?.id ?? null;
    const toggleSound = () => setAudible((a) => (a ? null : firstVideo));
    const openOne = (id) => {
        clock.pause();
        const v = videos.current.get(id);
        useUi.getState().set({ viewer: { id, time: v ? Math.min(clock.currentTime, lengthOf(v) ?? 0) : 0 } });
    };
    useEffect(() => {
        const onKey = (e) => {
            if (useUi.getState().viewer)
                return; // the full player on top has the keys
            if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e))
                return;
            // Still loading: only closing works.
            if (!ready && e.key !== 'Escape') {
                if (e.key === ' ')
                    e.preventDefault();
                return;
            }
            const c = clock;
            const keys = {
                Escape: () => { if (speedMenu)
                    setSpeedMenu(false);
                else if (!document.fullscreenElement)
                    dismiss(); },
                ' ': togglePlay,
                k: () => c.pause(),
                ArrowLeft: () => { c.currentTime = c.currentTime - 5; },
                ArrowRight: () => { c.currentTime = c.currentTime + 5; },
                Home: () => { c.currentTime = 0; },
                ',': () => stepFrame(c, -1, fps),
                '.': () => stepFrame(c, 1, fps),
                m: toggleSound,
            };
            const run = keys[e.key] ?? keys[e.key.toLowerCase()];
            if (!run)
                return;
            e.preventDefault();
            e.stopPropagation();
            run();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    });
    const nVideos = items.filter((it) => it.mediaType === 'video').length;
    const nPhotos = items.length - nVideos;
    const summary = [nVideos && `${nVideos} video${nVideos === 1 ? '' : 's'}`, nPhotos && `${nPhotos} photo${nPhotos === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return (_jsx("div", { className: "viewer wall", "data-closing": closing || undefined, role: "dialog", "aria-modal": "true", "aria-label": `${items.length} side by side`, onPointerDown: (e) => { if (e.target === e.currentTarget)
            dismiss(); }, children: _jsxs("div", { ref: panel, className: "viewer-panel wall-panel", children: [_jsxs("header", { className: "viewer-top", children: [_jsx("button", { className: "viewer-btn", onClick: dismiss, title: "Back to the board (Esc)", "aria-label": "Close", children: _jsx(ChevronLeft, { ...ICON }) }), _jsxs("nav", { className: "viewer-path", "aria-label": "Where these are", children: [crumbs.map((c, i) => _jsx("span", { className: "viewer-crumb", children: c }, i)), _jsx("span", { className: "viewer-file", children: "Side by side" }), _jsx("span", { className: "viewer-meta", children: summary })] }), cacheable() && videoItems.length > 0 && (_jsxs("button", { className: "viewer-compare wall-mode", "aria-pressed": mode === 'download', onClick: () => onMode(mode === 'download' ? 'stream' : 'download'), title: mode === 'download'
                                ? 'Downloading each video in full before playing (smoothest, and instant next time). Click to stream instead: starts sooner'
                                : 'Streaming: starts as soon as every video has a few seconds buffered. Click to download each in full first: slower to start, never stalls, instant next time', children: [_jsx(HardDriveDownload, { size: 16, strokeWidth: 2, "aria-hidden": "true" }), " Download first"] }))] }), _jsxs("section", { ref: stage, className: "viewer-main", "data-idle": idle || undefined, "data-full": full || undefined, "data-loading": !ready || undefined, children: [_jsxs("div", { ref: grid, className: "wall-grid", style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }, children: [items.map((it, i) => {
                                    const info = versionInfo(it, versionOf(it));
                                    const src = srcOf(it);
                                    const video = it.mediaType === 'video';
                                    const loud = audible === it.id;
                                    const loading = video && !canPlay[it.id];
                                    return (_jsxs("div", { className: "wall-tile", "data-loud": loud || undefined, "data-loading": loading || undefined, style: { '--p': share(it.id) }, onDoubleClick: () => openOne(it.id), title: "Double-click to open on its own", children: [video ? (_jsx("video", { ref: videoRef(it.id), 
                                                // Only once it's fetched (then it plays from this device); the poster shows meanwhile.
                                                src: fetched[it.id] || undefined, poster: info.meta.poster, "data-duration": info.meta.duration, preload: "auto", playsInline: true, muted: true, disablePictureInPicture: true, onLoadedMetadata: () => { measure(); syncRef.current(); }, onDurationChange: measure, onSeeked: () => { if (clock.paused || lining.current)
                                                    syncRef.current(); }, onCanPlay: (e) => { checkBuffer(it.id, e.currentTarget); if (lining.current)
                                                    syncRef.current(); }, onCanPlayThrough: (e) => checkBuffer(it.id, e.currentTarget), onProgress: (e) => checkBuffer(it.id, e.currentTarget), onLoadedData: (e) => checkBuffer(it.id, e.currentTarget), onError: () => markPlayable(it.id), onClick: togglePlay })) : (_jsx("img", { src: src || undefined, alt: it.name, draggable: false, loading: "eager", decoding: "async" })), _jsxs("span", { className: "wall-label", children: [_jsx("b", { children: i + 1 }), _jsx("span", { children: info.name || it.name || 'Untitled' }), info.n > 1 && _jsxs("span", { className: "wall-v", children: ["v", info.n] })] }), video && (_jsx("button", { className: "wall-sound", "aria-pressed": loud, onClick: (e) => { e.stopPropagation(); setAudible(loud ? null : it.id); }, onDoubleClick: (e) => e.stopPropagation(), title: loud ? 'Mute this one' : 'Hear this one (the others go quiet)', "aria-label": loud ? 'Mute' : 'Sound from this one', children: loud ? _jsx(Volume2, { size: 15, strokeWidth: 2, "aria-hidden": "true" }) : _jsx(VolumeX, { size: 15, strokeWidth: 2, "aria-hidden": "true" }) }))] }, it.id));
                                }), _jsx("span", { className: "wall-waiting", "aria-label": "Buffering", children: _jsx("i", {}) }), videoItems.length > 0 && (_jsx(WallLoader, { shares: videoItems.map((it) => share(it.id)), ready: ready, done: readyCount, fromCache: fromCache, mode: mode, onStart: impatient && readyCount > 0 && !ready ? () => setForced(true) : undefined }))] }), hasTime && (_jsx("div", { className: "viewer-timeline", inert: !ready, children: _jsx(Scrubber, { video: clock, className: "viewer-scrub", format: fmt }) })), _jsxs("div", { className: "viewer-bar", children: [_jsx("div", { className: "viewer-bar-side", children: hasTime && (_jsxs(_Fragment, { children: [_jsx("button", { className: "viewer-btn", onClick: togglePlay, disabled: !ready, title: !ready ? 'Loading…' : playing ? 'Pause all (Space)' : 'Play all (Space)', "aria-label": playing ? 'Pause' : 'Play', children: playing ? _jsx(Pause, { ...ICON, fill: "currentColor" }) : _jsx(Play, { ...ICON, fill: "currentColor" }) }), _jsx("button", { className: "viewer-btn", "aria-pressed": loop, onClick: () => setLoop((l) => !l), title: "Loop", "aria-label": "Loop", children: _jsx(Repeat, { size: 17, strokeWidth: 2, "aria-hidden": "true" }) }), _jsxs("div", { className: "viewer-speed", children: [_jsxs("button", { className: "viewer-btn viewer-rate", "aria-haspopup": "menu", "aria-expanded": speedMenu, title: "Playback speed", onClick: () => setSpeedMenu((o) => !o), children: [rate, "x"] }), speedMenu && (_jsx("div", { className: "viewer-speed-menu", role: "menu", children: [...SPEEDS].reverse().map((r) => (_jsx("button", { role: "menuitemradio", "aria-checked": r === rate, onClick: () => pickRate(r), children: r === 1 ? 'Normal' : `${r}×` }, r))) }))] }), _jsx("button", { className: "viewer-btn", onClick: toggleSound, disabled: !firstVideo, title: audible ? 'Mute (M)' : 'Sound on (M) — or pick a tile’s speaker', "aria-label": audible ? 'Mute' : 'Sound on', children: audible ? _jsx(Volume2, { ...ICON }) : _jsx(VolumeX, { ...ICON }) })] })) }), hasTime && _jsx("button", { ref: timeRef, className: "viewer-time", title: "Timecode (the longest video sets the length)", tabIndex: -1 }), _jsx("div", { className: "viewer-bar-side viewer-bar-end", children: _jsx("button", { className: "viewer-btn", onClick: toggleFull, title: full ? 'Exit full screen' : 'Full screen', "aria-label": full ? 'Exit full screen' : 'Full screen', children: full ? _jsx(Minimize, { ...ICON }) : _jsx(Maximize, { ...ICON }) }) })] })] })] }) }));
}
/**
 * The loading ring: one segment per video, each filling as its file arrives,
 * with the overall percentage in the middle. Fades out once all can play.
 */
function WallLoader({ shares, ready, done, fromCache, mode, onStart }) {
    const n = shares.length;
    const R = 78, STROKE = 10, SIZE = (R + STROKE) * 2, MID = SIZE / 2;
    const C = 2 * Math.PI * R;
    const gap = n > 1 ? Math.min(6, C / n / 3) : 0;
    const seg = C / n - gap;
    const total = shares.reduce((a, b) => a + b, 0) / n;
    return (_jsxs("div", { className: "wall-loader", "data-done": ready || undefined, "aria-hidden": ready || undefined, role: "status", children: [_jsxs("div", { className: "wall-loader-card", children: [_jsx("svg", { className: "wall-ring", width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, "aria-hidden": "true", children: _jsx("g", { className: "wall-ring-spin", style: { transformOrigin: `${MID}px ${MID}px` }, children: shares.map((p, i) => {
                                const rot = -90 + (360 / n) * i + (gap / C) * 180;
                                return (_jsxs("g", { transform: `rotate(${rot} ${MID} ${MID})`, children: [_jsx("circle", { className: "wall-ring-track", cx: MID, cy: MID, r: R, strokeWidth: STROKE, strokeDasharray: `${seg} ${C}` }), _jsx("circle", { className: "wall-ring-fill", "data-full": p >= 1 || undefined, cx: MID, cy: MID, r: R, strokeWidth: STROKE, strokeDasharray: `${Math.max(0.001, seg * p)} ${C}` })] }, i));
                            }) }) }), _jsxs("div", { className: "wall-loader-text", children: [_jsxs("b", { children: [Math.floor(total * 100), _jsx("small", { children: "%" })] }), _jsxs("span", { children: [done, " of ", n, " ready"] })] })] }), _jsx("p", { className: "wall-loader-note", children: fromCache === n
                    ? 'Already on this device'
                    : mode === 'stream'
                        ? `Buffering${fromCache ? ` \u00b7 ${fromCache} already on this device` : ''} \u00b7 starts when every video can play`
                        : fromCache > 0 ? `${fromCache} already on this device \u00b7 downloading the rest in full` : 'Downloading in full, so playback never waits and next time is instant' }), onStart && _jsxs("button", { className: "wall-loader-start", onClick: onStart, children: ["Start with ", done, " ready"] })] }));
}
