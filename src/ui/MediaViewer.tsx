// Player for a photo, GIF or video: centred at about half the screen over a
// dimmed, blurred board. Opens from a double-click (or Enter) on a media card;
// the button at the lower left of the controls goes full screen.
//
// Keys: Space / K play-pause · ← → 5s · , . one frame · M mute · F full screen · Esc close
// Click the time readout to switch between time and frame numbers.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { mediaSubtitle, useLocalMedia } from '../board/media';
import { fmtFrames, fmtTime, FPS, Scrubber, stepFrame, useVideoFrame } from './Scrubber';

const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true } as const;
/** Controls fade out after this long without the mouse moving (while playing). */
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

function Player({ id, start }: { id: string; start: number }) {
  const item = useBoard((s) => s.items[id]);
  const local = useLocalMedia((s) => s[id]);
  const stage = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLButtonElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [closing, setClosing] = useState(false);
  const [units, setUnits] = useState(readUnits);
  const [rate, setRate] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => useUi.getState().set({ viewer: null }), CLOSE_MS);
  };

  const fmt = units === 'frames' ? fmtFrames : fmtTime;
  const drawTime = (v: HTMLVideoElement) => {
    if (timeRef.current) timeRef.current.textContent = `${fmt(v.currentTime)} / ${fmt(units === 'time' ? Math.round(v.duration) : v.duration)}`;
  };
  useVideoFrame(video, drawTime);
  useEffect(() => { if (video) drawTime(video); });
  useEffect(() => { if (video) video.playbackRate = rate; }, [video, rate]);

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
    const go = () => { video.currentTime = start; void video.play().catch(() => {}); };
    if (video.readyState >= 1) go(); else video.addEventListener('loadedmetadata', go, { once: true });
  }, [video, start]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Hide the controls while a video plays and the mouse is still.
  useEffect(() => {
    if (!playing) { setIdle(false); return; }
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS); };
    window.addEventListener('pointermove', wake);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); };
  }, [playing]);

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

  // Keys go to the player only while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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

  if (item?.kind !== 'media') return null;
  const src = local?.url || item.src;
  const isVideo = item.mediaType === 'video';
  const { width = 16, height = 9 } = item.meta;

  return (
    <div
      className="viewer"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={item.name || 'Media'}
      onPointerDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="viewer-panel" style={{ '--ar': width / height } as CSSProperties}>
        <header className="viewer-head">
          <div className="viewer-title">
            <div className="viewer-name">{item.name || 'Untitled'}</div>
            <div className="viewer-sub">{mediaSubtitle(item.meta)}</div>
          </div>
          {item.src && (
            <a className="viewer-btn" href={item.src} target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">
              <ExternalLink {...ICON} />
            </a>
          )}
          <button className="viewer-btn" onClick={dismiss} title="Close (Esc)" aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div ref={stage} className="viewer-stage" data-idle={idle || undefined} data-full={full || undefined}>
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

          <div className="viewer-controls" data-video={isVideo || undefined}>
            {isVideo && (
              <>
                <button className="viewer-btn" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause {...ICON} fill="currentColor" /> : <Play {...ICON} fill="currentColor" />}
                </button>
                <button
                  ref={timeRef}
                  className="viewer-time"
                  data-units={units}
                  title={units === 'frames' ? `Frames at ${FPS} fps — click for time` : 'Click for frames'}
                  onClick={toggleUnits}
                />
                <Scrubber video={video} className="viewer-scrub" format={fmt} />
                <div className="viewer-speed">
                  <button
                    className="viewer-btn viewer-rate"
                    aria-haspopup="menu"
                    aria-expanded={speedMenu}
                    title="Playback speed"
                    onClick={() => setSpeedMenu((o) => !o)}
                  >
                    {rate}×
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
            <button className="viewer-btn viewer-full" onClick={toggleFull} title={full ? 'Exit full screen (F)' : 'Full screen (F)'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
              {full ? <Minimize {...ICON} /> : <Maximize {...ICON} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
