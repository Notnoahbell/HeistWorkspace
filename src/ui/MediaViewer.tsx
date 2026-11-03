// Full-size player for a photo, GIF or video, over a dimmed board. Opens from
// a double-click (or Enter) on a media card; goes full screen from here.
//
// Keys: Space / K play-pause · ← → 5s · , . one frame · M mute · F full screen · Esc close

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { mediaSubtitle, useLocalMedia } from '../board/media';
import { fmtTime, Scrubber, useVideoFrame } from './Scrubber';

const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true } as const;
/** Step for , and . — real frame rate isn't exposed, 24fps is the common case. */
const FRAME = 1 / 24;
/** Controls fade out after this long without the mouse moving (while playing). */
const IDLE_MS = 2200;

export const openViewer = (id: string, time = 0) => useUi.getState().set({ viewer: { id, time } });
const close = () => useUi.getState().set({ viewer: null });

export function MediaViewer() {
  const viewer = useUi((s) => s.viewer);
  const item = useBoard((s) => (viewer ? s.items[viewer.id] : undefined));
  if (!viewer || item?.kind !== 'media') return null;
  return createPortal(<Player key={viewer.id} id={viewer.id} start={viewer.time} />, document.body);
}

function Player({ id, start }: { id: string; start: number }) {
  const item = useBoard((s) => s.items[id]);
  const local = useLocalMedia((s) => s[id]);
  const root = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);

  useVideoFrame(video, (v) => {
    if (timeRef.current) timeRef.current.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
  });

  // Start where the card left off, playing.
  useEffect(() => {
    if (!video) return;
    const go = () => { video.currentTime = start; void video.play().catch(() => {}); };
    if (video.readyState >= 1) go(); else video.addEventListener('loadedmetadata', go, { once: true });
  }, [video, start]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Hide the chrome while a video plays and the mouse is still.
  useEffect(() => {
    if (!playing) { setIdle(false); return; }
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS); };
    window.addEventListener('pointermove', wake);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); };
  }, [playing]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => {});
  };
  const togglePlay = () => { if (video) { if (video.paused) void video.play(); else video.pause(); } };

  // Keys go to the player only while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const v = video;
      const step = (d: number) => { if (v) { v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); } };
      const keys: Record<string, () => void> = {
        Escape: () => { if (!document.fullscreenElement) close(); },
        ' ': togglePlay, k: togglePlay,
        ArrowLeft: () => { if (v) v.currentTime = Math.max(0, v.currentTime - 5); },
        ArrowRight: () => { if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); },
        ',': () => step(-FRAME), '.': () => step(FRAME),
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

  return (
    <div
      ref={root}
      className="viewer"
      data-idle={idle || undefined}
      data-full={full || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={item.name || 'Media'}
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <header className="viewer-bar">
        <div className="viewer-title">
          <div className="viewer-name">{item.name || 'Untitled'}</div>
          <div className="viewer-sub">{mediaSubtitle(item.meta)}</div>
        </div>
        {item.src && (
          <a className="viewer-btn" href={item.src} target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">
            <ExternalLink {...ICON} />
          </a>
        )}
        <button className="viewer-btn" onClick={toggleFull} title={full ? 'Exit full screen (F)' : 'Full screen (F)'} aria-label="Full screen">
          {full ? <Minimize {...ICON} /> : <Maximize {...ICON} />}
        </button>
        <button className="viewer-btn" onClick={close} title="Close (Esc)" aria-label="Close">
          <X {...ICON} />
        </button>
      </header>

      <div className="viewer-stage" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
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
        <footer className="viewer-controls">
          <button className="viewer-btn" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause {...ICON} fill="currentColor" /> : <Play {...ICON} fill="currentColor" />}
          </button>
          <span ref={timeRef} className="viewer-time">0:00 / 0:00</span>
          <Scrubber video={video} className="viewer-scrub" hoverTime />
          <button
            className="viewer-btn"
            onClick={() => { if (video) video.muted = !video.muted; }}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
          </button>
        </footer>
      )}
    </div>
  );
}
