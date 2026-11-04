// Top bar: where you are (breadcrumb path) and what you're looking at
// (the open board's name, centred). Click a crumb to go up to it.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, House } from 'lucide-react';
import { useBoard } from '../board/store';
import { useUi } from '../board/ui';
import { pathTo, useBoardId, type Crumb } from '../board/nav';
import { enterBoard } from '../board/actions';
import { BoardIcon } from './BoardIcon';
import { CollabBar } from './Collab';
import { HeistLogo } from './HeistLogo';
import { useSecretClicks } from './AdminPage';
import { useMyColor } from '../sync/presence';

/** Crumbs shown in full before the middle collapses into "…". */
const MAX_CRUMBS = 4;
const TAIL = 2;

function CrumbIcon({ crumb }: { crumb: Crumb }) {
  if (crumb.home) return <House size={14} strokeWidth={1.9} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />;
  return <BoardIcon icon={crumb.icon} color={crumb.color} size={11} className="crumb-swatch" />;
}

function CrumbButton({ crumb, current }: { crumb: Crumb; current: boolean }) {
  const dropTarget = useUi((s) => s.boardDrop === crumb.id);
  return (
    <button
      data-crumb-id={crumb.id}
      data-drop-target={dropTarget || undefined}
      className="crumb"
      aria-current={current ? 'page' : undefined}
      title={current ? crumb.title : `Go to ${crumb.title}`}
      onClick={() => !current && enterBoard(crumb.id)}
    >
      <CrumbIcon crumb={crumb} />
      <span>{crumb.title}</span>
    </button>
  );
}

function Overflow({ hidden }: { hidden: Crumb[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="crumb-overflow" ref={ref}>
      <button
        className="crumb"
        aria-label={`${hidden.length} more levels`}
        aria-expanded={open}
        title="Show hidden levels"
        onClick={() => setOpen((v) => !v)}
      >
        …
      </button>
      {open && (
        <div className="crumb-menu" role="menu">
          {hidden.map((c) => (
            <button key={c.id} role="menuitem" className="crumb-menu-item" onClick={() => { setOpen(false); enterBoard(c.id); }}>
              <CrumbIcon crumb={c} />
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const boardId = useBoardId();
  // The logo wears your personal colour (the same everywhere, for you).
  const myColor = useMyColor();
  const secret = useSecretClicks();
  // Serialise so we only re-render when the path itself changes.
  const pathKey = useBoard((s) => JSON.stringify(pathTo(boardId, s.items)));
  const path: Crumb[] = JSON.parse(pathKey);
  const current = path[path.length - 1];

  const collapsed = path.length > MAX_CRUMBS;
  const head = path[0];
  const hidden = collapsed ? path.slice(1, -TAIL) : [];
  const tail = collapsed ? path.slice(-TAIL) : path.slice(1);

  const sep = <span className="crumb-sep" aria-hidden="true">/</span>;

  return (
    <header className="topbar">
      {/* Five quick clicks on the logo open the admin file manager. */}
      <div className="top-brand" title="Heist Workspace" onClick={secret}>
        <HeistLogo color={myColor} height={26} />
      </div>

      <nav className="crumbs" aria-label="Board path">
        <CrumbButton crumb={head} current={path.length === 1} />
        {collapsed && <>{sep}<Overflow hidden={hidden} /></>}
        {tail.map((c, i) => (
          <span key={c.id} className="crumb-wrap">
            {sep}
            <CrumbButton crumb={c} current={i === tail.length - 1} />
          </span>
        ))}
      </nav>

      <button
        className="top-title"
        title={current.home ? 'Your home board' : 'Board settings'}
        disabled={current.home}
        onClick={() => useUi.getState().set({ selectedId: current.id, editingId: null })}
      >
        {current.home
          ? <House size={18} strokeWidth={1.9} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />
          : <BoardIcon icon={current.icon} color={current.color} size={14} className="title-swatch" />}
        <span>{current.title}</span>
        {!current.home && <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="top-title-caret" />}
      </button>

      <CollabBar />
    </header>
  );
}
