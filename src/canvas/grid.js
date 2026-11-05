// Adaptive dot grid drawn as two repeating CSS radial-gradient layers.
// As you zoom out, the fine layer fades away and a 4x coarser layer takes
// over, so the on-screen spacing always stays readable.
export const GRID_SIZE = 16; // world units between dots at the finest level
const LEVEL_FACTOR = 4;
const FADE_START = 6; // px: fine layer fully hidden at this spacing
const FADE_END = 12; // px: fine layer fully visible at this spacing
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mod = (a, n) => ((a % n) + n) % n;
export function createGrid(el) {
    const readDotColor = () => getComputedStyle(el).getPropertyValue('--dot-rgb').trim() || '0 0 0';
    let rgb = readDotColor();
    let last = null;
    // Re-read the dot colour and redraw when the OS theme flips.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => {
        rgb = readDotColor();
        if (last)
            render(last);
    };
    mq.addEventListener('change', onTheme);
    const layer = (alpha, radius) => `radial-gradient(circle at center, rgb(${rgb} / ${alpha.toFixed(3)}) ${radius}px, transparent ${radius + 0.6}px)`;
    function render(cam) {
        last = cam;
        let fine = GRID_SIZE * cam.z;
        while (fine < FADE_START)
            fine *= LEVEL_FACTOR;
        const coarse = fine * LEVEL_FACTOR;
        const t = clamp01((fine - FADE_START) / (FADE_END - FADE_START));
        const fineAlpha = t * t * (3 - 2 * t); // smoothstep
        const radius = Math.min(1.2, Math.max(0.7, cam.z * 0.85));
        // Gradients centre the dot in each tile, so shift by half a tile to put
        // dots exactly on world-space multiples of the grid size.
        const pos = (step) => `${mod(cam.x - step / 2, step)}px ${mod(cam.y - step / 2, step)}px`;
        el.style.backgroundImage = `${layer(fineAlpha, radius)}, ${layer(1 - fineAlpha, radius)}`;
        el.style.backgroundSize = `${fine}px ${fine}px, ${coarse}px ${coarse}px`;
        el.style.backgroundPosition = `${pos(fine)}, ${pos(coarse)}`;
    }
    return { render, dispose: () => mq.removeEventListener('change', onTheme) };
}
