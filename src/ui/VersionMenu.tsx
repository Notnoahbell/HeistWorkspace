// "v3 ▾": pick a version of a video. Used in the player's top bar (which
// version you're watching) and on the compare pane (which one to set beside it).

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Media } from '../board/store';
import { versionList } from '../board/versions';
import { timeAgo } from '../board/comments';
import { usePresence } from '../sync/presence';
import { session } from '../session';

export function VersionMenu({ media, value, onPick, disabled, className, label }: {
  media: Media;
  value: number;
  onPick: (n: number) => void;
  /** Versions that can't be picked here (e.g. the one already on the other side). */
  disabled?: number[];
  className?: string;
  /** Text on the button (defaults to "v3"). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const users = usePresence((s) => s.users);
  const list = versionList(media);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, [open]);

  const who = (id: string | null) => (!id ? null : id === session.userId ? 'you' : users[id]?.name ?? null);

  return (
    <div ref={ref} className={`version-menu ${className ?? ''}`}>
      <button className="version-btn" aria-haspopup="menu" aria-expanded={open} title="Versions" onClick={() => setOpen((o) => !o)}>
        {label ?? `v${value}`}
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {open && (
        <div className="version-list" role="menu">
          {list.map((v) => {
            const by = who(v.addedBy);
            return (
              <button
                key={v.n}
                role="menuitemradio"
                aria-checked={v.n === value}
                disabled={disabled?.includes(v.n)}
                onClick={() => { onPick(v.n); setOpen(false); }}
              >
                <span className="version-n">v{v.n}</span>
                <span className="version-text">
                  <span className="version-name">{v.name || 'Untitled'}</span>
                  <span className="version-sub">
                    {v.current ? 'Current' : 'Earlier'}
                    {v.addedAt ? ` · ${timeAgo(v.addedAt)}` : ''}
                    {by ? ` · ${by}` : ''}
                  </span>
                </span>
                {v.n === value && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
