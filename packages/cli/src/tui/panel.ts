/**
 * The overlay's drawing, with none of its I/O.
 *
 * Every function in this file takes state and returns strings. That split is
 * not tidiness for its own sake: the repository's vitest runs with
 * `environment: 'node'` and no DOM, so the only kind of overlay code that can
 * be tested at all is the code that has no terminal in it. `overlay.ts` owns
 * the terminal, and is the part we reason about on paper; this is the part we
 * can assert on.
 *
 * ## Why the overlay scrolls before it draws anything
 *
 * A terminal cannot be read. ANSI has no sequence that returns what is on a
 * given cell, so once the overlay paints over the user's output, that output
 * is gone — not hidden, gone. tmux can save a region and restore it because
 * tmux owns a screen buffer; a program talking to a terminal directly does not.
 *
 * So the overlay never paints over content it does not own. Before drawing it
 * emits enough newlines to scroll the viewport, which guarantees the rows it
 * is about to use are blank, and puts the user's output above them where
 * scrolling can reach it. The cost is that their history moves; the
 * alternative is destroying it, and for a command whose whole purpose is to
 * not surprise the person running it, that is the wrong trade.
 *
 * ## What the rows mean
 *
 * In `home` the overlay owns the bottom `PANEL_HEIGHT` rows. In `placing` it
 * has scrolled further and owns the whole viewport. Because it chose where to
 * scroll to, it knows exactly which rows those are — no cursor-position query
 * is needed, and no fallback path for a terminal that fails to answer one.
 */

import type { AdBox } from '../project/geometry.js';
import { colors } from '../utils/colors.js';
import { centerWithin, stringWidth, truncateToWidth } from './ansi.js';

/** Rows the home panel occupies. Fixed, so the overlay never jumps under the cursor. */
export const PANEL_HEIGHT = 12;

const PANEL_MIN_WIDTH = 40;
const PANEL_MAX_WIDTH = 72;

/**
 * The scrim's background.
 *
 * "A little grey, almost transparent" has no exact ANSI equivalent — a
 * background colour is opaque, and there is no alpha. A near-default grey is
 * the closest a terminal gets: it reads as the interface being washed out
 * rather than replaced, which is the intended feeling, and it leaves enough
 * contrast for the instruction text and the drag outline to stay legible on
 * top of it.
 */
const SCRIM_BACKGROUND = '\x1b[48;5;238m';

const SCRIM_FOREGROUND = '\x1b[39m';

const SCRIM_RESET = '\x1b[0m';

/** Panel-local rows, named so the layout below reads as a layout. */
const ROW_TOP_BORDER = 0;
const ROW_TITLE = 2;
const ROW_NAME = 4;
const ROW_FIRST_METRIC = 6;
const ROW_BUTTONS = 10;
const ROW_BOTTOM_BORDER = 11;

const ADD_SLOT_LABEL = '[ Add slot ]';
const CLOSE_LABEL = '[ Close ]';
const BUTTON_GAP = 3;

const PLACE_INSTRUCTION = 'Click and drag to configure a slot';

export const PLACE_INSTRUCTION_TEXT = PLACE_INSTRUCTION;

/** How long the "slot created" confirmation stays up before fading out entirely. */
export const CREATED_FADE_MS = 1400;

/** What the backend told us about this publisher. */
export interface PanelMetrics {
  fullName: string | null;
  publisherName: string;
  adsSeen: number;
  earningsMilliCents: number;
  slotCount: number;
}

export type OverlayMode = 'home' | 'placing' | 'dragging' | 'created';

export interface OverlayState {
  mode: OverlayMode;
  metrics: PanelMetrics;
  /** Origin of the drag in absolute viewport coordinates, 0-based. */
  anchor: { col: number; row: number } | null;
  /** Current pointer position while dragging, 0-based. */
  pointer: { col: number; row: number } | null;
  /** Milliseconds since the "slot created" confirmation appeared. */
  fadeElapsedMs: number;
  /** Rows the overlay currently owns: `[firstRow, lastRow]`, 0-based inclusive. */
  ownedRows: { first: number; last: number };
}

export type OverlayEffect =
  | { kind: 'createSlot'; box: AdBox }
  | { kind: 'close' };

export type OverlayEvent =
  | { kind: 'press'; col: number; row: number }
  | { kind: 'release'; col: number; row: number }
  | { kind: 'motion'; col: number; row: number }
  | { kind: 'tick'; elapsedMs: number }
  | { kind: 'escape' };

export interface PanelLayout {
  width: number;
  height: number;
  addSlot: { left: number; width: number; row: number };
  close: { left: number; width: number; row: number };
}

/** Thousands separators, applied to the integer part only. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, ',');
}

/**
 * Render milli-cents as dollars.
 *
 * `cost_milli_cents` is an integer count of milli-cents, so a dollar is
 * 100,000 of them. The number that comes back is genuinely small — a single
 * impression is worth four decimal places of a cent — so amounts below a cent
 * are shown to four places rather than rounded away to `$0.00`, which would
 * tell a publisher with a working slot that they have earned nothing.
 *
 * What this figure is: the advertiser-side cost recorded against each serve in
 * `ad_serve_log`. The schema has no per-publisher payout, so this is what the
 * publisher's impressions were sold for, which is what "earned" means to the
 * person reading it.
 */
export function formatMilliCents(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  const dollars = value / 100_000;
  const fixed = dollars.toFixed(dollars < 0.01 ? 4 : 2);
  const [whole = '0', fraction] = fixed.split('.');
  return `$${groupThousands(whole)}${fraction ? `.${fraction}` : ''}`;
}

/** Render a count with thousands separators, never a placeholder. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return groupThousands(Math.floor(value).toString());
}

/** The panel's geometry for a given terminal width. */
export function planPanel(cols: number): PanelLayout {
  const width = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.floor(cols) - 4));
  const span = ADD_SLOT_LABEL.length + BUTTON_GAP + CLOSE_LABEL.length;
  const start = Math.max(0, Math.floor((width - span) / 2));

  return {
    width,
    height: PANEL_HEIGHT,
    addSlot: { left: start, width: ADD_SLOT_LABEL.length, row: ROW_BUTTONS },
    close: { left: start + ADD_SLOT_LABEL.length + BUTTON_GAP, width: CLOSE_LABEL.length, row: ROW_BUTTONS },
  };
}

/** True when a press at viewport `(col, row)` landed on the Add slot button. */
export function hitsAddSlot(col: number, row: number, panelTop: number, cols: number): boolean {
  const layout = planPanel(cols);
  const button = layout.addSlot;
  return (
    row - panelTop === button.row && col >= button.left && col < button.left + button.width
  );
}

/** True when a press at viewport `(col, row)` landed on the Close button. */
export function hitsClose(col: number, row: number, panelTop: number, cols: number): boolean {
  const layout = planPanel(cols);
  const button = layout.close;
  return (
    row - panelTop === button.row && col >= button.left && col < button.left + button.width
  );
}

/** Pad or truncate to an exact display width, so every row lines up. */
function fit(text: string, width: number): string {
  return truncateToWidth(text, width) + ' '.repeat(Math.max(0, width - stringWidth(truncateToWidth(text, width))));
}

function framed(body: string, width: number): string {
  return `│${fit(body, width - 2)}│`;
}

function metricRow(label: string, value: string, width: number): string {
  const inner = width - 2;
  const left = `  ${label}`;
  const right = `${value}  `;
  const gap = inner - stringWidth(left) - stringWidth(right);
  return framed(gap > 0 ? left + ' '.repeat(gap) + right : left, width);
}

/**
 * The home panel, as exactly `PANEL_HEIGHT` lines.
 *
 * Title, then the user's name, then the two numbers they asked for, then the
 * slot count, then the buttons. Name before metrics because the name is what
 * tells a developer whether they are in the right project at all — a wrong key
 * that still authenticates would otherwise look plausible for a moment.
 */
export function renderPanel(state: OverlayState, cols: number): string[] {
  const layout = planPanel(cols);
  const { width } = layout;
  const inner = width - 2;
  const metrics = state.metrics;
  const name = metrics.fullName?.trim() || metrics.publisherName;

  const lines: string[] = [];
  lines.push(`╭${'─'.repeat(inner)}╮`);
  lines.push(framed('', width));
  lines.push(framed(centerWithin(colors.bold('CLIRevenue'), inner), width));
  lines.push(framed('', width));
  lines.push(framed(centerWithin(colors.cyan(name), inner), width));
  lines.push(framed('', width));
  lines.push(metricRow('Ads seen', formatCount(metrics.adsSeen), width));
  lines.push(metricRow('Earned', formatMilliCents(metrics.earningsMilliCents), width));
  lines.push(metricRow('Slots', formatCount(metrics.slotCount), width));
  lines.push(framed('', width));

  const buttonRow = ' '.repeat(layout.addSlot.left)
    + colors.cyan(ADD_SLOT_LABEL)
    + ' '.repeat(BUTTON_GAP)
    + colors.dim(CLOSE_LABEL);
  lines.push(framed(buttonRow, width));
  lines.push(`╰${'─'.repeat(inner)}╯`);

  return lines;
}

/**
 * The full-viewport scrim shown while waiting for the first click of a drag.
 *
 * The instruction sits on the first row rather than centred, because the user
 * is being asked to look at where they are about to click, not at a dialog.
 */
export function renderScrim(cols: number, rows: number): string[] {
  const line = (body: string): string =>
    `${SCRIM_BACKGROUND}${SCRIM_FOREGROUND}${fit(body, cols)}${SCRIM_RESET}`;

  return [
    line(centerWithin(colors.bold(PLACE_INSTRUCTION), cols)),
    ...Array.from({ length: Math.max(0, rows - 1) }, () => line('')),
  ];
}

/** How a drag rectangle is drawn while the pointer is down. */
export interface CellRun {
  row: number;
  col: number;
  text: string;
}

/**
 * The outline of the box the user is dragging.
 *
 * Returned as positioned runs rather than whole lines, because these are painted
 * over blank rows the overlay scrolled into existence: overwriting a whole line
 * would be fine here but would be a lie the moment the background is anything
 * else, and the caller needs to erase precisely the cells that were written.
 */
export function renderBoxOutline(box: AdBox): CellRun[] {
  const { left, top, width, height } = box;
  if (width < 1 || height < 1) return [];

  const runs: CellRun[] = [];
  const lastRow = top + height - 1;
  const lastCol = left + width - 1;

  if (height === 1) {
    return [{ row: top, col: left, text: colors.cyan('─'.repeat(width)) }];
  }

  runs.push({ row: top, col: left, text: colors.cyan(`┌${'─'.repeat(width - 2)}┐`) });
  for (let row = top + 1; row < lastRow; row += 1) {
    runs.push({ row, col: left, text: colors.cyan('│') });
    runs.push({ row, col: lastCol, text: colors.cyan('│') });
  }
  runs.push({ row: lastRow, col: left, text: colors.cyan(`└${'─'.repeat(width - 2)}┘`) });
  return runs;
}

/** The same cells as `renderBoxOutline`, blanked, for erasing a stale outline. */
export function eraseBoxOutline(box: AdBox): CellRun[] {
  return renderBoxOutline(box).map((run) => ({ ...run, text: ' '.repeat(stringWidth(run.text)) }));
}

/** The confirmation drawn after a slot has been written to disk. */
export function renderCreated(state: OverlayState, cols: number, rows: number): string[] {
  const progress = Math.min(1, state.fadeElapsedMs / CREATED_FADE_MS);
  const message = progress < 0.5 ? colors.green('Slot created') : colors.dim('Slot created');
  const detail = cols >= 60
    ? 'Ads will start appearing in your app.'
    : 'Ads will start appearing.';

  const top = Math.max(0, Math.floor((rows - 3) / 2));
  const lines: string[] = [];
  lines.push(...Array.from({ length: top }, () => ''));
  lines.push(centerWithin(message, cols));
  lines.push(centerWithin(colors.dim(detail), cols));
  return lines;
}

/** A rectangle anchored at the press, normalised so width and height are positive. */
export function boxFromDrag(
  anchor: { col: number; row: number },
  pointer: { col: number; row: number },
): AdBox {
  return {
    left: Math.min(anchor.col, pointer.col),
    top: Math.min(anchor.row, pointer.row),
    width: Math.abs(pointer.col - anchor.col) + 1,
    height: Math.abs(pointer.row - anchor.row) + 1,
  };
}

export function createInitialState(metrics: PanelMetrics): OverlayState {
  return {
    mode: 'home',
    metrics,
    anchor: null,
    pointer: null,
    fadeElapsedMs: 0,
    ownedRows: { first: 0, last: PANEL_HEIGHT - 1 },
  };
}

/**
 * Advance the overlay by one input or clock event.
 *
 * The whole interaction is here rather than in `overlay.ts` so that the
 * sequence a user actually performs — press Add slot, click, drag, release,
 * watch the confirmation fade, press Add slot again — is assertable in a test
 * without a pty. `overlay.ts` does nothing but translate this into escape
 * sequences and call the one effect it returns.
 */
export function reduce(
  state: OverlayState,
  event: OverlayEvent,
  ctx: { panelTop: number; cols: number; rows: number },
): { state: OverlayState; effect: OverlayEffect | null } {
  switch (event.kind) {
    case 'press': {
      if (state.mode === 'home') {
        if (hitsClose(event.col, event.row, ctx.panelTop, ctx.cols)) {
          return { state, effect: { kind: 'close' } };
        }
        if (hitsAddSlot(event.col, event.row, ctx.panelTop, ctx.cols)) {
          return {
            state: { ...state, mode: 'placing', anchor: null, pointer: null },
            effect: null,
          };
        }
        return { state, effect: null };
      }
      if (state.mode === 'placing') {
        // The click that starts the drag also dismisses the scrim: the user
        // said the grey should vanish here, and a click anywhere is a
        // deliberate act.
        return {
          state: {
            ...state,
            mode: 'dragging',
            anchor: { col: event.col, row: event.row },
            pointer: { col: event.col, row: event.row },
          },
          effect: null,
        };
      }
      return { state, effect: null };
    }

    case 'motion': {
      if (state.mode !== 'dragging') return { state, effect: null };
      return { state: { ...state, pointer: { col: event.col, row: event.row } }, effect: null };
    }

    case 'release': {
      if (state.mode !== 'dragging' || !state.anchor) return { state, effect: null };
      const pointer = { col: event.col, row: event.row };
      return {
        state: {
          ...state,
          mode: 'created',
          pointer,
          fadeElapsedMs: 0,
          metrics: { ...state.metrics, slotCount: state.metrics.slotCount + 1 },
        },
        effect: { kind: 'createSlot', box: boxFromDrag(state.anchor, pointer) },
      };
    }

    case 'tick': {
      if (state.mode !== 'created') return { state, effect: null };
      const fadeElapsedMs = state.fadeElapsedMs + event.elapsedMs;
      if (fadeElapsedMs < CREATED_FADE_MS) {
        return { state: { ...state, fadeElapsedMs }, effect: null };
      }
      return {
        state: {
          ...state,
          mode: 'home',
          fadeElapsedMs: 0,
          anchor: null,
          pointer: null,
        },
        effect: null,
      };
    }

    case 'escape': {
      if (state.mode === 'home') return { state, effect: { kind: 'close' } };
      return {
        state: { ...state, mode: 'home', anchor: null, pointer: null, fadeElapsedMs: 0 },
        effect: null,
      };
    }

    default:
      return { state, effect: null };
  }
}