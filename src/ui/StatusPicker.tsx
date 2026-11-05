// Review status, picked from a small frosted menu: from the dot in a media card's
// corner (MediaView), or for a whole selection at once (SelectionToolbar).

import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, Eye, PenLine } from 'lucide-react';
import type { ReviewStatus } from '../board/store';
import { STATUSES, statusInfo } from '../board/versions';

export const STATUS_GLYPH = { approved: Check, changes: PenLine, review: Eye } as const;

/**
 * A status's dot: its colour and symbol, an empty ring with none, or (`mix`, for a
 * selection with different statuses) a pie of the colours involved.
 */
export function StatusDot({ value, mix }: { value: ReviewStatus | null; mix?: string[] }) {
  const st = statusInfo(value);
  const Glyph = value ? STATUS_GLYPH[value] : null;
  const pie = mix && mix.length > 1
    ? `conic-gradient(${mix.map((c, i) => `${c} ${(i / mix.length) * 100}% ${((i + 1) / mix.length) * 100}%`).join(', ')})`
    : undefined;
  return (
    <span
      className="rs-dot"
      style={pie ? { background: pie } : st ? ({ '--st': st.color } as CSSProperties) : undefined}
      data-none={(!st && !pie) || undefined}
      aria-hidden="true"
    >
      {Glyph && !pie && <Glyph size={12} strokeWidth={3} />}
    </span>
  );
}

export interface MenuAt { left: number; top: number; origin: string }
const MENU_W = 200, MENU_H = 4 * 38 + 10;

/**
 * Where the menu goes for something at `r`: 'over' grows out of it (covering it, the
 * card's dot), 'below' hangs under it (a toolbar button). Flips to stay on screen.
 */
export function placeMenu(r: DOMRect, mode: 'over' | 'below'): MenuAt {
  const right = r.left + MENU_W + 8 < window.innerWidth;
  if (mode === 'below') {
    const down = r.bottom + 8 + MENU_H + 8 < window.innerHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - MENU_W / 2, window.innerWidth - MENU_W - 8));
    return { left, top: down ? r.bottom + 8 : r.top - 8 - MENU_H, origin: `${down ? 'top' : 'bottom'} center` };
  }
  const down = r.top + MENU_H + 8 < window.innerHeight;
  return {
    left: right ? r.left - 6 : r.right + 6 - MENU_W,
    top: down ? r.top - 6 : r.bottom + 6 - MENU_H,
    origin: `${down ? 'top' : 'bottom'} ${right ? 'left' : 'right'}`,
  };
}

/**
 * The menu itself (fixed to the screen, so nothing clips it, and the same size at any
 * zoom). `value` is ticked; undefined ticks nothing (a mixed selection). Closes on a
 * pick, a press outside it (other than on `opener`), scrolling, resizing or Escape.
 */
export function StatusPopup({ at, value, onPick, onClose, opener, label = 'Review status' }: {
  at: MenuAt;
  value: ReviewStatus | null | undefined;
  onPick: (s: ReviewStatus | null) => void;
  onClose: () => void;
  /** Selector for what opened it (pressing that toggles it, so it's left to do so). */
  opener: string;
  label?: string;
}) {
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.(`.status-menu, ${opener}`)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('wheel', onClose, { passive: true, capture: true });
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, opener]);
  return createPortal(
    <div
      className="status-menu"
      role="menu"
      aria-label={label}
      style={{ left: at.left, top: at.top, transformOrigin: at.origin }}
      // Clicks in here are the menu's own (not the board's, nor the card's underneath).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {[...STATUSES, null].map((s) => (
        <button
          key={s?.value ?? 'none'}
          role="menuitemradio"
          aria-checked={value !== undefined && (s?.value ?? null) === value}
          onClick={() => { onPick(s?.value ?? null); onClose(); }}
        >
          <StatusDot value={s?.value ?? null} />
          <span>{s?.label ?? 'No status'}</span>
          {value !== undefined && (s?.value ?? null) === value && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
        </button>
      ))}
    </div>,
    document.body,
  );
}
