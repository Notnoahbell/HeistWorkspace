// A pop-up panel. Closes on outside press; Escape is handled globally.
// Portalled to <body> so transformed/clipped parents can't affect it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../board/ui';

const MARGIN = 8;

interface Props {
  left: number;
  /** Preferred top; nudged to stay on screen. */
  top: number;
  /** Client y the notch should point at (on the left edge); omit for no notch. */
  notchY?: number;
  label: string;
  children: ReactNode;
}

export function Flyout({ left, top, notchY, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(top);

  // Keep the whole panel on screen once we know its height.
  useLayoutEffect(() => {
    const h = ref.current!.offsetHeight;
    const minTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) + MARGIN;
    setY(Math.max(minTop, Math.min(top, window.innerHeight - h - MARGIN)));
  });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      // Trigger buttons toggle the pop-up themselves.
      if (ref.current?.contains(t) || t.closest('[data-flyout-trigger]')) return;
      useUi.getState().set({ flyout: null });
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  const notch = notchY != null ? Math.max(14, notchY - y) : null;

  return createPortal(
    <div
      ref={ref}
      className="flyout"
      role="dialog"
      aria-label={label}
      style={{ left, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {notch != null && <span className="flyout-notch" style={{ top: notch }} aria-hidden="true" />}
      <div className="flyout-body">{children}</div>
    </div>,
    document.body,
  );
}
