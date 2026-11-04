import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Link2 } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { isLight } from '../lib/color';
import { fetchPreview, hostOf, normalizeUrl } from '../lib/links';
import { CommentBadge } from '../ui/Comments';
import { useAddedBy } from './details';

const LINK_ICON = { size: 18, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true } as const;

/** A web link with a preview card. Double-click opens the page. */
export const LinkView = memo(function LinkView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const link = item?.kind === 'link' ? item : null;
  /** Who added it and when, for the hover details. */
  const added = useAddedBy(item);
  const stackIndex = useBoard((s) => stackZ(s.items, id));
  const depth = useBoard((s) => stackDepth(s.items, id));
  const slot = useLayout((s) => (link?.parentId ? s.slots[id] : undefined));
  const fill = useLayout((s) => (link?.parentId ? s.fills[id] : undefined));
  const selected = useUi((s) => s.selectedIds.includes(id));
  const editing = useUi((s) => s.editingId === id);
  const lifted = useLiftedZ(id);
  const stacked = useUi((s) => (s.dragId === id ? undefined : stackTone(depth)));

  const rest = !link ? null : link.parentId ? (slot ?? null) : { x: link.x, y: link.y };
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined, () => {
    const now = useBoard.getState().items[id];
    if (now?.kind === 'link' && now.url) window.open(now.url, '_blank', 'noopener,noreferrer');
    else useUi.getState().set({ selectedId: id, editingId: id });
  });
  useReportHeight(id, visRef);

  // Fetch the preview once we have a URL and haven't got one yet.
  const url = link?.url ?? '';
  const needsPreview = !!url && link?.preview == null;
  useEffect(() => {
    if (!needsPreview) return;
    let live = true;
    fetchPreview(url).then((preview) => {
      const now = useBoard.getState().items[id];
      if (live && now?.kind === 'link' && now.url === url) useBoard.getState().updateItem(id, { preview });
    });
    return () => { live = false; };
  }, [id, url, needsPreview]);

  if (!link) return null;

  const zIndex = lifted ?? stackIndex;
  const tone = link.color ? (isLight(link.color) ? 'light' : 'dark') : undefined;
  const p = link.preview;

  let body;
  if (editing || !link.url) {
    body = <LinkInput id={id} url={link.url} editing={editing} />;
  } else if (!p) {
    body = (
      <div className="link-bar" data-loading="true">
        <Link2 {...LINK_ICON} />
        <span>Loading preview of {hostOf(link.url)}…</span>
      </div>
    );
  } else if (p.failed || (!p.title && !p.image)) {
    body = (
      <div className="link-bar">
        <Link2 {...LINK_ICON} />
        <span className="link-url">{link.url}</span>
      </div>
    );
  } else {
    body = (
      <>
        {p.image && (
          <img className="link-image" src={p.image} alt="" draggable={false} referrerPolicy="no-referrer" loading="lazy"
            onError={(e) => { e.currentTarget.hidden = true; }} />
        )}
        <div className="link-body">
          <div className="link-site">
            {p.favicon && (
              <img src={p.favicon} alt="" width={14} height={14} draggable={false} referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.hidden = true; }} />
            )}
            <span>{p.siteName || hostOf(link.url)}</span>
          </div>
          {p.title && <div className="link-title">{p.title}</div>}
          {p.description && <div className="link-desc">{p.description}</div>}
        </div>
      </>
    );
  }

  return (
    <div
      ref={posRef}
      className="item-pos"
      data-item
      style={{ zIndex, visibility: rest ? undefined : 'hidden' }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={(e) => { if (!editing) onClick(e); }}
    >
      <div
        ref={visRef}
        className="link"
        data-stacked={stacked}
        data-selected={selected}
        data-tone={tone}
        title={link.url ? [link.preview?.title, link.url, added, 'Click again to open'].filter(Boolean).join('\n') : undefined}
        style={{ width: fill ?? link.w, '--item-bg': link.color ?? undefined } as CSSProperties}
      >
        {body}
        <CommentBadge id={id} />
      </div>
    </div>
  );
});

function LinkInput({ id, url, editing }: { id: string; url: string; editing: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing) { ref.current?.focus({ preventScroll: true }); ref.current?.select(); }
  }, [editing]);

  const commit = () => {
    const next = normalizeUrl(ref.current?.value ?? '');
    const ui = useUi.getState();
    if (next && next !== url) useBoard.getState().updateItem(id, { url: next, preview: null });
    if (ui.editingId === id) ui.set({ editingId: null });
  };

  return (
    <div className="link-bar link-entry">
      <Link2 {...LINK_ICON} />
      <input
        ref={ref}
        className="link-input"
        defaultValue={url}
        placeholder="Enter a link URL"
        spellCheck={false}
        readOnly={!editing}
        tabIndex={editing ? 0 : -1}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = url;
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
