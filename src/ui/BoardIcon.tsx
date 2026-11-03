import type { CSSProperties } from 'react';
import { boardIcon } from '../lib/icons';
import { shade } from '../lib/color';
import { squircleClip, squirclePath } from '../lib/squircle';

interface Props {
  icon: string | null;
  color: string | null;
  size: number;
  /** Pixel size of a smoothed-corner square to clip to (board tiles). */
  squircle?: number;
  className?: string;
  style?: CSSProperties;
}

/** A board's colour swatch with its icon drawn in a shade of that colour. */
export function BoardIcon({ icon, color, size, squircle, className = 'board-swatch', style }: Props) {
  const Icon = boardIcon(icon);
  return (
    <div
      className={className}
      style={{
        background: color ?? 'var(--board-default)',
        color: color ? shade(color) : 'var(--board-icon-default)',
        ...(squircle ? { width: squircle, height: squircle, clipPath: squircleClip(squircle) } : null),
        ...style,
      }}
    >
      <Icon size={size} strokeWidth={1.75} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />
    </div>
  );
}

/**
 * Selection outline that follows a smoothed square's curve, `gap` px outside
 * it. (A CSS outline can only do rounded rectangles.)
 */
export function SquircleRing({ size, gap = 3, width = 2 }: { size: number; gap?: number; width?: number }) {
  const ring = size + gap * 2 + width; // path runs through the middle of the stroke
  const box = ring + width;
  return (
    <svg
      className="squircle-ring"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ left: -(gap + width), top: -(gap + width) }}
      aria-hidden="true"
    >
      <path
        d={squirclePath(ring, size * 0.25 + gap + width / 2)}
        transform={`translate(${width / 2} ${width / 2})`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={width}
      />
    </svg>
  );
}
