import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Canvas } from './canvas/Canvas';
import { isTyping } from './canvas/input';
import { useBoard, type ItemKind } from './board/store';
import { useUi } from './board/ui';
import { useBoardId } from './board/nav';
import { NoteView } from './board/NoteView';
import { ColumnView } from './board/ColumnView';
import { BoardView } from './board/BoardView';
import { TodoView } from './board/TodoView';
import { LinkView } from './board/LinkView';
import { MediaView } from './board/MediaView';
import { addMediaFiles } from './board/media';
import {
  clearSelection, contentBounds, createItem, deleteSelection, enterBoard, selectAll, viewportCenterWorld, zoomToFit,
} from './board/actions';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';
import { SelectionToolbar } from './ui/SelectionToolbar';
import { Marquee, startMarquee } from './ui/Marquee';
import { ContextMenu } from './ui/ContextMenu';
import { Toast } from './ui/Toast';
import { CursorChat, PeerCursors } from './ui/Presence';
import { copySelection, cutSelection, duplicateSelection, paste } from './board/clipboard';
import { camera } from './canvas/camera';

function useIds(boardId: string, kind: ItemKind) {
  return useBoard(useShallow((s) =>
    Object.values(s.items).filter((i) => i.boardId === boardId && i.kind === kind).map((i) => i.id)));
}

function ItemLayer({ boardId }: { boardId: string }) {
  // Columns render first so their published slots are ready for notes.
  const columns = useIds(boardId, 'column');
  const boards = useIds(boardId, 'board');
  const notes = useIds(boardId, 'note');
  const todos = useIds(boardId, 'todo');
  const links = useIds(boardId, 'link');
  const media = useIds(boardId, 'media');
  return (
    <>
      {columns.map((id) => <ColumnView key={id} id={id} />)}
      {boards.map((id) => <BoardView key={id} id={id} />)}
      {notes.map((id) => <NoteView key={id} id={id} />)}
      {todos.map((id) => <TodoView key={id} id={id} />)}
      {links.map((id) => <LinkView key={id} id={id} />)}
      {media.map((id) => <MediaView key={id} id={id} />)}
    </>
  );
}

function EmptyHint({ boardId }: { boardId: string }) {
  const empty = useBoard((s) => !Object.values(s.items).some((i) => i.boardId === boardId));
  if (!empty) return null;
  return <div className="empty-hint">Drag something in from the left to get started</div>;
}

const limit = () => contentBounds();

const ADD_KEYS: Record<string, ItemKind> = { n: 'note', l: 'link', t: 'todo', b: 'board', c: 'column' };

export function App() {
  const boardId = useBoardId();
  // Back/forward navigation shouldn't keep a selection from another board.
  useEffect(() => { useUi.getState().set({ selectedIds: [], editingId: null, contextMenu: null }); }, [boardId]);

  // A settings pop-up belongs to the item it was opened for.
  const selectedId = useUi((s) => s.selectedId);
  useEffect(() => { useUi.getState().set({ flyout: null }); }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      // Escape closes an open pop-up first, even from its own inputs.
      if (e.key === 'Escape' && ui.flyout) {
        ui.set({ flyout: null });
        return;
      }
      if (isTyping(e)) return;
      const selected = ui.selectedId ? useBoard.getState().items[ui.selectedId] : undefined;

      // Ctrl/Cmd shortcuts: select all, copy, cut, paste, duplicate.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const run: Record<string, () => unknown> = {
          a: selectAll, c: copySelection, x: cutSelection, d: duplicateSelection,
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
        if (here) { e.preventDefault(); enterBoard(here.boardId); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedIds.length) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        if (selected.kind === 'board' && selected.id !== boardId) enterBoard(selected.id);
        else if (selected.kind !== 'board') ui.set({ editingId: selected.id });
      } else if (e.key === 'Escape') {
        clearSelection();
      } else if (e.shiftKey && e.code === 'Digit1') {
        zoomToFit();
      } else if (key in ADD_KEYS) {
        e.preventDefault();
        createItem(ADD_KEYS[key], viewportCenterWorld());
      } else if (key === 'g') {
        ui.set({ snap: !ui.snap });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardId]);

  // Paste: image files from the system clipboard become photo cards;
  // otherwise it's our own clipboard (copied cards).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e)) return;
      e.preventDefault();
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) void addMediaFiles(files, viewportCenterWorld());
      else paste();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Drop photos/videos from the desktop anywhere on the board.
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setFileDrag(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setFileDrag(false); } };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setFileDrag(false);
      void addMediaFiles([...e.dataTransfer!.files], camera.clientToWorld(e.clientX, e.clientY));
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

  return (
    <>
      <Canvas
        viewId={boardId}
        limit={limit}
        frame={zoomToFit}
        onBackgroundPointerDown={startMarquee}
        onBackgroundContextMenu={(e) => {
          e.preventDefault();
          useUi.getState().set({
            selectedIds: [], editingId: null, flyout: null,
            contextMenu: { x: e.clientX, y: e.clientY, world: camera.clientToWorld(e.clientX, e.clientY) },
          });
        }}
      >
        <ItemLayer key={boardId} boardId={boardId} />
      </Canvas>

      <TopBar />
      <ToolRail />
      <SelectionToolbar />
      <EmptyHint boardId={boardId} />
      <Marquee />
      <ContextMenu />
      <Toast />
      <PeerCursors />
      <CursorChat />
      {fileDrag && <div className="file-drop"><span>Drop photos or videos to add them</span></div>}
    </>
  );
}
