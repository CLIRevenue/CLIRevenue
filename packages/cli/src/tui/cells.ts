/**
 * Terminal cells are not the units a saved layout is written in.
 *
 * `AdLayout` is CSS pixels — `AD_SIZE_LIMITS` calls a slot `120 × 60` at
 * minimum and `1280 × 1024` at most, and the SDK resolves that layout against
 * a real DOM container when it renders. A terminal reports `cols × rows`, and
 * those numbers are meaningless to the browser that will later draw the ad:
 * saving a slot that is 30 cells wide as `size.width = 30` would hand the SDK a
 * thirty-pixel ad and nothing would ever be visible.
 *
 * So the overlay works in cells, because that is what a mouse coordinate *is*,
 * and converts to pixels exactly once, at the moment the layout is saved. The
 * conversion is a nominal metric rather than a measurement. A terminal cannot
 * be asked how many pixels wide a cell is — that depends on the user's font,
 * their font size, and their DPI scaling — and a wrong answer by a factor of
 * two would be far worse than a consistent estimate the user can correct by
 * dragging the slot again. `CELL_WIDTH` and `CELL_HEIGHT` are therefore
 * deliberately round numbers in the middle of the range a stock monospace font
 * occupies at a default size, and deliberately named, so the assumption is
 * visible to whoever reads this next rather than buried in an arithmetic
 * expression.
 *
 * What this buys, and why it is not approximate in the way that sounds: the
 * *position* is stored as an anchor plus an offset measured from that anchor,
 * not as an absolute pixel coordinate. A layout saved from an 80-column
 * terminal and rendered in a 200-column window re-resolves against the new
 * container and lands proportionally, which is the "the slot goes small with
 * the window" behaviour the overlay is for. The nominal metric only affects
 * how large the ad is drawn, never where.
 */

import { AD_SIZE_LIMITS, type AdBox, type AdContainer } from '../project/geometry.js';

/** Nominal pixels per character cell in a default-sized monospace font. */
export const CELL_WIDTH = 8;

/** Nominal pixels per terminal row in the same font. */
export const CELL_HEIGHT = 16;

/** How many pixels one cell is worth, as a container a layout can resolve against. */
export const CELL_METRIC = { width: CELL_WIDTH, height: CELL_HEIGHT } as const;

/**
 * The size limits expressed in cells, derived rather than chosen.
 *
 * These are not independent numbers. If they were, tightening `AD_SIZE_LIMITS`
 * to stop an ad being 10px tall would silently stop being enforceable here —
 * the overlay would happily save a box the SDK would then reject, and the
 * failure would only surface in the browser, in a different program, at runtime.
 * Deriving them means a limit can only ever change in one place and the two
 * representations cannot disagree.
 */
export function cellSizeLimits(): {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
} {
  return {
    minWidth: Math.max(2, Math.ceil(AD_SIZE_LIMITS.minWidth / CELL_WIDTH)),
    minHeight: Math.max(2, Math.ceil(AD_SIZE_LIMITS.minHeight / CELL_HEIGHT)),
    maxWidth: Math.floor(AD_SIZE_LIMITS.maxWidth / CELL_WIDTH),
    maxHeight: Math.floor(AD_SIZE_LIMITS.maxHeight / CELL_HEIGHT),
  };
}

/**
 * The terminal expressed as the pixel container a layout is resolved against.
 *
 * Multiplied rather than divided because the overlay measures in cells and the
 * layout is stored in pixels, so going from a `cols × rows` viewport to the
 * equivalent box is the only conversion that happens on the way in.
 */
export function pixelContainerFor(cols: number, rows: number): AdContainer {
  return {
    width: Math.max(1, Math.floor(cols)) * CELL_WIDTH,
    height: Math.max(1, Math.floor(rows)) * CELL_HEIGHT,
  };
}

/** A box measured in cells, expressed in pixels for `boxToLayout`. */
export function cellsToPixels(box: AdBox): AdBox {
  return {
    left: box.left * CELL_WIDTH,
    top: box.top * CELL_HEIGHT,
    width: box.width * CELL_WIDTH,
    height: box.height * CELL_HEIGHT,
  };
}

/**
 * A pixel box expressed in cells, rounded outward.
 *
 * Outward, not nearest: this is how an existing layout is previewed back to the
 * user, and rounding inward would shrink a slot by up to a cell on every edge
 * and show them a slightly smaller ad than the one they saved.
 */
export function pixelsToCells(box: AdBox): AdBox {
  return {
    left: Math.floor(box.left / CELL_WIDTH),
    top: Math.floor(box.top / CELL_HEIGHT),
    width: Math.max(1, Math.round(box.width / CELL_WIDTH)),
    height: Math.max(1, Math.round(box.height / CELL_HEIGHT)),
  };
}

/**
 * Clamp a dragged box to something the SDK will accept.
 *
 * `maxWidth`/`maxHeight` are additionally capped by the space actually
 * available, because the pixel maximum is generous enough that a narrow
 * terminal would otherwise be allowed to record a box hanging off its own edge.
 * The result can be degenerate — a box of zero area means the user pressed and
 * released without moving — and that is deliberately *not* corrected here.
 * Turning a stray click into a minimum-sized ad would put a slot somewhere the
 * user never pointed; the caller checks for degeneracy and asks instead.
 */
export function clampCellBox(
  box: AdBox,
  available: { cols: number; rows: number },
): AdBox {
  const limits = cellSizeLimits();
  const maxWidth = Math.max(1, Math.min(limits.maxWidth, available.cols));
  const maxHeight = Math.max(1, Math.min(limits.maxHeight, available.rows));

  const width = Math.max(0, Math.min(box.width, maxWidth));
  const height = Math.max(0, Math.min(box.height, maxHeight));
  return {
    left: Math.max(0, Math.min(box.left, Math.max(0, available.cols - width))),
    top: Math.max(0, Math.min(box.top, Math.max(0, available.rows - height))),
    width,
    height,
  };
}

/** True when a dragged box has no area, i.e. the user clicked without moving. */
export function isDegenerate(box: AdBox): boolean {
  return box.width < 1 || box.height < 1;
}

/**
 * Grow a dragged box to the cell minimums, anchored at its top-left.
 *
 * A drag can legitimately end up smaller than the minimum — the user traced a
 * small box on purpose. Growing from the top-left rather than centring keeps
 * the corner they started from, which is the one they were looking at when
 * they let go.
 */
export function enforceCellMinimum(box: AdBox): AdBox {
  const limits = cellSizeLimits();
  return {
    ...box,
    width: Math.max(limits.minWidth, box.width),
    height: Math.max(limits.minHeight, box.height),
  };
}
