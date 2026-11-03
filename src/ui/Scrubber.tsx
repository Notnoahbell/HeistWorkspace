// A video timeline you can click or drag along. Progress is drawn straight to
// the DOM every frame while playing (no React re-render per frame), so it
// moves smoothly instead of in timeupdate's ~4 Hz steps.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

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

export function Scrubber({ video, className, hoverTime = false }: {
  video: HTMLVideoElement | null;
  className?: string;
  /** Show the time under the pointer while hovering. */
  hoverTime?: boolean;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ resume: boolean } | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const paint = (frac: number) => { if (fill.current) fill.current.style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`; };
  useVideoFrame(video, (v) => { if (!drag.current && v.duration > 0) paint(v.currentTime / v.duration); });

  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const seek = (frac: number) => {
    if (!video || !(video.duration > 0)) return;
    paint(frac);
    video.currentTime = frac * video.duration;
  };

  return (
    <div
      className={`scrub ${className ?? ''}`}
      data-dragging={drag.current ? 'true' : undefined}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(video?.duration || 0)}
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
        if (hoverTime && video && video.duration > 0) setHover({ x: f, t: f * video.duration });
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
      <div className="scrub-track"><span ref={fill} className="scrub-fill" /></div>
      {hover && <span className="scrub-hover" style={{ left: `${hover.x * 100}%` }}>{fmtTime(hover.t)}</span>}
    </div>
  );
}
