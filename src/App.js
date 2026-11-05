import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Canvas } from './canvas/Canvas';
import { isTyping } from './canvas/input';
import { onCanvas, useBoard } from './board/store';
import { useUi } from './board/ui';
import { useBoardId } from './board/nav';
import { NoteView } from './board/NoteView';
import { ColumnView } from './board/ColumnView';
import { FrameView } from './board/FrameView';
import { BoardView } from './board/BoardView';
import { TodoView } from './board/TodoView';
import { LinkView } from './board/LinkView';
import { MediaView } from './board/MediaView';
import { addMediaFiles, addVersionFile } from './board/media';
import { videoTargetAt } from './board/versions';
import { currentBoardId } from './board/nav';
import { arrowKey, clearSelection, contentBounds, createItem, deleteSelection, enterBoard, selectAll, viewportCenterWorld, wrapInFrame, zoomToFit, } from './board/actions';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';
import { SelectionToolbar } from './ui/SelectionToolbar';
import { Marquee, startMarquee } from './ui/Marquee';
import { ContextMenu } from './ui/ContextMenu';
import { Toast } from './ui/Toast';
import { CursorChat, PeerCursors, PeerSelections } from './ui/Presence';
import { MediaViewer, openViewer } from './ui/MediaViewer';
import { MediaWall, openWall } from './ui/MediaWall';
import { AdminPage, isAdminOpen } from './ui/AdminPage';
import { TooltipLayer } from './ui/Tooltip';
import { Downloads } from './ui/Downloads';
import { CommentsPopover } from './ui/Comments';
import { copySelection, cutSelection, duplicateSelection, isOwnCopy, paste } from './board/clipboard';
import { pastePoint, pasteText } from './board/pasteText';
import { camera } from './canvas/camera';
function useIds(boardId, kind) {
    return useBoard(useShallow((s) => Object.values(s.items).filter((i) => i.boardId === boardId && i.kind === kind).map((i) => i.id)));
}
function ItemLayer({ boardId }) {
    // Frames first (they sit behind everything); then columns, so their published slots are ready for notes.
    const frames = useIds(boardId, 'frame');
    const columns = useIds(boardId, 'column');
    const boards = useIds(boardId, 'board');
    const notes = useIds(boardId, 'note');
    const todos = useIds(boardId, 'todo');
    const links = useIds(boardId, 'link');
    const media = useIds(boardId, 'media');
    return (_jsxs(_Fragment, { children: [frames.map((id) => _jsx(FrameView, { id: id }, id)), columns.map((id) => _jsx(ColumnView, { id: id }, id)), boards.map((id) => _jsx(BoardView, { id: id }, id)), notes.map((id) => _jsx(NoteView, { id: id }, id)), todos.map((id) => _jsx(TodoView, { id: id }, id)), links.map((id) => _jsx(LinkView, { id: id }, id)), media.map((id) => _jsx(MediaView, { id: id }, id))] }));
}
function EmptyHint({ boardId }) {
    const empty = useBoard((s) => !Object.values(s.items).some((i) => i.boardId === boardId && onCanvas(i)));
    if (!empty)
        return null;
    return _jsx("div", { className: "empty-hint", children: "Drag something in from the left to get started" });
}
const limit = () => contentBounds();
// S adds a section; C still does too (sections used to be columns).
const ADD_KEYS = { n: 'note', l: 'link', t: 'todo', b: 'board', s: 'column', c: 'column' };
export function App() {
    const boardId = useBoardId();
    // Back/forward navigation shouldn't keep a selection from another board.
    useEffect(() => { useUi.getState().set({ selectedIds: [], editingId: null, contextMenu: null, viewer: null, wall: null }); }, [boardId]);
    // A settings pop-up belongs to the item it was opened for.
    const selectedId = useUi((s) => s.selectedId);
    useEffect(() => { useUi.getState().set({ flyout: null, commenting: null }); }, [selectedId]);
    useEffect(() => {
        const onKey = (e) => {
            const ui = useUi.getState();
            // Escape closes an open pop-up first, even from its own inputs.
            if (e.key === 'Escape' && ui.flyout) {
                ui.set({ flyout: null });
                return;
            }
            // The player has its own keys.
            if (isTyping(e) || ui.viewer || ui.wall || isAdminOpen())
                return;
            const selected = ui.selectedId ? useBoard.getState().items[ui.selectedId] : undefined;
            // Ctrl/Cmd shortcuts: select all, copy, cut, paste, duplicate.
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
                const k = e.key.toLowerCase();
                const run = {
                    a: selectAll, c: copySelection, x: cutSelection, d: duplicateSelection,
                    g: () => { if (ui.selectedIds.length)
                        wrapInFrame(); },
                };
                if (run[k]) {
                    e.preventDefault();
                    run[k]();
                    return;
                }
            }
            // Alt+↑ goes up a level.
            if (e.altKey && e.key === 'ArrowUp') {
                const here = useBoard.getState().items[boardId];
                if (here) {
                    e.preventDefault();
                    enterBoard(here.boardId);
                }
                return;
            }
            if (e.ctrlKey || e.metaKey || e.altKey)
                return;
            const key = e.key.toLowerCase();
            if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedIds.length) {
                e.preventDefault();
                deleteSelection();
            }
            else if (e.key === 'Enter' && ui.selectedIds.length > 1) {
                // Several photos / videos: play them side by side.
                if (openWall(ui.selectedIds))
                    e.preventDefault();
            }
            else if (e.key === 'Enter' && selected) {
                e.preventDefault();
                if (selected.kind === 'board' && selected.id !== boardId)
                    enterBoard(selected.id);
                else if (selected.kind === 'media')
                    openViewer(selected.id);
                else if (selected.kind !== 'board')
                    ui.set({ editingId: selected.id });
            }
            else if (e.key === 'Escape') {
                clearSelection();
            }
            else if (e.key.startsWith('Arrow') && ui.selectedIds.length) {
                const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
                if (d && arrowKey(d[0], d[1], e.shiftKey))
                    e.preventDefault();
            }
            else if (e.shiftKey && e.code === 'Digit1') {
                zoomToFit();
            }
            else if (key in ADD_KEYS) {
                e.preventDefault();
                createItem(ADD_KEYS[key], viewportCenterWorld());
            }
            else if (key === 'g') {
                ui.set({ snap: !ui.snap });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [boardId]);
    // While Shift is held, sections and frames show they can be box-selected inside.
    useEffect(() => {
        const root = document.documentElement;
        const set = (e) => root.toggleAttribute('data-shift', e.shiftKey);
        const clear = () => root.removeAttribute('data-shift');
        window.addEventListener('keydown', set);
        window.addEventListener('keyup', set);
        window.addEventListener('blur', clear);
        return () => { window.removeEventListener('keydown', set); window.removeEventListener('keyup', set); window.removeEventListener('blur', clear); };
    }, []);
    // Paste: image files from the system clipboard become photo cards;
    // otherwise it's our own clipboard (copied cards).
    useEffect(() => {
        const onPaste = (e) => {
            if (isTyping(e) || useUi.getState().viewer || useUi.getState().wall || isAdminOpen())
                return;
            e.preventDefault();
            const files = [...(e.clipboardData?.files ?? [])];
            const text = e.clipboardData?.getData('text/plain') ?? '';
            // Where the pointer is (else the middle of the view).
            if (files.length)
                void addMediaFiles(files, pastePoint());
            // Text from elsewhere: a link card (a Pinterest pin as its media), or a note.
            else if (text.trim() && !isOwnCopy(text))
                pasteText(text, pastePoint());
            // Cards copied here.
            else
                paste();
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, []);
    // Drop photos/videos from the desktop anywhere on the board.
    const [fileDrag, setFileDrag] = useState(false);
    useEffect(() => {
        let depth = 0;
        const hasFiles = (e) => !!e.dataTransfer?.types.includes('Files');
        const enter = (e) => { if (hasFiles(e)) {
            depth++;
            setFileDrag(true);
        } };
        const ui = () => useUi.getState();
        const leave = (e) => {
            if (hasFiles(e) && --depth <= 0) {
                depth = 0;
                setFileDrag(false);
                if (ui().versionDrop)
                    ui().set({ versionDrop: null });
            }
        };
        // One video file over a video card: it would become that card's next version.
        const versionTarget = (e) => {
            const items = e.dataTransfer?.items;
            if (!items || items.length !== 1 || !items[0].type.startsWith('video/'))
                return null;
            return videoTargetAt(camera.clientToWorld(e.clientX, e.clientY), currentBoardId(), new Set());
        };
        const over = (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const target = versionTarget(e);
            if (target !== ui().versionDrop)
                ui().set({ versionDrop: target });
        };
        const drop = (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
            depth = 0;
            setFileDrag(false);
            const files = [...e.dataTransfer.files];
            const onto = ui().versionDrop;
            if (onto)
                ui().set({ versionDrop: null });
            if (onto && files.length === 1 && files[0].type.startsWith('video/'))
                void addVersionFile(onto, files[0]);
            else
                void addMediaFiles(files, camera.clientToWorld(e.clientX, e.clientY));
        };
        window.addEventListener('dragenter', enter);
        window.addEventListener('dragleave', leave);
        window.addEventListener('dragover', over);
        window.addEventListener('drop', drop);
        return () => {
            window.removeEventListener('dragenter', enter);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('dragover', over);
            window.removeEventListener('drop', drop);
        };
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx(Canvas, { viewId: boardId, limit: limit, frame: zoomToFit, onBackgroundPointerDown: startMarquee, onBackgroundContextMenu: (e) => {
                    e.preventDefault();
                    useUi.getState().set({
                        selectedIds: [], editingId: null, flyout: null,
                        contextMenu: { x: e.clientX, y: e.clientY, world: camera.clientToWorld(e.clientX, e.clientY) },
                    });
                }, children: _jsx(ItemLayer, { boardId: boardId }, boardId) }), _jsx(TopBar, {}), _jsx(ToolRail, {}), _jsx(SelectionToolbar, {}), _jsx(CommentsPopover, {}), _jsx(EmptyHint, { boardId: boardId }), _jsx(Marquee, {}), _jsx(ContextMenu, {}), _jsx(Toast, {}), _jsx(PeerSelections, {}), _jsx(PeerCursors, {}), _jsx(CursorChat, {}), _jsx(MediaWall, {}), _jsx(AdminPage, {}), _jsx(Downloads, {}), _jsx(TooltipLayer, {}), _jsx(MediaViewer, {}), fileDrag && _jsx(FileDropHint, {})] }));
}
/** While files are dragged over the window: what dropping will do. */
function FileDropHint() {
    const onto = useUi((s) => s.versionDrop);
    return (_jsx("div", { className: "file-drop", "data-onto": onto ? 'version' : undefined, children: _jsx("span", { children: onto ? 'Drop onto the video to add it as a new version' : 'Drop photos or videos to add them' }) }));
}
