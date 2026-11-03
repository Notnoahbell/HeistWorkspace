import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { isLight } from '../lib/color';

export const NoteView = memo(function NoteView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const note = item?.kind === 'note' ? item : null;
  const stackIndex = useBoard((s) => stackZ(s.items, id));
  const depth = useBoard((s) => stackDepth(s.items, id));
  const slot = useLayout((s) => (note?.parentId ? s.slots[id] : undefined));
  const fill = useLayout((s) => (note?.parentId ? s.fills[id] : undefined));
  const selected = useUi((s) => s.selectedIds.includes(id));
  const editing = useUi((s) => s.editingId === id);
  const lifted = useLiftedZ(id);
  const stacked = useUi((s) => (s.dragId === id ? undefined : stackTone(depth)));

  const rest = !note ? null : note.parentId ? (slot ?? null) : { x: note.x, y: note.y };
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined,
    () => useUi.getState().set({ selectedId: id, editingId: id }));

  useReportHeight(id, visRef);

  if (!note) return null;

  // Stacked notes sit just above their column; a dragged one floats over everything.
  const zIndex = lifted ?? stackIndex;
  const tone = note.color ? (isLight(note.color) ? 'light' : 'dark') : undefined;
  const visStyle = { width: fill ?? note.w, '--item-bg': note.color ?? undefined } as CSSProperties;

  return (
    <div
      ref={posRef}
      className="item-pos"
      data-item
      style={{ zIndex, visibility: rest ? undefined : 'hidden' }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      <div
        ref={visRef}
        className="note"
        data-stacked={stacked}
        data-selected={selected}
        data-tone={tone}
        data-size={note.textSize}
        data-align={note.textAlign}
        data-bold={note.bold}
        style={visStyle}
      >
        {editing ? <NoteEditor id={id} text={note.text} /> : (
          <div className="note-text" data-empty={!note.text}>
            {note.text || 'Double-click to write…'}
          </div>
        )}
      </div>
    </div>
  );
});

function NoteEditor({ id, text }: { id: string; text: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const el = ref.current!;
    fit();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <textarea
      ref={ref}
      className="note-text note-editor"
      defaultValue={text}
      placeholder="Write a note…"
      onInput={(e) => {
        fit();
        useBoard.getState().updateItem(id, { text: e.currentTarget.value });
      }}
      onBlur={() => {
        if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
    />
  );
}
