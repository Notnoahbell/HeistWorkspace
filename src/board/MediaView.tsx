import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { ChevronDown, ChevronUp, Layers, Maximize2, Pause, Pencil, Play, Repeat, RotateCw } from 'lucide-react';
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
import { commentVersion, setStatus, statusInfo, versionOf } from './versions';
import { placeMenu, StatusDot, StatusPopup, type MenuAt } from '../ui/StatusPicker';
import { CardStack, usePeek } from '../ui/StackPeek';

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
  // Alt + hover on a stack: its versions show in the card.
  const peeking = usePeek((s) => s.id === id);

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
      data-media-id={id}
      style={{ zIndex: lifted ?? stackIndex, visibility: rest ? undefined : 'hidden' }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      <div ref={visRef} className="media" data-selected={selected} data-stacked={stacked} data-version-drop={versionTarget || undefined} data-peeking={peeking || undefined} style={{ width: fill ?? media.w }}>
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

          {peeking && !!media.versions?.length && <CardStack media={media} />}
          {media.mediaType === 'video' && src && skim != null && !peeking && (
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

          {/* A set status is a coloured strip along the top; hovering shows its tag (to change it). */}
          {media.status && statusInfo(media.status) && (
            <span className="media-status-strip" style={{ '--st': statusInfo(media.status)!.color } as CSSProperties} aria-hidden="true" />
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
                  aria-label="Name"
                  ref={(el) => { if (el && document.activeElement !== el) { el.dataset.was = media.name; el.focus({ preventScroll: true }); el.select(); } }}
                  onChange={(e) => useBoard.getState().updateItem(id, { name: e.target.value })}
                  onBlur={() => { if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null }); }}
                  onKeyDown={(e) => {
                    // Escape puts the name back as it was.
                    if (e.key === 'Escape') useBoard.getState().updateItem(id, { name: e.currentTarget.dataset.was ?? media.name });
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                  }}
                  {...keep}
                />
              ) : (
                <div className="media-name-row">
                  <div ref={nameRef} className="media-name" data-empty={!media.name}>{media.name || 'Untitled'}</div>
                  <button
                    className="media-rename"
                    title="Rename"
                    aria-label="Rename"
                    {...keep}
                    onClick={(e) => { e.stopPropagation(); useUi.getState().set({ selectedIds: [id], selectedId: id, editingId: id }); }}
                  >
                    <Pencil size={12} {...ICON} />
                  </button>
                </div>
              )}
              <div className="media-sub">
                {editing ? 'Enter to save · Esc to cancel'
                  : uploading && local ? `Uploading… ${Math.round(local.progress * 100)}%` : mediaSubtitle(media.meta)}
              </div>
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
 * Review status: a dot in the card's top-left corner, in the status's colour with its
 * symbol (or, with none set, an empty grey ring while the card is hovered). Pressing it
 * opens the status menu growing out of the dot. Picks for the version on show.
 */
function CardStatus({ id, version, value }: { id: string; version: number; value: ReviewStatus | null }) {
  const [at, setAt] = useState<MenuAt | null>(null);
  const close = useCallback(() => setAt(null), []);
  const st = statusInfo(value);
  const open = !!at;
  // Unset, the ring is grey: light over a dark corner of the picture, dark over a light one
  // (sampled as the card is hovered, like the timeline's tone).
  const ctl = useRef<HTMLSpanElement>(null);
  const [tone, setTone] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    if (st) return;
    const card = ctl.current?.closest('.media');
    const frame = ctl.current?.closest('.media-frame');
    if (!card || !frame) return;
    const sample = () => {
      const pic = frame.querySelector<HTMLImageElement | HTMLVideoElement>(':scope > img, :scope > video');
      const t = pic && cornerTone(pic);
      if (t) setTone(t);
    };
    card.addEventListener('pointerenter', sample);
    return () => card.removeEventListener('pointerenter', sample);
  }, [st]);
  // Its own clicks don't pick up or select the card.
  const keep = { onPointerDown: (e: SyntheticEvent) => e.stopPropagation(), onClick: (e: SyntheticEvent) => e.stopPropagation(), onDoubleClick: (e: SyntheticEvent) => e.stopPropagation() };
  return (
    <span ref={ctl} className="media-status-ctl" data-set={st ? true : undefined} data-open={open || undefined} data-tone={st ? undefined : tone} {...keep}>
      <button
        className="media-status-pill"
        style={st ? ({ '--st': st.color } as CSSProperties) : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={st ? `Review status: ${st.label}` : 'Set a review status'}
        onClick={(e) => {
          if (open) { setAt(null); return; }
          setAt(placeMenu((e.currentTarget.firstElementChild ?? e.currentTarget).getBoundingClientRect(), 'over'));
        }}
      >
        <StatusDot value={value} />
        <span className="media-status-word">{st ? st.label : 'Status'}</span>
      </button>
      {at && <StatusPopup at={at} value={value} onPick={(v) => setStatus(id, version, v)} onClose={close} opener=".media-status-pill" />}
    </span>
  );
}

/** Whether a light or dark mark shows up best over a picture's top-left corner (null if it can't be read). */
function cornerTone(pic: HTMLImageElement | HTMLVideoElement): 'light' | 'dark' | null {
  const w = pic instanceof HTMLVideoElement ? pic.videoWidth : pic.naturalWidth;
  const h = pic instanceof HTMLVideoElement ? pic.videoHeight : pic.naturalHeight;
  if (!w || !h) return null;
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    // Roughly where the ring sits: the top-left ~15% (the picture is cropped to cover the card, near enough).
    const side = Math.min(w, h) * 0.15;
    g.drawImage(pic, 0, 0, side, side, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255 > 0.6 ? 'dark' : 'light';
  } catch { return null; } // cross-origin picture
}
