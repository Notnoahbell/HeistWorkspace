import { GRID_SIZE } from '../canvas/grid';

// Sizes are multiples of the grid so snapped items line up with the dots.
export const NOTE_WIDTH = GRID_SIZE * 15; // 240
/** Photos/videos: landscape ones a little wider than a note. */
export const MEDIA_WIDTH = GRID_SIZE * 20; // 320
export const MEDIA_WIDTH_PORTRAIT = NOTE_WIDTH;
export const COLUMN_PAD = GRID_SIZE; // 16
export const COLUMN_WIDTH = NOTE_WIDTH + COLUMN_PAD * 2; // 272 = 17 grid units
export const COLUMN_HEADER = GRID_SIZE * 3.5; // 56: title + item count
export const COLUMN_GAP = GRID_SIZE / 2; // 8
export const COLUMN_EMPTY = GRID_SIZE * 5; // 80
/** Height assumed for a note before it has been measured. */
export const NOTE_MIN_HEIGHT = 56;
export const BOARD_WIDTH = GRID_SIZE * 10; // 160
/** A board's icon square: the same size floating and stacked in a column. */
export const BOARD_SWATCH = GRID_SIZE * 4; // 64
export const BOARD_HEIGHT = GRID_SIZE * 7; // 112: square + name + counts
/** A board stacked in a column: the square plus 12px padding around it. */
export const BOARD_ROW_HEIGHT = BOARD_SWATCH + 24; // 88
