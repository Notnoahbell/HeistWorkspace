// Right-click menu: actions on the selection, or "add here" on empty canvas.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardPaste, Columns3, Copy, CopyPlus, LayoutGrid, Link2, ListChecks, Scissors, StickyNote, Trash2 } from 'lucide-react';
import { useUi } from '../board/ui';
import { useBoard, type ItemKind } from '../board/store';
import { createItem, deleteSelection, groupIntoColumn } from '../board/actions';
import { copySelection, cutSelection, duplicateSelection, hasClipboard, paste } from '../board/clipboard';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const ICON = { size: 16, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true } as const;
const MARGIN = 8;

const close = () => useUi.getState().set({ contextMenu: null });

function Entry({ icon, label, hint, danger, disabled, onClick }: {
  icon: ReactNode; label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button role="menuitem" className="menu-item" data-danger={danger} disabled={disabled} onClick={() => { close(); onClick(); }}>
      {icon}
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

const ADD: { kind: ItemKind; label: string; icon: ReactNode; hint: string }[] = [
  { kind: 'note', label: 'Note', icon: <StickyNote {...ICON} />, hint: 'N' },
  { kind: 'link', label: 'Link', icon: <Link2 {...ICON} />, hint: 'L' },
  { kind: 'todo', label: 'To-do list', icon: <ListChecks {...ICON} />, hint: 'T' },
  { kind: 'board', label: 'Board', icon: <LayoutGrid {...ICON} />, hint: 'B' },
  { kind: 'column', label: 'Section', icon: <Columns3 {...ICON} />, hint: 'S' },
];

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const ids = useUi((s) => s.selectedIds);
  const count = ids.length;
  const hasItems = useBoard((s) => ids.some((id) => s.items[id]));
  // Boards can't be copied; only offer copying when something else is selected.
  const canCopy = useBoard((s) => ids.some((id) => s.items[id] && s.items[id].kind !== 'board'));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setPos({
      left: Math.min(menu.x, window.innerWidth - w - MARGIN),
      top: Math.min(menu.y, window.innerHeight - h - MARGIN),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  const onCanvas = !!menu.world;
  if (!onCanvas && !hasItems) return null;

  const things = count === 1 ? 'item' : `${count} items`;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {onCanvas ? (
        <>
          {hasClipboard() && (
            <>
              <Entry icon={<ClipboardPaste {...ICON} />} label="Paste here" hint={`${MOD}V`} onClick={() => paste(menu.world)} />
              <div className="menu-sep" />
            </>
          )}
          <div className="menu-label">Add here</div>
          {ADD.map((a) => (
            <Entry key={a.kind} icon={a.icon} label={a.label} hint={a.hint} onClick={() => createItem(a.kind, menu.world!)} />
          ))}
        </>
      ) : (
        <>
          <Entry icon={<Columns3 {...ICON} />} label={`New section from ${count === 1 ? 'item' : 'selection'}`} onClick={() => groupIntoColumn()} />
          <div className="menu-sep" />
          <Entry icon={<Copy {...ICON} />} label="Copy" hint={`${MOD}C`} disabled={!canCopy} onClick={copySelection} />
          <Entry icon={<Scissors {...ICON} />} label="Cut" hint={`${MOD}X`} disabled={!canCopy} onClick={cutSelection} />
          <Entry icon={<CopyPlus {...ICON} />} label="Duplicate" hint={`${MOD}D`} disabled={!canCopy} onClick={duplicateSelection} />
          {hasClipboard() && <Entry icon={<ClipboardPaste {...ICON} />} label="Paste" hint={`${MOD}V`} onClick={() => paste()} />}
          <div className="menu-sep" />
          <Entry icon={<Trash2 {...ICON} />} label={`Delete ${things}`} hint="Del" danger onClick={deleteSelection} />
        </>
      )}
    </div>
  );
}
