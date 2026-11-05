export function hsvToHex({ h, s, v }) {
    const f = (n) => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${to(f(5))}${to(f(3))}${to(f(1))}`.toUpperCase();
}
export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m)
        return null;
    let s = m[1];
    if (s.length === 3)
        s = s.replace(/./g, (c) => c + c);
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function hexToHsv(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb)
        return null;
    const [r, g, b] = rgb.map((c) => c / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
        if (max === r)
            h = ((g - b) / d) % 6;
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
        if (h < 0)
            h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
}
export function normalizeHex(input) {
    const rgb = hexToRgb(input);
    if (!rgb)
        return null;
    return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb)
        return 1;
    const [r, g, b] = rgb.map((c) => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** True when dark text reads better than light text on this colour. */
export const isLight = (hex) => luminance(hex) > 0.4;
/** Preset colours offered by every colour picker (cards, columns, boards, strips). */
export const COLOR_PRESETS = [
    '#FA5252', '#FD7E14', '#FAB005', '#82C91E',
    '#40C057', '#12B886', '#15AABF', '#228BE6',
    '#4C6EF5', '#7950F2', '#BE4BDB', '#E64980',
    '#868E96', '#343A40', '#A47148', '#F7C59F',
];
/**
 * Icon colour for something drawn on `hex`: a darker, richer shade of the
 * same hue. Only on genuinely dark colours (navy, charcoal), where a darker
 * shade wouldn't show, a light tint instead.
 */
export function shade(hex) {
    const hsv = hexToHsv(hex);
    if (!hsv)
        return hex;
    const s = hsv.s < 0.04 ? 0 : Math.min(1, hsv.s + 0.45); // keep greys grey
    return luminance(hex) > 0.12
        ? hsvToHex({ h: hsv.h, s, v: hsv.v * 0.45 })
        : hsvToHex({ h: hsv.h, s: s * 0.35, v: Math.min(1, hsv.v + 0.55) });
}
