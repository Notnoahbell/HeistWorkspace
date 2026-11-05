import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { stackDepth, stackTone, stackZ, useBoard, type TodoEntry } from './store';
import { useLayout } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ, useReportHeight } from './useBody';
import { itemHooks } from './actions';
import { isLight } from '../lib/color';
import { newId } from '../lib/id';
import { CommentBadge } from '../ui/Comments';

const setEntries = (id: string, entries: TodoEntry[]) => useBoard.getState().updateItem(id, { entries });
const setTitle = (id: string, title: string) => useBoard.getState().updateItem(id, { title });
/** Editing was opened from the header (so it starts there, not on the last task). */
let startOnTitle = false;

function Checkbox({ entry, onToggle }: { entry: TodoEntry; onToggle: () => void }) {
  return (
    <button
      className="todo-check"
      role="checkbox"
      aria-checked={entry.done}
      aria-label={entry.done ? 'Mark not done' : 'Mark done'}
      // Ticking a box shouldn't pick up, select or start editing the card.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {entry.done && <Check size={12} strokeWidth={3} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />}
    </button>
  );
}

/** A note that is a checklist. Tick boxes any time; double-click to edit. */
export const TodoView = memo(function TodoView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const todo = item?.kind === 'todo' ? item : null;
  const stackIndex = useBoard((s) => stackZ(s.items, id));
  const depth = useBoard((s) => stackDepth(s.items, id));
  const slot = useLayout((s) => (todo?.parentId ? s.slots[id] : undefined));
  const fill = useLayout((s) => (todo?.parentId ? s.fills[id] : undefined));
  const selected = useUi((s) => s.selectedIds.includes(id));
  const editing = useUi((s) => s.editingId === id);
  const lifted = useLiftedZ(id);
  const stacked = useUi((s) => (s.dragId === id ? undefined : stackTone(depth)));

  const rest = !todo ? null : todo.parentId ? (slot ?? null) : { x: todo.x, y: todo.y };
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined,
    (e) => {
      startOnTitle = !!(e.target as Element).closest?.('.todo-head');
      useUi.getState().set({ selectedId: id, editingId: id });
    });
  useReportHeight(id, visRef);

  if (!todo) return null;

  const zIndex = lifted ?? stackIndex;
  const tone = todo.color ? (isLight(todo.color) ? 'light' : 'dark') : undefined;
  const done = todo.entries.filter((e) => e.done).length;
  const toggle = (eid: string) =>
    setEntries(id, todo.entries.map((e) => (e.id === eid ? { ...e, done: !e.done } : e)));

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
        className="todo"
        data-stacked={stacked}
        data-selected={selected}
        data-tone={tone}
        style={{ width: fill ?? todo.w, '--item-bg': todo.color ?? undefined } as CSSProperties}
      >
        {editing ? (
          <TodoEditor id={id} title={todo.title ?? ''} entries={todo.entries} onToggle={toggle} />
        ) : (
          <>
          <div className="todo-head" data-empty={!todo.title || undefined}>{todo.title || 'To-do list'}</div>
          <ul className="todo-list">
            {todo.entries.map((e) => (
              <li key={e.id} data-done={e.done}>
                <Checkbox entry={e} onToggle={() => toggle(e.id)} />
                <span className="todo-text">{e.text}</span>
              </li>
            ))}
            {todo.entries.length === 0 && <li className="todo-empty">Double-click to add tasks…</li>}
          </ul>
          </>
        )}
        {todo.entries.length > 0 && (
          <div className="todo-progress">
            <span>{done} of {todo.entries.length} done</span>
            <span className="todo-bar"><span style={{ width: `${(done / todo.entries.length) * 100}%` }} /></span>
          </div>
        )}
        <CommentBadge id={id} />
      </div>
    </div>
  );
});

const TITLE = 'title';

function TodoEditor({ id, title, entries, onToggle }: { id: string; title: string; entries: TodoEntry[]; onToggle: (id: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  // Start with one empty line to type into; a new list starts on its header.
  useLayoutEffect(() => {
    const onTitle = startOnTitle;
    startOnTitle = false;
    if (entries.length === 0) {
      const first = { id: newId(), text: '', done: false };
      setEntries(id, [first]);
      setFocusId(title ? first.id : TITLE);
    } else {
      setFocusId(onTitle ? TITLE : entries[entries.length - 1].id);
    }
  }, []);

  useLayoutEffect(() => {
    if (!focusId) return;
    const el = inputs.current.get(focusId);
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [focusId, entries.length]);

  const finish = () => {
    // Leaving the editor: drop blank lines.
    const kept = useBoard.getState().items[id];
    if (kept?.kind === 'todo') setEntries(id, kept.entries.filter((e) => e.text.trim()));
    if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null });
  };

  return (
    <div
      ref={listRef}
      onBlur={(e) => {
        if (!listRef.current?.contains(e.relatedTarget as Node)) finish();
      }}
    >
    <input
      ref={(el) => { if (el) inputs.current.set(TITLE, el); else inputs.current.delete(TITLE); }}
      className="todo-head todo-head-input"
      value={title}
      placeholder="To-do list"
      onChange={(e) => setTitle(id, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (entries[0]) setFocusId(entries[0].id);
        } else if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
    />
    <ul className="todo-list">
      {entries.map((entry, i) => (
        <li key={entry.id} data-done={entry.done}>
          <Checkbox entry={entry} onToggle={() => onToggle(entry.id)} />
          <input
            ref={(el) => { if (el) inputs.current.set(entry.id, el); else inputs.current.delete(entry.id); }}
            className="todo-input"
            value={entry.text}
            placeholder="Task"
            onChange={(e) => setEntries(id, entries.map((x) => (x.id === entry.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const next = { id: newId(), text: '', done: false };
                setEntries(id, [...entries.slice(0, i + 1), next, ...entries.slice(i + 1)]);
                setFocusId(next.id);
              } else if (e.key === 'Backspace' && !entry.text && entries.length > 1) {
                e.preventDefault();
                setEntries(id, entries.filter((x) => x.id !== entry.id));
                setFocusId((i > 0 ? entries[i - 1] : entries[1]).id);
              } else if (e.key === 'ArrowUp') {
                setFocusId(i > 0 ? entries[i - 1].id : TITLE);
              } else if (e.key === 'ArrowDown' && i < entries.length - 1) {
                setFocusId(entries[i + 1].id);
              } else if (e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
          />
        </li>
      ))}
    </ul>
    </div>
  );
}
