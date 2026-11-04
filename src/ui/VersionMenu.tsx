// "v3 ▾": pick a version of a video. Used in the player's top bar (which
// version you're watching, where versions can also be renamed, restored or
// deleted) and on the compare pane (which one to set beside it). Also the
// review-status picker ("● Approved ▾").

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, ChevronDown, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { Media, ReviewStatus } from '../board/store';
import { deleteVersion, renameVersion, restoreVersion, STATUSES, statusInfo, versionList } from '../board/versions';
import { timeAgo } from '../board/comments';
import { useUi } from '../board/ui';
import { usePresence } from '../sync/presence';
import { session } from '../session';

/** Close on a press outside or Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
}

export function VersionMenu({ media, value, onPick, disabled, className, label, manage }: {
  media: Media;
  value: number;
  onPick: (n: number) => void;
  /** Versions that can't be picked here (e.g. the one already on the other side). */
  disabled?: number[];
  className?: string;
  /** Text on the button (defaults to "v3"). */
  label?: string;
  /** Offer rename / restore / delete on each version. */
  manage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const users = usePresence((s) => s.users);
  const list = versionList(media);
  useDismiss(open, ref, () => { setOpen(false); setRenaming(null); setConfirm(null); });

  const who = (id: string | null) => (!id ? null : id === session.userId ? 'you' : users[id]?.name ?? null);
  const toast = (text: string) => useUi.getState().set({ toast: { text, at: Date.now() } });

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
            const st = statusInfo(v.status);
            return (
              <div key={v.n} className="version-row" data-checked={v.n === value || undefined}>
                {renaming === v.n ? (
                  <form
                    className="version-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameVersion(media.id, v.n, new FormData(e.currentTarget).get('label') as string);
                      setRenaming(null);
                    }}
                  >
                    <span className="version-n">v{v.n}</span>
                    <input name="label" defaultValue={v.label ?? ''} placeholder={v.name || 'Name this version'} autoFocus maxLength={60}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} />
                    <button type="submit" className="version-act" aria-label="Save name"><Check size={14} strokeWidth={2.6} aria-hidden="true" /></button>
                  </form>
                ) : (
                  <button
                    className="version-pick"
                    role="menuitemradio"
                    aria-checked={v.n === value}
                    disabled={disabled?.includes(v.n)}
                    onClick={() => { onPick(v.n); setOpen(false); }}
                  >
                    <span className="version-n">v{v.n}</span>
                    <span className="version-text">
                      <span className="version-name">{v.label || v.name || 'Untitled'}</span>
                      <span className="version-sub">
                        {st && <span className="review-dot" style={{ background: st.color }} title={st.label} />}
                        {v.current ? 'Current' : 'Earlier'}
                        {v.label ? ` · ${v.name}` : ''}
                        {v.addedAt ? ` · ${timeAgo(v.addedAt)}` : ''}
                        {by ? ` · ${by}` : ''}
                      </span>
                    </span>
                    {v.n === value && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
                  </button>
                )}
                {manage && renaming !== v.n && (
                  <span className="version-acts">
                    <button className="version-act" title="Rename" aria-label={`Rename v${v.n}`} onClick={() => setRenaming(v.n)}>
                      <Pencil size={13} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    {!v.current && (
                      <button className="version-act" title={`Restore as v${list.length + 1}`} aria-label={`Restore v${v.n}`}
                        onClick={() => { const n = restoreVersion(media.id, v.n); if (n) { toast(`v${v.n} restored as v${n}`); onPick(n); setOpen(false); } }}>
                        <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                    {list.length > 1 && (
                      <button
                        className="version-act version-del"
                        data-confirm={confirm === v.n || undefined}
                        title={confirm === v.n ? 'Click again to delete this version and its comments' : 'Delete version'}
                        aria-label={confirm === v.n ? `Confirm delete v${v.n}` : `Delete v${v.n}`}
                        onClick={() => {
                          if (confirm !== v.n) { setConfirm(v.n); return; }
                          deleteVersion(media.id, v.n);
                          toast(`v${v.n} deleted`);
                          setConfirm(null);
                        }}
                      >
                        <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                        {confirm === v.n && <span>Delete?</span>}
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "● Approved ▾": where the review of a version stands. */
export function StatusMenu({ value, onChange, className }: {
  value: ReviewStatus | null;
  onChange: (s: ReviewStatus | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const cur = statusInfo(value);
  return (
    <div ref={ref} className={`version-menu status-menu ${className ?? ''}`}>
      <button className="version-btn" aria-haspopup="menu" aria-expanded={open} title="Review status" onClick={() => setOpen((o) => !o)}>
        <span className="review-dot" style={{ background: cur?.color ?? 'transparent' }} data-none={!cur || undefined} />
        {cur?.label ?? 'No status'}
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {open && (
        <div className="version-list status-list" role="menu">
          {[...STATUSES, null].map((s) => (
            <button
              key={s?.value ?? 'none'}
              className="version-pick"
              role="menuitemradio"
              aria-checked={(s?.value ?? null) === value}
              onClick={() => { onChange(s?.value ?? null); setOpen(false); }}
            >
              <span className="review-dot" style={{ background: s?.color ?? 'transparent' }} data-none={!s || undefined} />
              <span className="version-name">{s?.label ?? 'No status'}</span>
              {(s?.value ?? null) === value && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
