import { jsx as _jsx } from "react/jsx-runtime";
import { boardIcon } from '../lib/icons';
import { shade } from '../lib/color';
import { squircleClip, squirclePath } from '../lib/squircle';
/** A board's colour swatch with its icon drawn in a shade of that colour. */
export function BoardIcon({ icon, color, size, squircle, className = 'board-swatch', style }) {
    const Icon = boardIcon(icon);
    return (_jsx("div", { className: className, style: {
            background: color ?? 'var(--board-default)',
            color: color ? shade(color) : 'var(--board-icon-default)',
            ...(squircle ? { width: squircle, height: squircle, clipPath: squircleClip(squircle) } : null),
            ...style,
        }, children: _jsx(Icon, { size: size, strokeWidth: 1.75, strokeLinecap: "square", strokeLinejoin: "miter", "aria-hidden": "true" }) }));
}
/**
 * Selection outline that follows a smoothed square's curve, `gap` px outside
 * it. (A CSS outline can only do rounded rectangles.)
 */
export function SquircleRing({ size, gap = 3, width = 2 }) {
    const ring = size + gap * 2 + width; // path runs through the middle of the stroke
    const box = ring + width;
    return (_jsx("svg", { className: "squircle-ring", width: box, height: box, viewBox: `0 0 ${box} ${box}`, style: { left: -(gap + width), top: -(gap + width) }, "aria-hidden": "true", children: _jsx("path", { d: squirclePath(ring, size * 0.25 + gap + width / 2), transform: `translate(${width / 2} ${width / 2})`, fill: "none", stroke: "var(--accent)", strokeWidth: width }) }));
}
