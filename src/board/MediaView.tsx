import { memo, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Layers, Maximize2, Pause, Play, Repeat, RotateCw } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard, type MediaMeta, type ReviewStatus } from './store';
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

const ICON = { strokeWidth: 2, 'aria-hidden': true } as const;
/** Buttons on the card mustn't start a drag or select the card. */
const keep = { onPointerDown: (e: SyntheticEvent) => e.stopPropagation(), onDoubleClick: (e: SyntheticEvent) => e.stopPropagation() };

/**
 * A photo, GIF or video, with a caption (name + details) that tucks away
 * behind an arrow. Double-click (or click a selected card) to open it in the
 * player; click the name of a selected card to rename it. GIFs just loop.
 */
export const MediaView = memo(function MediaView({ id }: { id: string }) {
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
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  /** Hover-scrub: where across the card the pointer is (0–1), while the video isn't playing. */
  const [skim, setSkim] = useState<number | null>(null);
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
    if (!video) return;
    cardVideos.set(id, video);
    return () => { if (cardVideos.get(id) === video) cardVideos.delete(id); };
  }, [id, video]);


  const togglePlay = () => {
    if (!video) return;
    if (video.paused) void video.play(); else video.pause();
  };

  const rest = !media ? null : media.parentId ? (slot ?? null) : { x: media.x, y: media.y };
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined, (e) => {
    const r = nameRef.current?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
      useUi.getState().set({ selectedId: id, editingId: id });
    } else {
      // Carry on in the player from where the card is.
      video?.pause();
      openViewer(id, video?.currentTime ?? 0);
    }
  });
  useReportHeight(id, visRef);

  // Have the server work out its frame rate, poster, filmstrip (and a proxy if needed), once.
  useEffect(() => {
    if (media?.mediaType === 'video' && media.src) ensureDerived(media.src, media.meta);
  }, [media?.mediaType, media?.src, media?.meta.derived]);

  // , and . step a selected video a frame at a time.
  useEffect(() => {
    if (!selected || !video) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || useUi.getState().viewer || useUi.getState().wall) return;
      if (e.key !== ',' && e.key !== '.') return;
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
    if (!video) return;
    if (!looping) { video.muted = false; return; }
    video.muted = true;
    video.loop = true;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.05 });
    io.observe(video);
    return () => { io.disconnect(); video.pause(); };
    // (Again when the file changes, e.g. from the local copy to the uploaded one: that reloads it.)
  }, [video, looping, src]);
  if (!media) return null;

  const { width = 16, height = 9 } = media.meta;
  const failed = media.upload === 'failed';
  const uploading = media.upload === 'uploading';

  return (
    <div
      ref={posRef}
      className="item-pos"
      data-item
      style={{ zIndex: lifted ?? stackIndex, visibility: rest ? undefined : 'hidden' }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      <div ref={visRef} className="media" data-selected={selected} data-stacked={stacked} data-version-drop={versionTarget || undefined} style={{ width: fill ?? media.w }}>
        <div
          className="media-frame"
          style={{ aspectRatio: `${width} / ${height}` }}
          onPointerMove={media.mediaType === 'video' ? (e) => {
            // Skim through it by moving across (not over its controls, not mid-drag, not while it plays).
            const over = (e.target as Element).closest('button:not(.media-play), .media-scrub');
            if (playing || dragging || over || e.buttons) { if (skim != null) setSkim(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            setSkim(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          } : undefined}
          onPointerLeave={() => setSkim(null)}
        >
          {src ? (
            media.mediaType === 'video' ? (
              <video
                ref={setVideo}
                src={src}
                poster={media.meta.poster}
                preload={media.loop ? 'auto' : 'metadata'}
                muted={!!media.loop}
                playsInline
                loop
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            ) : (
              <img src={src} alt={media.name} draggable={false} />
            )
          ) : (
            <div className="media-pending">{failed ? 'Upload failed' : 'Uploading…'}</div>
          )}

          {media.mediaType === 'video' && src && skim != null && (
            <Skim video={video} at={skim} strip={media.meta.strip} />
          )}
          {media.mediaType === 'video' && src && (
            <>
              {/* One large button in the middle; like the timeline, it shows on hover. */}
              <button className="media-play" data-playing={playing || undefined} aria-label={playing ? 'Pause' : 'Play'} {...keep} onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
                {playing ? <Pause size={22} fill="currentColor" {...ICON} /> : <Play size={22} fill="currentColor" {...ICON} />}
              </button>
              <Scrubber video={video} className="media-scrub" tone={tone} marks={marks} />
            </>
          )}

          {/* Top-left corner: the status (set right there), then the version and loop tags. */}
          <span className="media-tags">
            {!uploading && !failed && <CardStatus id={id} version={version} value={media.status ?? null} />}
            {version > 1 && <span className="media-version" title={`Version ${version}`}>v{version}</span>}
            {looping && <span className="media-version media-loop" title="Loops on its own (silently)"><Repeat size={11} strokeWidth={2.6} aria-hidden="true" /></span>}
          </span>
          {versionTarget && (
            <div className="media-version-drop" aria-hidden="true">
              <Layers size={20} {...ICON} />
              Drop to add as v{version + 1}
            </div>
          )}

          {incoming && (
            <div className="media-version-drop media-incoming" aria-live="polite">
              <Layers size={20} {...ICON} />
              Uploading v{version + 1}… {Math.round(incoming.progress * 100)}%
              <span className="media-incoming-bar"><span style={{ width: `${Math.round(incoming.progress * 100)}%` }} /></span>
            </div>
          )}
          {uploading && local && (
            <div className="media-progress" aria-label="Uploading"><span style={{ width: `${Math.round(local.progress * 100)}%` }} /></div>
          )}
          {failed && local && (
            <button className="media-retry" {...keep} onClick={(e) => { e.stopPropagation(); void retryUpload(id); }}>
              <RotateCw size={14} {...ICON} /> Retry upload
            </button>
          )}

          {src && (
            <button
              className="media-expand"
              title="Open in player"
              aria-label="Open in player"
              {...keep}
              onClick={(e) => { e.stopPropagation(); openViewer(id, video?.currentTime ?? 0); }}
            >
              <Maximize2 size={14} {...ICON} />
            </button>
          )}
          {media.captionHidden && (
            <button
              className="media-reveal"
              title="Show name"
              aria-label="Show name"
              {...keep}
              onClick={(e) => { e.stopPropagation(); useBoard.getState().updateItem(id, { captionHidden: false }); }}
            >
              <ChevronUp size={14} {...ICON} />
            </button>
          )}
        </div>

        {!media.captionHidden && (
          <div className="media-caption">
            <div
              className="media-text"
              data-tip={editing ? undefined : [
                media.name || 'Untitled',
                mediaFacts(media.meta, media.mediaType),
                media.versions?.length ? `Version ${version} of ${media.versions.length + 1}` : '',
                added,
              ].filter(Boolean).join('\n')}
            >
              {editing ? (
                <input
                  className="media-name media-name-input"
                  defaultValue={media.name}
                  placeholder="Untitled"
                  spellCheck={false}
                  ref={(el) => { if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.select(); } }}
                  onChange={(e) => useBoard.getState().updateItem(id, { name: e.target.value })}
                  onBlur={() => { if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                />
              ) : (
                <div ref={nameRef} className="media-name" data-empty={!media.name}>{media.name || 'Untitled'}</div>
              )}
              <div className="media-sub">{uploading && local ? `Uploading… ${Math.round(local.progress * 100)}%` : mediaSubtitle(media.meta)}</div>
            </div>
            <button
              className="media-hide"
              title="Hide name"
              aria-label="Hide name"
              {...keep}
              onClick={(e) => { e.stopPropagation(); useBoard.getState().updateItem(id, { captionHidden: true }); }}
            >
              <ChevronDown size={16} {...ICON} />
            </button>
          </div>
        )}
        <CommentBadge id={id} />
      </div>
    </div>
  );
});

/**
 * Hover-scrub: the frame at the pointer, from the filmstrip the server made
 * (instant). Without one yet, the card's own video jumps there instead, and
 * goes back to where it was afterwards.
 */
function Skim({ video, at, strip }: { video: HTMLVideoElement | null; at: number; strip: MediaMeta['strip'] }) {
  const was = useRef<number | null>(null);
  useEffect(() => {
    if (strip || !video || !Number.isFinite(video.duration)) return;
    if (was.current == null) was.current = video.currentTime;
    video.currentTime = at * video.duration;
  }, [at, strip, video]);
  useEffect(() => () => {
    if (video && was.current != null) video.currentTime = was.current;
  }, [video]);
  const frame = strip ? Math.min(strip.frames - 1, Math.floor(at * strip.frames)) : 0;
  return (
    <>
      {strip && (
        <div
          className="media-skim"
          aria-hidden="true"
          style={{
            backgroundImage: `url(${strip.url})`,
            backgroundSize: `${strip.frames * 100}% 100%`,
            backgroundPosition: `${(frame / Math.max(1, strip.frames - 1)) * 100}% 0`,
          }}
        />
      )}
      <div className="media-skim-line" aria-hidden="true" style={{ left: `${at * 100}%` }} />
    </>
  );
}

/**
 * Review status, in the card's top-left corner: the status tag when there is one
 * (click to change it), or a faint "Status" button while the card is hovered or
 * selected. Picks for the version on show. The list opens as a pop-up above the
 * board (so the card can't clip it, and it's the same size at any zoom).
 */
function CardStatus({ id, version, value }: { id: string; version: number; value: ReviewStatus | null }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ctl = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const st = statusInfo(value);
  const open = !!at;
  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const off = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !ctl.current?.contains(t)) close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
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
  const keep = { onPointerDown: (e: SyntheticEvent) => e.stopPropagation(), onClick: (e: SyntheticEvent) => e.stopPropagation(), onDoubleClick: (e: SyntheticEvent) => e.stopPropagation() };
  return (
    <span ref={ctl} className="media-status-ctl" data-set={st ? true : undefined} data-open={open || undefined} {...keep}>
      <button
        className="media-status"
        style={st ? ({ '--st': st.color } as CSSProperties) : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title={st ? `Review status: ${st.label} (click to change)` : 'Set a review status'}
        onClick={(e) => {
          if (open) { setAt(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ left: Math.min(r.left, window.innerWidth - 180), top: r.bottom + 6 });
        }}
      >
        {st ? st.label : 'Status'}
        <ChevronDown size={11} strokeWidth={2.6} aria-hidden="true" />
      </button>
      {at && createPortal(
        <div ref={menu} className="media-status-menu" role="menu" style={{ left: at.left, top: at.top }}>
          {[...STATUSES, null].map((s) => (
            <button
              key={s?.value ?? 'none'}
              role="menuitemradio"
              aria-checked={(s?.value ?? null) === value}
              onClick={() => { setStatus(id, version, s?.value ?? null); setAt(null); }}
            >
              <span className="review-dot" style={{ background: s?.color ?? 'transparent' }} data-none={!s || undefined} />
              <span>{s?.label ?? 'No status'}</span>
              {(s?.value ?? null) === value && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
