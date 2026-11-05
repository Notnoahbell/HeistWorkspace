// The pointer: a rounded arrowhead (no stalk) with a white outline. Yours is
// black; other people's use the same shape in their colour.
/** Arrowhead outline in a 24×24 box, tip near (4, 4). */
export const CURSOR_PATH = 'M5.2 3.6 L19.3 9.6 Q20.7 10.2 19.2 10.8 L12.9 13 Q12.4 13.2 12.2 13.7 L9.9 19.9 Q9.3 21.4 8.7 19.9 L3.7 5.1 Q3.3 3.3 5.2 3.6 Z';
/** Where the tip is, in the 24×24 box (the CSS hotspot). */
export const CURSOR_TIP = { x: 4, y: 4 };
export function cursorSvg(fill) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
        + `<path d="${CURSOR_PATH}" fill="${fill}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
/** Make it the page's default cursor (exposed to CSS as --cursor). */
export function installCursor() {
    const url = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg('#111'))}") ${CURSOR_TIP.x} ${CURSOR_TIP.y}, default`;
    document.documentElement.style.setProperty('--cursor', url);
}
