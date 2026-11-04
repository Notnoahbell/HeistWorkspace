// Player for a photo, GIF or video, laid out like a review tool: a window
// (most of the screen) over the dimmed, blurred board with the picture on the
// left, a full-width timeline with comment markers and the controls under it,
// and every comment down the right (which can be hidden). Opens from a
// double-click (or Enter) on a media card; ‹ › steps through the board's media.
// A video with versions has a version menu (comments follow the version) and
// Compare: two versions side by side, playing together.
//
// Keys: Space / K play-pause · ← → 5s · , . one frame · M mute · C comments · Esc close
// Full screen only from its button (a double-click or stray key shouldn't throw you into it).
// Click the timecode to switch between timecode and frame numbers.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  ChevronLeft, ChevronRight, Columns2, ExternalLink, Maximize, MessageSquare, Minimize, Pause, Play, Repeat, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { onCanvas, useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { pathTo } from '../board/nav';
import { posOf } from '../board/actions';
import { mediaSubtitle, useLocalMedia } from '../board/media';
import { commentIndex, useOpenCount } from '../board/comments';
import { commentVersion, versionInfo, versionOf } from '../board/versions';
import { isTyping } from '../canvas/input';
import { personalColor, usePresence } from '../sync/presence';
import { fmtFrames, fmtTimecode, FPS, Scrubber, stepFrame, useVideoFrame } from './Scrubber';
import { CommentList, CommentLookContext, type CommentLook } from './Comments';
import { Avatar } from './Collab';
import { VersionMenu } from './VersionMenu';

const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true } as const;
/** In full screen, controls fade out after this long without the mouse moving (while playing). */
const IDLE_MS = 2200;
/** Matches the closing animation in styles.css. */
const CLOSE_MS = 110;
const UNITS_KEY = 'heist:timecode';
const VOLUME_KEY = 'heist:volume';
const SIDE_KEY = 'heist:viewer-comments';
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export const openViewer = (id: string, time = 0) => useUi.getState().set({ viewer: { id, time } });

export function MediaViewer() {
  const viewer = useUi((s) => s.viewer);
  const item = useBoard((s) => (viewer ? s.items[viewer.id] : undefined));
  if (!viewer || item?.kind !== 'media') return null;
  return createPortal(<Player key={viewer.id} id={viewer.id} start={viewer.time} />, document.body);
}

function readUnits(): 'time' | 'frames' {
  try { return localStorage.getItem(UNITS_KEY) === 'frames' ? 'frames' : 'time'; } catch { return 'time'; }
}
function readVolume(): number {
  try { const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? ''); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; } catch { return 1; }
}
function readSide(): boolean {
  try { return localStorage.getItem(SIDE_KEY) !== 'hidden'; } catch { return true; }
}
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* fine: just not remembered */ } };

/** Photos and videos on the same board, top to bottom then left to right. */
function useSiblings(boardId: string) {
  return useBoard(useShallow((s) => Object.values(s.items)
    .filter((it) => it.kind === 'media' && it.boardId === boardId && onCanvas(it))
    .map((it) => ({ id: it.id, p: posOf(it) }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)
    .map((e) => e.id)));
}

function Player({ id, start }: { id: string; start: number }) {
  const item = useBoard((s) => s.items[id]);
  const items = useBoard((s) => s.items);
  const local = useLocalMedia((s) => s[id]);
  const stage = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLButtonElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  /** The version on the right while comparing. */
  const [other, setOther] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // Which version is showing (the current one to begin with, and again when a newer one arrives).
  const current = item?.kind === 'media' ? versionOf(item) : 1;
  const [version, setVersion] = useState(current);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  useEffect(() => { setVersion(current); setCompareWith(null); }, [current]);
  /** Where (and whether) to carry on when switching versions. */
  const resume = useRef({ at: start, play: true });
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(readVolume);
  const [side, setSide] = useState(readSide);
  const openCount = useOpenCount(id, version);
  const [loop, setLoop] = useState(false);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [closing, setClosing] = useState(false);
  const [units, setUnits] = useState(readUnits);
  const [rate, setRate] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [duration, setDuration] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const siblings = useSiblings(item?.boardId ?? '');
  const markers = useBoard(useShallow((s) => (commentIndex(s.items).get(id) ?? [])
    .filter((c) => !c.replyTo && !c.resolved && c.time != null && commentVersion(c) === version)));
  const users = usePresence((s) => s.users);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => useUi.getState().set({ viewer: null }), CLOSE_MS);
  };
  const go = (to: string | undefined) => {
    if (to) useUi.getState().set({ viewer: { id: to, time: 0 }, selectedIds: [to] });
  };

  const fmt = units === 'frames' ? fmtFrames : fmtTimecode;
  const drawTime = (v: HTMLVideoElement) => {
    if (timeRef.current) timeRef.current.textContent = fmt(v.currentTime);
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (d !== duration) setDuration(d);
  };
  useVideoFrame(video, drawTime);
  useEffect(() => { if (video) drawTime(video); });
  useEffect(() => { if (video) video.playbackRate = rate; }, [video, rate]);
  useEffect(() => { if (video) video.loop = loop; }, [video, loop]);
  useEffect(() => { if (video) video.volume = readVolume(); }, [video]);

  // Close the speed menu on any press outside it.
  useEffect(() => {
    if (!speedMenu) return;
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.viewer-speed')) setSpeedMenu(false); };
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  }, [speedMenu]);

  // Start where the card left off, playing; after switching versions, carry on from the same moment.
  useEffect(() => {
    if (!video) return;
    const { at, play } = resume.current;
    const begin = () => { video.currentTime = at; if (play) void video.play().catch(() => {}); };
    if (video.readyState >= 1) begin(); else video.addEventListener('loadedmetadata', begin, { once: true });
  }, [video]);
  const pickVersion = (n: number) => {
    if (n === version) return;
    resume.current = { at: video?.currentTime ?? 0, play: !!video && !video.paused };
    setVersion(n);
    if (compareWith === n) setCompareWith(null);
    setActiveId(null);
  };

  // Comparing: the right-hand video follows the left one (play, pause, seek, speed, loop), muted.
  useEffect(() => {
    if (!video || !other) return;
    other.muted = true;
    const clampTo = () => Math.max(0, Math.min(video.currentTime, Number.isFinite(other.duration) ? other.duration - 0.05 : video.currentTime));
    const align = (force = false) => {
      const t = clampTo();
      if (force || Math.abs(other.currentTime - t) > 0.12) other.currentTime = t;
      if (!video.paused && other.paused && video.currentTime < (other.duration || Infinity)) void other.play().catch(() => {});
      if (video.paused && !other.paused) other.pause();
    };
    const onPlay = () => align(true);
    const onPause = () => { other.pause(); align(true); };
    const onSeek = () => align(true);
    const onRate = () => { other.playbackRate = video.playbackRate; };
    const ready = () => { onRate(); other.loop = video.loop; align(true); };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeking', onSeek);
    video.addEventListener('ratechange', onRate);
    if (other.readyState >= 1) ready(); else other.addEventListener('loadedmetadata', ready, { once: true });
    const drift = setInterval(() => align(), 500);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeek);
      video.removeEventListener('ratechange', onRate);
      clearInterval(drift);
    };
  }, [video, other]);
  useEffect(() => { if (other) other.loop = loop; }, [other, loop]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // In full screen, hide the controls while a video plays and the mouse is still.
  useEffect(() => {
    if (!playing || !full) { setIdle(false); return; }
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS); };
    window.addEventListener('pointermove', wake);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); };
  }, [playing, full]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen().catch(() => {});
  };
  const togglePlay = () => { if (video) { if (video.paused) void video.play(); else video.pause(); } };
  const toggleUnits = () => {
    const next = units === 'frames' ? 'time' : 'frames';
    setUnits(next);
    try { localStorage.setItem(UNITS_KEY, next); } catch { /* fine: just not remembered */ }
  };
  const seek = (t: number) => { if (video) { video.pause(); video.currentTime = t; } };
  const toggleSide = () => setSide((on) => { remember(SIDE_KEY, on ? 'hidden' : 'shown'); return !on; });
  const toggleMute = () => {
    if (!video) return;
    if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 0.5; }
    else video.muted = true;
  };

  // Keys go to the player only while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      const v = video;
      const keys: Record<string, () => void> = {
        Escape: () => { if (speedMenu) setSpeedMenu(false); else if (!document.fullscreenElement) dismiss(); },
        ' ': togglePlay, k: togglePlay,
        ArrowLeft: () => { if (v) v.currentTime = Math.max(0, v.currentTime - 5); },
        ArrowRight: () => { if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); },
        ',': () => { if (v) stepFrame(v, -1); }, '.': () => { if (v) stepFrame(v, 1); },
        m: toggleMute,
        c: toggleSide,
      };
      const run = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    };
    // Capture on window, so the board's own shortcuts never see these.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const isVideo = item?.kind === 'media' && item.mediaType === 'video';
  const look: CommentLook = useMemo(() => ({
    fmt: fmtTimecode,
    numbered: true,
    activeId,
    onPick: (c) => { setActiveId(c.id); if (isVideo && c.time != null) seek(c.time); },
    version,
  }), [activeId, isVideo, video, version]);

  if (item?.kind !== 'media') return null;
  const shown = versionInfo(item, version);
  const src = shown.current ? local?.url || item.src : shown.src;
  const versioned = isVideo && current > 1;
  const comparing = versioned && compareWith != null;
  const otherInfo = comparing ? versionInfo(item, compareWith!) : null;
  const startCompare = () => setCompareWith(comparing ? null : version > 1 ? version - 1 : version + 1);
  const crumbs = pathTo(item.boardId, items);
  const at = siblings.indexOf(id);

  return (
    <div
      className="viewer"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={item.name || 'Media'}
      onPointerDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="viewer-panel" data-side={side ? undefined : 'hidden'}>
        <header className="viewer-top">
          <button className="viewer-btn" onClick={dismiss} title="Back to the board (Esc)" aria-label="Close">
            <ChevronLeft {...ICON} />
          </button>
          <nav className="viewer-path" aria-label="Where this is">
            {crumbs.map((c) => <span key={c.id} className="viewer-crumb">{c.title}</span>)}
            <span className="viewer-file" title={shown.name}>{shown.name || 'Untitled'}</span>
            <span className="viewer-meta">{mediaSubtitle(shown.meta)}</span>
          </nav>
          {versioned && (
            <>
              <VersionMenu media={item} value={version} onPick={pickVersion} className="viewer-version" />
              <button
                className="viewer-compare"
                aria-pressed={comparing}
                onClick={startCompare}
                title={comparing ? 'Stop comparing' : 'Compare with another version, side by side'}
              >
                <Columns2 size={16} strokeWidth={2} aria-hidden="true" /> Compare
              </button>
            </>
          )}
          {src && (
            <a className="viewer-btn" href={shown.current ? item.src : shown.src} target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">
              <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            </a>
          )}
          {siblings.length > 1 && (
            <div className="viewer-step">
              <button className="viewer-btn" disabled={at <= 0} onClick={() => go(siblings[at - 1])} aria-label="Previous" title="Previous on this board">
                <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <span>{at + 1} of {siblings.length}</span>
              <button className="viewer-btn" disabled={at >= siblings.length - 1} onClick={() => go(siblings[at + 1])} aria-label="Next" title="Next on this board">
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
        </header>

        <section ref={stage} className="viewer-main" data-idle={idle || undefined} data-full={full || undefined}>
          <div className="viewer-picture" data-compare={comparing || undefined}>
            <div className="viewer-pane">
            {isVideo ? (
              <video
                key={src}
                ref={setVideo}
                src={src}
                playsInline
                onClick={togglePlay}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onVolumeChange={(e) => {
                  setMuted(e.currentTarget.muted);
                  setVolume(e.currentTarget.volume);
                  remember(VOLUME_KEY, String(e.currentTarget.volume));
                }}
              />
            ) : (
              // Photos and GIFs (GIFs just loop, like on the card).
              <img src={src} alt={item.name} draggable={false} />
            )}
            {comparing && <span className="viewer-pane-tag">v{version}{shown.current ? ' · Current' : ''}</span>}
            </div>
            {comparing && otherInfo && (
              <div className="viewer-pane">
                <video key={otherInfo.src} ref={setOther} src={otherInfo.src} playsInline muted onClick={togglePlay} />
                <VersionMenu
                  media={item}
                  value={otherInfo.n}
                  onPick={(n) => setCompareWith(n)}
                  disabled={[version]}
                  className="viewer-pane-tag viewer-pane-pick"
                  label={`v${otherInfo.n}${otherInfo.current ? ' · Current' : ''}`}
                />
              </div>
            )}
          </div>

          {isVideo && (
            <div className="viewer-timeline">
              <Scrubber video={video} className="viewer-scrub" format={fmt} />
              {/* Who commented where: click to jump there and pick the comment. */}
              <div className="viewer-markers">
                {duration > 0 && markers.map((c) => {
                  const p = users[c.authorId];
                  return (
                    <button
                      key={c.id}
                      className="viewer-marker"
                      data-active={c.id === activeId || undefined}
                      style={{ left: `${Math.min(1, c.time! / duration) * 100}%` }}
                      title={`${p?.name ?? c.authorName} · ${fmtTimecode(c.time!)}\n${c.text}`}
                      onClick={() => { setActiveId(c.id); seek(c.time!); }}
                    >
                      <Avatar profile={{ name: p?.name ?? c.authorName, icon: p?.icon ?? null }} color={personalColor(c.authorId)} size={16} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="viewer-bar">
            <div className="viewer-bar-side">
              {isVideo && (
                <>
                  <button className="viewer-btn" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? <Pause {...ICON} fill="currentColor" /> : <Play {...ICON} fill="currentColor" />}
                  </button>
                  <button className="viewer-btn" aria-pressed={loop} onClick={() => setLoop((l) => !l)} title="Loop" aria-label="Loop">
                    <Repeat size={17} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <div className="viewer-speed">
                    <button
                      className="viewer-btn viewer-rate"
                      aria-haspopup="menu"
                      aria-expanded={speedMenu}
                      title="Playback speed"
                      onClick={() => setSpeedMenu((o) => !o)}
                    >
                      {rate}x
                    </button>
                    {speedMenu && (
                      <div className="viewer-speed-menu" role="menu">
                        {[...SPEEDS].reverse().map((r) => (
                          <button key={r} role="menuitemradio" aria-checked={r === rate} onClick={() => { setRate(r); setSpeedMenu(false); }}>
                            {r === 1 ? 'Normal' : `${r}×`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="viewer-volume">
                    <button
                      className="viewer-btn"
                      onClick={toggleMute}
                      title={muted || !volume ? 'Unmute (M)' : 'Mute (M)'}
                      aria-label={muted || !volume ? 'Unmute' : 'Mute'}
                    >
                      {muted || !volume ? <VolumeX {...ICON} /> : volume < 0.5 ? <Volume1 {...ICON} /> : <Volume2 {...ICON} />}
                    </button>
                    <input
                      type="range"
                      className="viewer-volume-slider"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      aria-label="Volume"
                      style={{ '--p': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
                      onChange={(e) => {
                        if (!video) return;
                        const v = parseFloat(e.target.value);
                        video.volume = v;
                        video.muted = v === 0;
                      }}
                    />
                  </div>
                </>
              )}
            </div>
            {isVideo && (
              <button
                ref={timeRef}
                className="viewer-time"
                data-units={units}
                title={units === 'frames' ? `Frame number at ${FPS} fps — click for timecode` : 'Timecode — click for frame numbers'}
                onClick={toggleUnits}
              />
            )}
            <div className="viewer-bar-side viewer-bar-end">
              <button
                className="viewer-btn viewer-side-toggle"
                aria-pressed={side}
                onClick={toggleSide}
                title={side ? 'Hide comments (C)' : 'Show comments (C)'}
                aria-label={side ? 'Hide comments' : 'Show comments'}
              >
                <MessageSquare {...ICON} />
                {!side && openCount > 0 && <span className="viewer-side-count">{openCount > 9 ? '9+' : openCount}</span>}
              </button>
              <button className="viewer-btn" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                {full ? <Minimize {...ICON} /> : <Maximize {...ICON} />}
              </button>
            </div>
          </div>
        </section>

        {/* Every comment on this item; on a video, in timecode order. */}
        {/* Stays mounted so it can slide in and out; inert (no focus, no clicks) while hidden. */}
        <aside className="viewer-side" inert={!side} aria-hidden={!side || undefined} onPointerDown={(e) => e.stopPropagation()}>
          <div className="viewer-side-inner">
            <CommentLookContext.Provider value={look}>
              <CommentList
                targetId={id}
                clock={isVideo ? () => video?.currentTime ?? null : undefined}
                onSeek={isVideo ? seek : undefined}
              />
            </CommentLookContext.Provider>
          </div>
        </aside>
      </div>
    </div>
  );
}
