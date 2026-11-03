// A video timeline you can click or drag along. Progress is drawn straight to
// the DOM every frame while playing (no React re-render per frame), so it
// moves smoothly instead of in timeupdate's ~4 Hz steps.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Assumed frame rate for frame counts and stepping — browsers don't expose the real one. */
export const FPS = 24;

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};
export const fmtFrames = (s: number) => String(Number.isFinite(s) && s > 0 ? Math.round(s * FPS) : 0);

/** Calls `draw` every frame while the video plays, and once after any jump. */
export function useVideoFrame(video: HTMLVideoElement | null, draw: (v: HTMLVideoElement) => void) {
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const once = () => fn.current(video);
    const loop = () => { once(); raf = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    const stop = () => { cancelAnimationFrame(raf); once(); };
    const events: [string, () => void][] = [
      ['play', start], ['pause', stop], ['ended', stop], ['seeking', once], ['seeked', once],
      ['loadedmetadata', once], ['durationchange', once], ['timeupdate', once],
    ];
    for (const [e, f] of events) video.addEventListener(e, f);
    if (video.paused) once(); else start();
    return () => {
      cancelAnimationFrame(raf);
      for (const [e, f] of events) video.removeEventListener(e, f);
    };
  }, [video]);
}

/**
 * Whether a light or dark timeline stands out against the bottom of the
 * current frame. Re-sampled on seeks and twice a second while playing.
 */
export function useContrastTone(video: HTMLVideoElement | null): 'light' | 'dark' {
  const [tone, setTone] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    if (!video) return;
    const c = document.createElement('canvas');
    c.width = 32; c.height = 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    const sample = () => {
      if (!g || video.readyState < 2 || !video.videoWidth) return;
      try {
        const h = video.videoHeight;
        g.drawImage(video, 0, h * 0.88, video.videoWidth, h * 0.12, 0, 0, 32, 4);
        const d = g.getImageData(0, 0, 32, 4).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        setTone(sum / (d.length / 4) / 255 > 0.6 ? 'dark' : 'light');
      } catch { /* cross-origin frame: keep the default */ }
    };
    let timer = 0;
    const play = () => { clearInterval(timer); timer = window.setInterval(sample, 500); };
    const pause = () => { clearInterval(timer); sample(); };
    const events: [string, () => void][] = [['loadeddata', sample], ['seeked', sample], ['play', play], ['pause', pause]];
    for (const [e, f] of events) video.addEventListener(e, f);
    sample();
    if (!video.paused) play();
    return () => {
      clearInterval(timer);
      for (const [e, f] of events) video.removeEventListener(e, f);
    };
  }, [video]);
  return tone;
}

export function Scrubber({ video, className, tone = 'light', format }: {
  video: HTMLVideoElement | null;
  className?: string;
  /** Light timeline for dark backgrounds, dark for light ones. */
  tone?: 'light' | 'dark';
  /** Show this label for the time under the pointer while hovering. */
  format?: (seconds: number) => string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ resume: boolean } | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const paint = (frac: number) => { if (fill.current) fill.current.style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`; };
  const length = (v: HTMLVideoElement) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
  useVideoFrame(video, (v) => { if (!drag.current && length(v)) paint(v.currentTime / length(v)); });

  // Measured on the track (not the padded hit area) so the knob sits under the pointer.
  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.firstElementChild!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const seek = (frac: number) => {
    if (!video || !length(video)) return;
    paint(frac);
    video.currentTime = frac * length(video);
  };

  return (
    <div
      className={`scrub ${className ?? ''}`}
      data-tone={tone}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(video ? length(video) : 0)}
      aria-valuenow={Math.round(video?.currentTime ?? 0)}
      tabIndex={-1}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || !video) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        // Pause while dragging so frames keep up; carry on afterwards.
        drag.current = { resume: !video.paused };
        video.pause();
        e.currentTarget.dataset.dragging = 'true';
        seek(at(e));
      }}
      onPointerMove={(e) => {
        const f = at(e);
        if (format && video && length(video)) setHover({ x: f, t: f * length(video) });
        if (drag.current) seek(f);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        delete e.currentTarget.dataset.dragging;
        if (d.resume) void video?.play();
      }}
      onPointerCancel={(e) => { drag.current = null; delete e.currentTarget.dataset.dragging; }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="scrub-track">
        <span ref={fill} className="scrub-fill" />
        {hover && format && <span className="scrub-hover" style={{ left: `${hover.x * 100}%` }}>{format(hover.t)}</span>}
      </div>
    </div>
  );
}
