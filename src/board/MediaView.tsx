import { memo, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, RotateCw } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { mediaSubtitle, retryUpload, useLocalMedia } from './media';
import { Scrubber, stepFrame, useContrastTone } from '../ui/Scrubber';
import { cardVideos, commentIndex } from './comments';
import { useShallow } from 'zustand/react/shallow';
import { isTyping } from '../canvas/input';
import { openViewer } from '../ui/MediaViewer';
import { CommentBadge } from '../ui/Comments';

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
  const tone = useContrastTone(video);
  // Open timecoded comments, as marks on the timeline.
  const marks = useBoard(useShallow((s) => (commentIndex(s.items).get(id) ?? []).flatMap((c) => (!c.resolved && c.time != null ? [c.time] : []))));

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

  // , and . step a selected video a frame at a time.
  useEffect(() => {
    if (!selected || !video) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || useUi.getState().viewer) return;
      if (e.key !== ',' && e.key !== '.') return;
      e.preventDefault();
      stepFrame(video, e.key === '.' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, video]);

  if (!media) return null;

  const src = local?.url || media.src;
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
      <div ref={visRef} className="media" data-selected={selected} data-stacked={stacked} style={{ width: fill ?? media.w }}>
        <div className="media-frame" style={{ aspectRatio: `${width} / ${height}` }}>
          {src ? (
            media.mediaType === 'video' ? (
              <video
                ref={setVideo}
                src={src}
                preload="metadata"
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

          {media.mediaType === 'video' && src && (
            <>
              {/* One large button in the middle; like the timeline, it shows on hover. */}
              <button className="media-play" data-playing={playing || undefined} aria-label={playing ? 'Pause' : 'Play'} {...keep} onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
                {playing ? <Pause size={22} fill="currentColor" {...ICON} /> : <Play size={22} fill="currentColor" {...ICON} />}
              </button>
              <Scrubber video={video} className="media-scrub" tone={tone} marks={marks} />
            </>
          )}

          {uploading && local && (
            <div className="media-progress" aria-label="Uploading"><span style={{ width: `${Math.round(local.progress * 100)}%` }} /></div>
          )}
          {failed && local && (
            <button className="media-retry" {...keep} onClick={(e) => { e.stopPropagation(); void retryUpload(id); }}>
              <RotateCw size={14} {...ICON} /> Retry upload
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
            <div className="media-text">
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
