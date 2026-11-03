import { memo, useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { stackDepth, stackTone, stackZ, useBoard } from './store';
import { columnLayout, useLayout, type Size } from './layout';
import { useUi } from './ui';
import { useBody, useLiftedZ } from './useBody';
import { createItem, itemHooks } from './actions';
import { BOARD_ROW_HEIGHT, BOARD_SWATCH, COLUMN_HEADER, NOTE_MIN_HEIGHT, NOTE_WIDTH } from './constants';
import { BoardIcon } from '../ui/BoardIcon';
import { effectiveIcon } from '../lib/iconGuess';
import { camera } from '../canvas/camera';
import { isLight } from '../lib/color';

/**
 * A column: stacks items vertically or side by side, sizes itself to fit
 * them, and can itself be stacked inside another column.
 */
export const ColumnView = memo(function ColumnView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const col = item?.kind === 'column' ? item : null;
  const childIds = col?.childIds ?? [];
  const parentId = col?.parentId ?? null;
  const zIndex = useBoard((s) => stackZ(s.items, id));
  const depth = useBoard((s) => stackDepth(s.items, id));
  // Children's sizes, flattened [w0, h0, w1, h1, …] so shallow-compare works.
  const sizeList = useLayout(useShallow((s) => childIds.flatMap((c) => [s.widths[c] ?? NOTE_WIDTH, s.heights[c] ?? NOTE_MIN_HEIGHT])));
  const slot = useLayout((s) => (parentId ? s.slots[id] : undefined));
  const dragId = useUi((s) => s.dragId);
  const drop = useUi((s) => (s.drop?.columnId === id ? s.drop : null));
  // A board is dragged as its square but lands as a row: preview that row.
  const dragged = useBoard((s) => (drop && dragId ? s.items[dragId] : undefined));
  const ghostBoard = dragged?.kind === 'board' ? dragged : null;
  const selected = useUi((s) => s.selectedIds.includes(id));
  const editing = useUi((s) => s.editingId === id);
  const moving = useUi((s) => s.movingId === id);
  const lifted = useLiftedZ(id);

  const layout = useMemo(() => {
    if (!col) return null;
    const sizes: Record<string, Size> = {};
    childIds.forEach((c, i) => { sizes[c] = { w: sizeList[i * 2], h: sizeList[i * 2 + 1] }; });
    const gap = drop && (ghostBoard ? { index: drop.index, w: NOTE_WIDTH, h: BOARD_ROW_HEIGHT } : drop);
    return columnLayout(col, sizes, dragId, gap);
  }, [col, sizeList, dragId, drop, ghostBoard]);

  const rest = !col ? null : parentId ? (slot ?? null) : { x: col.x, y: col.y };
  // Pointer capture retargets clicks to the outer wrapper, so find the
  // header by position rather than by event target.
  const inHeader = (clientY: number) =>
    clientY - visRef.current!.getBoundingClientRect().top < COLUMN_HEADER * camera.z;
  const { posRef, visRef, onPointerDown, onClick, onContextMenu } = useBody(id, itemHooks, rest, undefined, undefined,
    // Clicking a selected column's header edits its title.
    (e) => { if (inHeader(e.clientY)) useUi.getState().set({ selectedId: id, editingId: id }); });

  // Publish our size (for a parent column and hit-testing) and where our
  // children sit in the world.
  useLayoutEffect(() => {
    if (!layout || !rest) return;
    useLayout.setState((s) => {
      const slots = { ...s.slots };
      const fills = { ...s.fills };
      for (const [cid, p] of Object.entries(layout.slots)) {
        slots[cid] = { x: rest.x + p.x, y: rest.y + p.y };
        if (layout.fill) fills[cid] = layout.fill;
        else delete fills[cid];
      }
      return {
        slots,
        fills,
        widths: s.widths[id] === layout.width ? s.widths : { ...s.widths, [id]: layout.width },
        heights: s.heights[id] === layout.height ? s.heights : { ...s.heights, [id]: layout.height },
      };
    });
  }, [layout, rest?.x, rest?.y]);

  useLayoutEffect(() => () => {
    useLayout.setState((s) => {
      const { [id]: _w, ...widths } = s.widths;
      const { [id]: _h, ...heights } = s.heights;
      return { widths, heights };
    });
  }, [id]);

  if (!col || !layout) return null;

  const tone = col.color ? (isLight(col.color) ? 'light' : 'dark') : undefined;
  const visStyle = { width: layout.width, height: layout.height, '--item-bg': col.color ?? undefined } as CSSProperties;
  const update = useBoard.getState().updateItem;
  const count = col.childIds.length;

  return (
    <div
      ref={posRef}
      className="item-pos"
      data-item
      style={{ zIndex: lifted ?? zIndex, visibility: rest ? undefined : 'hidden' }}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // The header is handled by click-again; double-clicking the body adds
        // a note at the end of the column.
        if (inHeader(e.clientY)) return;
        const cid = createItem('note', { x: col.x, y: col.y });
        useBoard.getState().moveToColumn(cid, id, col.childIds.length);
      }}
    >
      <div
        ref={visRef}
        className="column"
        data-selected={selected}
        data-tone={tone}
        data-stacked={moving ? undefined : stackTone(depth)}
        data-direction={col.direction}
        style={visStyle}
      >
        {col.strip && <div className="column-strip" style={{ background: col.strip }} />}
        <header className="column-header">
          {editing ? (
            <input
              className="column-title-input"
              ref={(el) => { if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.select(); } }}
              defaultValue={col.title}
              placeholder="Column title"
              onChange={(e) => update(id, { title: e.target.value })}
              onBlur={() => {
                if (useUi.getState().editingId === id) useUi.getState().set({ editingId: null });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              }}
            />
          ) : (
            <span className="column-title" data-empty={!col.title}>{col.title || 'Untitled column'}</span>
          )}
          <span className="column-count">{count} {count === 1 ? 'item' : 'items'}</span>
        </header>

        {layout.placeholder && (
          <div
            className="column-placeholder"
            data-ghost={!!ghostBoard}
            style={{
              left: layout.placeholder.x,
              top: layout.placeholder.y,
              width: layout.placeholder.w,
              height: layout.placeholder.h,
            }}
          >
            {ghostBoard && (
              <>
                <BoardIcon icon={effectiveIcon(ghostBoard)} color={ghostBoard.color} size={28} squircle={BOARD_SWATCH} />
                <span className="board-name">{ghostBoard.title || 'Untitled board'}</span>
              </>
            )}
          </div>
        )}
        {count === 0 && !layout.placeholder && <div className="column-empty">Drop items here</div>}
      </div>
    </div>
  );
});
