// Player for a photo, GIF or video, laid out like a review tool: a large
// window over the dimmed, blurred board with the picture on the left (about
// 70% of the width), a full-width timeline with comment markers and the
// controls under it, and every comment down the right. Opens from a
// double-click (or Enter) on a media card; ‹ › steps through the board's media.
//
// Keys: Space / K play-pause · ← → 5s · , . one frame · M mute · F full screen · Esc close
// Click the timecode to switch between timecode and frame numbers.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  ChevronLeft, ChevronRight, ExternalLink, Maximize, Minimize, Pause, Play, Repeat, Volume2, VolumeX,
} from 'lucide-react';
import { onCanvas, useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { pathTo } from '../board/nav';
import { posOf } from '../board/actions';
import { mediaSubtitle, useLocalMedia } from '../board/media';
import { commentIndex } from '../board/comments';
import { isTyping } from '../canvas/input';
import { personalColor, usePresence } from '../sync/presence';
import { fmtFrames, fmtTimecode, FPS, Scrubber, stepFrame, useVideoFrame } from './Scrubber';
import { CommentList, CommentLookContext, type CommentLook } from './Comments';
import { Avatar } from './Collab';

const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true } as const;
/** In full screen, controls fade out after this long without the mouse moving (while playing). */
const IDLE_MS = 2200;
/** Matches the closing animation in styles.css. */
const CLOSE_MS = 110;
const UNITS_KEY = 'heist:timecode';
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
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
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
    .filter((c) => !c.replyTo && !c.resolved && c.time != null)));
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

  // Close the speed menu on any press outside it.
  useEffect(() => {
    if (!speedMenu) return;
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.viewer-speed')) setSpeedMenu(false); };
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  }, [speedMenu]);

  // Start where the card left off, playing.
  useEffect(() => {
    if (!video) return;
    const begin = () => { video.currentTime = start; void video.play().catch(() => {}); };
    if (video.readyState >= 1) begin(); else video.addEventListener('loadedmetadata', begin, { once: true });
  }, [video, start]);

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
        m: () => { if (v) v.muted = !v.muted; },
        f: toggleFull,
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
  }), [activeId, isVideo, video]);

  if (item?.kind !== 'media') return null;
  const src = local?.url || item.src;
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
      <div className="viewer-panel">
        <header className="viewer-top">
          <button className="viewer-btn" onClick={dismiss} title="Back to the board (Esc)" aria-label="Close">
            <ChevronLeft {...ICON} />
          </button>
          <nav className="viewer-path" aria-label="Where this is">
            {crumbs.map((c) => <span key={c.id} className="viewer-crumb">{c.title}</span>)}
            <span className="viewer-file" title={item.name}>{item.name || 'Untitled'}</span>
            <span className="viewer-meta">{mediaSubtitle(item.meta)}</span>
          </nav>
          {item.src && (
            <a className="viewer-btn" href={item.src} target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">
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
          <div className="viewer-picture">
            {isVideo ? (
              <video
                ref={setVideo}
                src={src}
                playsInline
                onClick={togglePlay}
                onDoubleClick={toggleFull}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
              />
            ) : (
              // Photos and GIFs (GIFs just loop, like on the card).
              <img src={src} alt={item.name} onDoubleClick={toggleFull} draggable={false} />
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
                  <button
                    className="viewer-btn"
                    onClick={() => { if (video) video.muted = !video.muted; }}
                    title={muted ? 'Unmute (M)' : 'Mute (M)'}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                  >
                    {muted ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
                  </button>
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
              <button className="viewer-btn" onClick={toggleFull} title={full ? 'Exit full screen (F)' : 'Full screen (F)'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                {full ? <Minimize {...ICON} /> : <Maximize {...ICON} />}
              </button>
            </div>
          </div>
        </section>

        {/* Every comment on this item; on a video, in timecode order. */}
        <aside className="viewer-side" onPointerDown={(e) => e.stopPropagation()}>
          <CommentLookContext.Provider value={look}>
            <CommentList
              targetId={id}
              clock={isVideo ? () => video?.currentTime ?? null : undefined}
              onSeek={isVideo ? seek : undefined}
            />
          </CommentLookContext.Provider>
        </aside>
      </div>
    </div>
  );
}
