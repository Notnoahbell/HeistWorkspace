// Pasting text copied somewhere else: a link becomes a link card, other text
// a note. A Pinterest link comes in as the pin itself: its video, its GIF or
// its full-size image, as a photo/video card (via server/pinterest.ts).
import { normalizeUrl } from '../lib/links';
import { useBoard } from './store';
import { useUi } from './ui';
import { currentBoardId } from './nav';
import { snap } from './layout';
import { addMediaFiles } from './media';
import { NOTE_WIDTH } from './constants';
import { GRID_SIZE } from '../canvas/grid';
import { camera } from '../canvas/camera';
import { viewportCenterWorld } from './actions';
/** Notes longer than this are cut (a whole document pasted by accident). */
const MAX_NOTE = 20_000;
/** More links than this at once come in as one note listing them. */
const MAX_LINKS = 12;
const GAP = GRID_SIZE * 2;
const PIN_HOST = /(^|\.)pinterest\.[a-z.]{2,8}$|^pin\.it$/i;
export const isPinterest = (url) => { try {
    return PIN_HOST.test(new URL(url).hostname);
}
catch {
    return false;
} };
/** A line that is just a web address (with or without https://). */
function asUrl(line) {
    const s = line.trim();
    if (!s || /\s/.test(s))
        return null;
    // Bare words aren't links ("hello"); "example.com/x" and "www.x.y" are.
    if (!/^https?:\/\//i.test(s) && !/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s))
        return null;
    return normalizeUrl(s);
}
/** Where the pointer last was over the board (world), and when; pastes land there. */
let pointer = null;
let lastPaste = null;
window.addEventListener('pointermove', (e) => {
    pointer = e.target?.closest?.('.viewport') ? { ...camera.clientToWorld(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY } : null;
}, { passive: true });
/**
 * Where something pasted from outside goes: under the pointer if it's over the
 * board, else the middle of the view. Pasting again without moving steps along.
 */
export function pastePoint() {
    let at = pointer ? { x: pointer.x, y: pointer.y } : viewportCenterWorld();
    if (lastPaste && Math.hypot(lastPaste.x - at.x, lastPaste.y - at.y) < GRID_SIZE * 6)
        at = { x: lastPaste.x + GRID_SIZE * 2, y: lastPaste.y + GRID_SIZE * 2 };
    lastPaste = at;
    return at;
}
const toast = (text) => useUi.getState().set({ toast: { text, at: Date.now() } });
/** Paste text from outside: links as link cards (Pinterest as media), anything else as a note. */
export function pasteText(raw, at) {
    const text = raw.replace(/\r\n?/g, '\n').trim();
    if (!text)
        return [];
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const urls = lines.map(asUrl);
    const boardId = currentBoardId();
    const ids = [];
    if (urls.every(Boolean) && urls.length <= MAX_LINKS) {
        // One card per link, side by side.
        let x = snap(at.x - NOTE_WIDTH / 2);
        const y = snap(at.y - 30);
        for (const url of urls) {
            if (isPinterest(url))
                void importPin(url, { x, y });
            else {
                const id = useBoard.getState().addItem('link', { boardId, x, y, url });
                ids.push(id);
            }
            x = snap(x + NOTE_WIDTH + GAP);
        }
    }
    else {
        const id = useBoard.getState().addItem('note', {
            boardId, x: snap(at.x - NOTE_WIDTH / 2), y: snap(at.y - 30), text: text.slice(0, MAX_NOTE),
        });
        ids.push(id);
        if (text.length > MAX_NOTE)
            toast(`That was long: the note has the first ${MAX_NOTE.toLocaleString()} characters`);
    }
    if (ids.length)
        useUi.getState().set({ selectedIds: ids, editingId: null, contextMenu: null });
    return ids;
}
/** A Pinterest pin: fetch its video / GIF / image through the server and add it like an upload. */
export async function importPin(url, at) {
    const started = Date.now();
    useUi.getState().set({ toast: { text: 'Getting the pin from Pinterest…', icon: 'pin', busy: true, at: started } });
    try {
        const res = await fetch(`/api/pinterest?url=${encodeURIComponent(url)}`);
        const pin = await res.json();
        if (!res.ok || !pin.src)
            throw new Error(pin.error || 'Pinterest didn’t answer');
        const file = await fetch(`/api/pinterest/file?src=${encodeURIComponent(pin.src)}`);
        if (!file.ok)
            throw new Error((await file.json().catch(() => ({}))).error || 'Couldn’t download it');
        const blob = await file.blob();
        const ext = pin.src.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
        const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type
            : ext === 'mp4' ? 'video/mp4' : ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const name = `${(pin.name || 'Pinterest pin').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.${ext}`;
        // Pins come in as just the picture (name tucked away); videos loop like a GIF.
        await addMediaFiles([new File([blob], name, { type })], at, { captionHidden: true, loop: pin.kind === 'video' });
        useUi.getState().set({ toast: { text: pin.kind === 'video' ? 'Added the pin’s video' : pin.kind === 'gif' ? 'Added the pin’s GIF' : 'Added the pin’s image', icon: 'pin', ms: 1800, at: Date.now() } });
    }
    catch (e) {
        // Couldn't get the media: keep the link at least.
        const id = useBoard.getState().addItem('link', { boardId: currentBoardId(), x: at.x, y: at.y, url });
        useUi.getState().set({ selectedIds: [id], toast: { text: `Couldn’t import from Pinterest (${e.message}), so it’s a link`, at: Date.now() } });
    }
}
