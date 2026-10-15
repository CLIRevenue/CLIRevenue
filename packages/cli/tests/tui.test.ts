import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CELL_HEIGHT,
  CELL_METRIC,
  CELL_WIDTH,
  cellSizeLimits,
  clampCellBox,
  cellsToPixels,
  enforceCellMinimum,
  isDegenerate,
  pixelContainerFor,
  pixelsToCells,
} from '../src/tui/cells.js';
import {
  centerWithin,
  cursorPositionRequest,
  eraseLine,
  moveUp,
  parseCursorPosition,
  stringWidth,
  stripAnsi,
  truncateToWidth,
} from '../src/tui/ansi.js';
import { DISABLE_MOUSE, ENABLE_MOUSE, parseMouseReports } from '../src/tui/mouse.js';
import {
  CREATED_FADE_MS,
  PANEL_HEIGHT,
  PLACE_INSTRUCTION_TEXT,
  boxFromDrag,
  createInitialState,
  eraseBoxOutline,
  formatCount,
  formatMilliCents,
  hitsAddSlot,
  hitsClose,
  planPanel,
  reduce,
  renderBoxOutline,
  renderCreated,
  renderPanel,
  renderScrim,
  type OverlayState,
  type PanelMetrics,
} from '../src/tui/panel.js';
import { AD_SIZE_LIMITS } from '../src/project/geometry.js';

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-tui-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

const METRICS: PanelMetrics = {
  fullName: 'Ada Lovelace',
  publisherName: 'Untitled publisher',
  adsSeen: 12345,
  earningsMilliCents: 1_234_560,
  slotCount: 2,
};

/* ------------------------------------------------------------------ *
 * cells.ts -- terminal cells in, CSS pixels out
 * ------------------------------------------------------------------ */

describe('tui/cells', () => {
  it('derives its limits from AD_SIZE_LIMITS rather than choosing them', () => {
    const limits = cellSizeLimits();
    // Every one of these is a restatement of a pixel limit, so a change to
    // AD_SIZE_LIMITS alone cannot leave the two representations disagreeing.
    expect(limits.minWidth).toBe(Math.max(2, Math.ceil(AD_SIZE_LIMITS.minWidth / CELL_WIDTH)));
    expect(limits.maxWidth).toBeLessThanOrEqual(AD_SIZE_LIMITS.maxWidth / CELL_WIDTH);
    expect(limits.maxHeight).toBeLessThanOrEqual(AD_SIZE_LIMITS.maxHeight / CELL_HEIGHT);
    expect(limits.minWidth).toBeGreaterThan(0);
    expect(limits.minHeight).toBeGreaterThan(0);
  });

  it('keeps the two representations of the same limit in step', () => {
    // If these ever drift apart the overlay can save a slot the SDK rejects,
    // and the failure only surfaces in a browser at runtime.
    const limits = cellSizeLimits();
    expect(limits.minWidth * CELL_WIDTH).toBeGreaterThanOrEqual(AD_SIZE_LIMITS.minWidth);
    expect(limits.maxWidth * CELL_WIDTH).toBeLessThanOrEqual(AD_SIZE_LIMITS.maxWidth);
  });

  it('turns a viewport into a pixel container', () => {
    expect(pixelContainerFor(80, 24)).toEqual({ width: 640, height: 384 });
  });

  it('never produces a zero-sized container from a degenerate viewport', () => {
    expect(pixelContainerFor(0, 0)).toEqual({ width: CELL_WIDTH, height: CELL_HEIGHT });
    expect(pixelContainerFor(-5, -5)).toEqual({ width: CELL_WIDTH, height: CELL_HEIGHT });
  });

  it('scales a box from cells to pixels', () => {
    expect(cellsToPixels({ left: 2, top: 3, width: 4, height: 5 })).toEqual({
      left: 16,
      top: 48,
      width: 32,
      height: 80,
    });
  });

  it('floors the origin outward and never reports a sub-cell size', () => {
    // Two different rules on purpose. The origin floors, so the preview never
    // shows an ad starting to the right of where the user drew it. The size
    // rounds to nearest -- flooring a size would quietly shrink every ad by
    // up to a cell -- with a floor of 1 so a converted box is never zero.
    const cells = pixelsToCells({ left: 7, top: 15, width: 20, height: 20 });
    expect(cells.left).toBe(Math.floor(7 / CELL_WIDTH));
    expect(cells.top).toBe(Math.floor(15 / CELL_HEIGHT));
    expect(cells.width).toBe(Math.max(1, Math.round(20 / CELL_WIDTH)));
    expect(cells.height).toBe(Math.max(1, Math.round(20 / CELL_HEIGHT)));
    expect(cells.width).toBeGreaterThanOrEqual(1);
    expect(cells.height).toBeGreaterThanOrEqual(1);
  });

  it('never rounds an origin inward', () => {
    // Every origin below the next cell boundary must land on the cell above it,
    // not on the next one.
    for (let left = 0; left < CELL_WIDTH; left += 1) {
      expect(pixelsToCells({ left, top: 0, width: CELL_WIDTH, height: CELL_HEIGHT }).left).toBe(0);
    }
  });

  it('round-trips a cell box without losing a cell', () => {
    const box = { left: 10, top: 5, width: 20, height: 8 };
    expect(pixelsToCells(cellsToPixels(box))).toEqual(box);
  });

  it('clamps a box to the space actually available', () => {
    const limits = cellSizeLimits();
    const wide = clampCellBox(
      { left: 0, top: 0, width: 5000, height: 5000 },
      { cols: 40, rows: 20 },
    );
    expect(wide.width).toBeLessThanOrEqual(40);
    expect(wide.height).toBeLessThanOrEqual(20);
    expect(wide.left).toBe(0);
    expect(wide.top).toBe(0);

    const narrow = clampCellBox(
      { left: 100, top: 100, width: 10, height: 10 },
      { cols: 30, rows: 12 },
    );
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(30);
    expect(narrow.top + narrow.height).toBeLessThanOrEqual(12);
    expect(wide.width).toBeLessThanOrEqual(limits.maxWidth);
  });

  it('leaves a click-without-drag degenerate rather than inventing an ad', () => {
    const collapsed = clampCellBox({ left: 5, top: 5, width: 0, height: 0 }, { cols: 80, rows: 24 });
    expect(isDegenerate(collapsed)).toBe(true);
    expect(collapsed.width).toBe(0);
    expect(collapsed.height).toBe(0);
  });

  it('grows a too-small box from its top-left corner', () => {
    const limits = cellSizeLimits();
    const grown = enforceCellMinimum({ left: 5, top: 7, width: 1, height: 1 });
    expect(grown.width).toBe(limits.minWidth);
    expect(grown.height).toBe(limits.minHeight);
    // The corner the user was looking at when they let go.
    expect(grown.left).toBe(5);
    expect(grown.top).toBe(7);
  });

  it('leaves an already-large box alone', () => {
    const box = { left: 1, top: 1, width: 60, height: 20 };
    expect(enforceCellMinimum(box)).toEqual(box);
  });

  it('exposes the metric it converts by', () => {
    expect(CELL_METRIC).toEqual({ width: CELL_WIDTH, height: CELL_HEIGHT });
  });
});

/* ------------------------------------------------------------------ *
 * ansi.ts -- measurement
 * ------------------------------------------------------------------ */

describe('tui/ansi', () => {
  it('measures plain ascii by column', () => {
    expect(stringWidth('abc')).toBe(3);
    expect(stringWidth('')).toBe(0);
  });

  it('measures styled text by what the user sees', () => {
    expect(stringWidth('\x1b[1mCLIRevenue\x1b[22m')).toBe('CLIRevenue'.length);
  });

  it('gives East Asian wide characters two cells', () => {
    // A test suite written in English passes a naive String.length centring and
    // then a customer with a CJK name gets a half-column-misaligned title.
    expect(stringWidth('日本語')).toBe(6);
    expect(stringWidth('こん')).toBe(4);
  });

  it('gives emoji two cells and combining marks none', () => {
    expect(stringWidth('🙂')).toBe(2);
    expect(stringWidth('é')).toBe(1);
  });

  it('truncates with an ellipsis and never exceeds the budget', () => {
    expect(truncateToWidth('abcdefgh', 5)).toBe('abcd…');
    expect(stringWidth(truncateToWidth('abcdefgh', 5))).toBe(5);
  });

  it('returns stripped text untouched when it already fits', () => {
    expect(truncateToWidth('\x1b[36mab\x1b[39m', 10)).toBe('ab');
  });

  it('handles a one-column budget without hanging', () => {
    expect(truncateToWidth('abcdef', 1)).toBe('…');
    expect(truncateToWidth('abcdef', 0)).toBe('');
  });

  it('centres with the odd column going right', () => {
    const line = centerWithin('ab', 6);
    expect(stringWidth(line)).toBe(6);
    expect(line).toBe('  ab  ');
  });

  it('centres a wide-character name to exactly the panel width', () => {
    const line = centerWithin('日本語', 10);
    expect(stringWidth(line)).toBe(10);
  });

  it('reads a cursor position report and converts it to 0-based', () => {
    expect(parseCursorPosition('\x1b[24;80R')).toEqual({ row: 23, col: 79 });
    expect(parseCursorPosition('noise\x1b[1;1R')).toEqual({ row: 0, col: 0 });
  });

  it('returns null for input that is not a cursor position report', () => {
    expect(parseCursorPosition('\x1b[<0;1;1M')).toBeNull();
    expect(parseCursorPosition('q')).toBeNull();
    expect(parseCursorPosition('')).toBeNull();
  });

  it('builds the requests and the primitives the overlay needs', () => {
    expect(cursorPositionRequest()).toBe('\x1b[6n');
    expect(moveUp(0)).toBe('');
    expect(moveUp(3)).toBe('\x1b[3A');
    expect(eraseLine().endsWith('\r')).toBe(true);
    expect(stripAnsi('\x1b[1m\x1b[36mx\x1b[0m')).toBe('x');
  });
});

/* ------------------------------------------------------------------ *
 * mouse.ts -- SGR reporting
 * ------------------------------------------------------------------ */

describe('tui/mouse', () => {
  it('decodes a left-button press with 0-based coordinates', () => {
    const { events, rest } = parseMouseReports('\x1b[<0;10;5M');
    expect(events).toEqual([{ type: 'press', button: 0, col: 9, row: 4 }]);
    expect(rest).toBe('');
  });

  it('distinguishes a release from a press by the final byte', () => {
    expect(parseMouseReports('\x1b[<0;10;5m').events[0]!.type).toBe('release');
  });

  it('decodes motion while a button is held', () => {
    expect(parseMouseReports('\x1b[<32;12;7M').events[0]).toEqual({
      type: 'motion',
      button: 0,
      col: 11,
      row: 6,
    });
  });

  it('keeps the button identity on a motion report', () => {
    // 33 = motion bit plus right button.
    expect(parseMouseReports('\x1b[<33;12;7M').events[0]!.button).toBe(1);
  });

  it('maps the top-left cell to 0 rather than -1', () => {
    expect(parseMouseReports('\x1b[<0;1;1M').events[0]).toEqual({
      type: 'press',
      button: 0,
      col: 0,
      row: 0,
    });
  });

  it('holds an incomplete sequence rather than flushing it', () => {
    // The failure this prevents: a click split across two stdin chunks reads
    // as a bare Escape, which closes the overlay no matter where you clicked.
    const first = parseMouseReports('\x1b[<0;1');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('\x1b[<0;1');
  });

  it('decodes a sequence that arrives in two chunks', () => {
    let pending = '\x1b[<0;1';
    let parsed = parseMouseReports(pending);
    pending = parsed.rest + '0;5M';
    parsed = parseMouseReports(pending);
    expect(parsed.events).toEqual([{ type: 'press', button: 0, col: 9, row: 4 }]);
    expect(parsed.rest).toBe('');
  });

  it('hands back every input it did not consume', () => {
    // stdin is one stream shared by every input source: keypresses and cursor
    // replies travel through here too, and discarding them would break typing.
    const { events, rest } = parseMouseReports('q\x1b[<0;1;1M\x1b[6n');
    expect(events).toHaveLength(1);
    expect(rest).toBe('q\x1b[6n');
  });

  it('decodes several reports in one chunk in order', () => {
    const { events } = parseMouseReports('\x1b[<0;1;1M\x1b[<0;5;3M\x1b[<0;5;3m');
    expect(events.map((e) => [e.type, e.col, e.row])).toEqual([
      ['press', 0, 0],
      ['press', 4, 2],
      ['release', 4, 2],
    ]);
  });

  it('asks for button-event tracking and a scalable encoding', () => {
    expect(ENABLE_MOUSE).toBe('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    // Reverse order on the way out, on every path including Ctrl+C.
    expect(DISABLE_MOUSE).toBe('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
  });
});

/* ------------------------------------------------------------------ *
 * panel.ts -- formatting and geometry
 * ------------------------------------------------------------------ */

describe('tui/panel formatting', () => {
  it('renders milli-cents as dollars', () => {
    // A dollar is 100,000 milli-cents. Getting this wrong by 1000x is the
    // failure mode that makes a working slot look like it earns nothing.
    expect(formatMilliCents(100_000)).toBe('$1.00');
    expect(formatMilliCents(123_456)).toBe('$1.23');
    // One milli-cent is $0.00001, which is below the two-decimal floor, so it
    // falls into the four-decimal branch. `$0.0000` is the honest answer here:
    // there is no money yet, not a rounding error.
    expect(formatMilliCents(1)).toBe('$0.0000');
    expect(formatMilliCents(0)).toBe('$0.00');
  });

  it('separates thousands on the integer part only', () => {
    // 1,234,567,890 milli-cents is $12,345.6789, which is $12,345.68 rounded.
    expect(formatMilliCents(1_234_567_890)).toBe('$12,345.68');
    expect(formatMilliCents(100_000_000)).toBe('$1,000.00');
  });

  it('shows four decimals below a cent rather than rounding to nothing', () => {
    // A single impression is worth four decimal places of a cent. Showing
    // $0.00 would tell a publisher with a working slot they have earned
    // nothing.
    expect(formatMilliCents(10)).toBe('$0.0001');
    expect(formatMilliCents(500)).toBe('$0.0050');
  });

  it('treats nonsense money as zero instead of printing NaN', () => {
    expect(formatMilliCents(Number.NaN)).toBe('$0.00');
    expect(formatMilliCents(-100)).toBe('$0.00');
    expect(formatMilliCents(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });

  it('formats counts and never returns a placeholder', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1_234_567)).toBe('1,234,567');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(9.7)).toBe('9');
  });
});

describe('tui/panel layout', () => {
  it('sizes the panel to the terminal but keeps it readable', () => {
    expect(planPanel(80).width).toBe(72);
    expect(planPanel(200).width).toBe(72);
    // Too narrow to be honest about: the minimum keeps the buttons addressable.
    expect(planPanel(30).width).toBe(40);
    expect(planPanel(80).height).toBe(PANEL_HEIGHT);
  });

  it('puts both buttons on the button row, side by side, centred', () => {
    const layout = planPanel(80);
    expect(layout.addSlot.row).toBe(layout.close.row);
    expect(layout.close.left).toBeGreaterThan(layout.addSlot.left);
    expect(layout.close.left - (layout.addSlot.left + layout.addSlot.width)).toBeGreaterThan(0);
  });

  it('hits Add slot only inside its own bounds', () => {
    const { addSlot } = planPanel(80);
    const top = 13;
    expect(hitsAddSlot(addSlot.left, top + addSlot.row, top, 80)).toBe(true);
    expect(hitsAddSlot(addSlot.left + addSlot.width - 1, top + addSlot.row, top, 80)).toBe(true);
    expect(hitsAddSlot(addSlot.left - 1, top + addSlot.row, top, 80)).toBe(false);
    expect(hitsAddSlot(addSlot.left + addSlot.width, top + addSlot.row, top, 80)).toBe(false);
    expect(hitsAddSlot(addSlot.left, top + addSlot.row + 1, top, 80)).toBe(false);
  });

  it('hits Close only inside its own bounds', () => {
    const { close } = planPanel(80);
    const top = 13;
    expect(hitsClose(close.left, top + close.row, top, 80)).toBe(true);
    expect(hitsClose(close.left - 1, top + close.row, top, 80)).toBe(false);
    expect(hitsClose(close.left + close.width, top + close.row, top, 80)).toBe(false);
  });

  it('does not let one button answer for the other', () => {
    const { addSlot, close } = planPanel(80);
    // The two hit areas are disjoint. A click anywhere on Close must not open
    // the placement mode, or the one button a user reaches for to get out
    // would instead start the flow they were trying to avoid.
    expect(addSlot.left + addSlot.width).toBeLessThanOrEqual(close.left);
    expect(close.left + close.width).toBeGreaterThan(addSlot.left + addSlot.width - 1);
    expect(hitsAddSlot(close.left, close.row, 0, 80)).toBe(false);
    expect(hitsClose(addSlot.left, addSlot.row, 0, 80)).toBe(false);
    expect(hitsClose(close.left + close.width - 1, close.row, 0, 80)).toBe(true);
    expect(hitsAddSlot(addSlot.left + addSlot.width - 1, addSlot.row, 0, 80)).toBe(true);
  });

  it('ignores a button press above or below the button row', () => {
    const { addSlot } = planPanel(80);
    expect(hitsAddSlot(addSlot.left, addSlot.row - 1, 0, 80)).toBe(false);
    expect(hitsAddSlot(addSlot.left, addSlot.row + 1, 0, 80)).toBe(false);
  });

  it('anchors the hit test to the panel, not to the viewport', () => {
    // Same cell row, different panel position: the button moves with the
    // panel, which is the whole reason the overlay scrolls instead of painting
    // over output it does not own.
    const { addSlot } = planPanel(80);
    const row = addSlot.row;
    expect(hitsAddSlot(addSlot.left, row, 0, 80)).toBe(true);
    expect(hitsAddSlot(addSlot.left, row, 7, 80)).toBe(false);
    expect(hitsAddSlot(addSlot.left, row + 7, 7, 80)).toBe(true);
  });
});

describe('tui/panel rendering', () => {
  const state = createInitialState(METRICS);

  it('draws exactly PANEL_HEIGHT lines, every one the planned width', () => {
    const lines = renderPanel(state, 80);
    expect(lines).toHaveLength(PANEL_HEIGHT);
    for (const line of lines) {
      expect(stringWidth(line)).toBe(planPanel(80).width);
    }
  });

  it('shows the title, the name, the two metrics and the slot count', () => {
    const lines = renderPanel(state, 80).map(stripAnsi);
    expect(lines[2]).toContain('CLIRevenue');
    expect(lines[4]).toContain('Ada Lovelace');
    expect(lines[6]).toContain('Ads seen');
    expect(lines[6]).toContain('12,345');
    expect(lines[7]).toContain('Earned');
    expect(lines[7]).toContain('$12.35');
    expect(lines[8]).toContain('Slots');
  });

  it('falls back to the publisher name when there is no full name', () => {
    const lines = renderPanel(
      createInitialState({ ...METRICS, fullName: null }),
      80,
    ).map(stripAnsi);
    expect(lines[4]).toContain('Untitled publisher');
  });

  it('offers both buttons on the button row', () => {
    const line = stripAnsi(renderPanel(state, 80)[10]!);
    expect(line).toContain('Add slot');
    expect(line).toContain('Close');
  });

  it('never exceeds the terminal width on a narrow one', () => {
    for (const line of renderPanel(state, 44)) {
      expect(stringWidth(line)).toBeLessThanOrEqual(44);
    }
  });

  it('truncates a very long name rather than overflowing the panel', () => {
    const long = renderPanel(
      createInitialState({ ...METRICS, fullName: 'x'.repeat(200) }),
      80,
    ).map(stripAnsi);
    for (const line of long) {
      expect(stringWidth(line)).toBe(planPanel(80).width);
    }
    expect(long[4]).not.toContain('x'.repeat(200));
  });

  it('covers the viewport with the scrim and puts the instruction on top', () => {
    const lines = renderScrim(80, 24);
    expect(lines).toHaveLength(24);
    expect(stringWidth(stripAnsi(lines[0]!))).toBe(80);
    expect(stripAnsi(lines[0]!)).toContain(PLACE_INSTRUCTION_TEXT);
    for (const line of lines) {
      expect(stringWidth(stripAnsi(line))).toBe(80);
    }
  });

  it('draws a drag outline as positioned runs, not whole lines', () => {
    const runs = renderBoxOutline({ left: 2, top: 3, width: 5, height: 4 });
    // top border, two middle rows at two columns each, bottom border.
    expect(runs).toHaveLength(1 + 4 + 1);
    expect(runs[0]!.row).toBe(3);
    expect(runs[0]!.col).toBe(2);
    expect(runs[runs.length - 1]!.row).toBe(6);
    expect(new Set(runs.map((r) => r.row)).size).toBe(4);
  });

  it('collapses a one-row box to a single horizontal rule', () => {
    const runs = renderBoxOutline({ left: 4, top: 9, width: 8, height: 1 });
    expect(runs).toHaveLength(1);
    expect(stripAnsi(runs[0]!.text)).toBe('─'.repeat(8));
  });

  it('draws nothing for a box with no area', () => {
    expect(renderBoxOutline({ left: 1, top: 1, width: 0, height: 5 })).toEqual([]);
    expect(renderBoxOutline({ left: 1, top: 1, width: 5, height: 0 })).toEqual([]);
  });

  it('blanks exactly the cells it drew, so an erase cannot leave debris', () => {
    const box = { left: 2, top: 3, width: 5, height: 4 };
    const drawn = renderBoxOutline(box);
    const erased = eraseBoxOutline(box);
    expect(erased).toHaveLength(drawn.length);
    for (const [i, run] of drawn.entries()) {
      expect(erased[i]!.row).toBe(run.row);
      expect(erased[i]!.col).toBe(run.col);
      expect(erased[i]!.text).toBe(' '.repeat(stringWidth(run.text)));
    }
  });

  it('confirms the slot and then fades the confirmation away', () => {
    const fresh: OverlayState = { ...state, mode: 'created', fadeElapsedMs: 0 };
    const faded: OverlayState = { ...state, mode: 'created', fadeElapsedMs: CREATED_FADE_MS };

    const freshLines = renderCreated(fresh, 80, 24).map(stripAnsi);
    const fadedLines = renderCreated(faded, 80, 24).map(stripAnsi);
    expect(freshLines.join('\n')).toContain('Slot created');
    expect(fadedLines.join('\n')).toContain('Slot created');
    /* A fade changes styling, never wording: a publisher who reads the
       confirmation at either end of it reads the same sentence. The style
       change itself is deliberately NOT asserted here -- picocolors disables
       itself when stdout is not a TTY, so in vitest `colors.green(x)` and
       `colors.dim(x)` are the same string and any such assertion would be
       testing the test runner's terminal, not this code. */
    expect(fadedLines).toEqual(freshLines);
  });

  it('centres the confirmation within the terminal width', () => {
    for (const cols of [50, 80, 120]) {
      const lines = renderCreated({ ...state, mode: 'created' }, cols, 24).map(stripAnsi);
      const message = lines.find((line) => line.includes('Slot created'));
      expect(message).toBeDefined();
      expect(stringWidth(message ?? '')).toBeLessThanOrEqual(cols);
      const leading = (message ?? '').length - (message ?? '').trimStart().length;
      expect(leading).toBe(Math.max(0, Math.floor((cols - 'Slot created'.length) / 2)));
    }
  });

  it('shortens the confirmation detail on a narrow terminal', () => {
    const narrow = renderCreated({ ...state, mode: 'created' }, 50, 24).map(stripAnsi);
    expect(narrow.join('\n')).toContain('Slot created');
    expect(stringWidth(narrow[0] ?? '')).toBeLessThanOrEqual(50);
  });
});

describe('tui/panel drag geometry', () => {
  it('normalises a drag that goes up and to the left', () => {
    expect(boxFromDrag({ col: 10, row: 10 }, { col: 4, row: 6 })).toEqual({
      left: 4,
      top: 6,
      width: 7,
      height: 5,
    });
  });

  it('normalises a drag that goes down and to the right', () => {
    expect(boxFromDrag({ col: 4, row: 6 }, { col: 10, row: 10 })).toEqual({
      left: 4,
      top: 6,
      width: 7,
      height: 5,
    });
  });

  it('gives a click without a drag a one-cell box, not a zero-area one', () => {
    expect(boxFromDrag({ col: 7, row: 7 }, { col: 7, row: 7 })).toEqual({
      left: 7,
      top: 7,
      width: 1,
      height: 1,
    });
  });
});

/* ------------------------------------------------------------------ *
 * panel.ts -- the interaction, as a pure reducer
 * ------------------------------------------------------------------ */

describe('tui/panel reduce', () => {
  const CTX = { panelTop: 13, cols: 80, rows: 24 };

  function press(col: number, row: number) {
    return { kind: 'press' as const, col, row };
  }
  function motion(col: number, row: number) {
    return { kind: 'motion' as const, col, row };
  }
  function release(col: number, row: number) {
    return { kind: 'release' as const, col, row };
  }

  const addSlotPress = press(planPanel(80).addSlot.left, CTX.panelTop + planPanel(80).addSlot.row);
  const closePress = press(planPanel(80).close.left, CTX.panelTop + planPanel(80).close.row);

  /* One complete placement, shared by every test that needs a panel that has
     already produced a slot. Written once so the sequence cannot drift between
     tests that each re-invent it. */
  const PLACE_EVENTS = [
    addSlotPress,
    press(10, 6),
    motion(30, 12),
    motion(50, 18),
    release(50, 18),
  ];

  it('starts in the home panel carrying the backend metrics', () => {
    const state = createInitialState(METRICS);
    expect(state.mode).toBe('home');
    expect(state.anchor).toBeNull();
    expect(state.metrics.slotCount).toBe(2);
  });

  it('ignores a press on empty panel space', () => {
    const before = createInitialState(METRICS);
    const { state, effect } = reduce(before, press(1, CTX.panelTop), CTX);
    expect(state).toBe(before);
    expect(effect).toBeNull();
  });

  it('closes when Close is pressed', () => {
    const { effect } = reduce(createInitialState(METRICS), closePress, CTX);
    expect(effect).toEqual({ kind: 'close' });
  });

  it('shows the scrim when Add slot is pressed', () => {
    const { state, effect } = reduce(createInitialState(METRICS), addSlotPress, CTX);
    expect(state.mode).toBe('placing');
    expect(effect).toBeNull();
  });

  it('starts the drag on the very click that dismisses the scrim', () => {
    // The user asked for the grey to vanish the instant they click, so the
    // first click both dismisses it and anchors the rectangle.
    const placing = reduce(createInitialState(METRICS), addSlotPress, CTX).state;
    const { state } = reduce(placing, press(20, 15), CTX);
    expect(state.mode).toBe('dragging');
    expect(state.anchor).toEqual({ col: 20, row: 15 });
    expect(state.pointer).toEqual({ col: 20, row: 15 });
  });

  it('tracks the pointer while dragging', () => {
    let state = reduce(createInitialState(METRICS), addSlotPress, CTX).state;
    state = reduce(state, press(20, 15), CTX).state;
    state = reduce(state, motion(35, 18), CTX).state;
    expect(state.pointer).toEqual({ col: 35, row: 18 });
    // The anchor must not follow the pointer or the rectangle has no origin.
    expect(state.anchor).toEqual({ col: 20, row: 15 });
  });

  it('ignores motion when no button is down', () => {
    const before = createInitialState(METRICS);
    const { state } = reduce(before, motion(35, 18), CTX);
    expect(state).toBe(before);
  });

  it('writes the slot on release and counts it immediately', () => {
    let state = reduce(createInitialState(METRICS), addSlotPress, CTX).state;
    state = reduce(state, press(20, 15), CTX).state;
    state = reduce(state, motion(35, 18), CTX).state;
    const { state: created, effect } = reduce(state, release(35, 18), CTX);

    expect(effect).toEqual({ kind: 'createSlot', box: { left: 20, top: 15, width: 16, height: 4 } });
    expect(created.mode).toBe('created');
    expect(created.fadeElapsedMs).toBe(0);
    // The count the user watches has to move the instant the slot exists.
    expect(created.metrics.slotCount).toBe(3);
  });

  it('ignores a release that was never preceded by a press', () => {
    const before = createInitialState(METRICS);
    const { state, effect } = reduce(before, release(35, 18), CTX);
    expect(state).toBe(before);
    expect(effect).toBeNull();
  });

  it('holds the confirmation then returns to the panel', () => {
    // Driven through a real placement, not a fabricated `created` state: the
    // counter increment happens on release, so a hand-built state would leave
    // the slot uncounted and the assertion below would be testing fiction.
    let placed = createInitialState(METRICS);
    for (const event of PLACE_EVENTS) {
      placed = reduce(placed, event, CTX).state;
    }
    expect(placed.mode).toBe('created');
    expect(placed.metrics.slotCount).toBe(METRICS.slotCount + 1);

    const held = reduce(placed, { kind: 'tick', elapsedMs: CREATED_FADE_MS - 1 }, CTX);
    expect(held.state.mode).toBe('created');
    expect(held.state.fadeElapsedMs).toBe(CREATED_FADE_MS - 1);

    const done = reduce(held.state, { kind: 'tick', elapsedMs: 1 }, CTX);
    expect(done.state.mode).toBe('home');
    expect(done.state.fadeElapsedMs).toBe(0);
    expect(done.state.anchor).toBeNull();
    // The slot stays counted after the confirmation fades.
    expect(done.state.metrics.slotCount).toBe(METRICS.slotCount + 1);
  });

  it('ignores a tick in any mode but the confirmation', () => {
    const before = createInitialState(METRICS);
    const { state } = reduce(before, { kind: 'tick', elapsedMs: 5_000 }, CTX);
    expect(state).toBe(before);
  });

  it('closes on Escape from the panel', () => {
    const { effect } = reduce(createInitialState(METRICS), { kind: 'escape' }, CTX);
    expect(effect).toEqual({ kind: 'close' });
  });

  it('aborts back to the panel on Escape mid-drag, without writing a slot', () => {
    let state = reduce(createInitialState(METRICS), addSlotPress, CTX).state;
    state = reduce(state, press(20, 15), CTX).state;
    state = reduce(state, motion(35, 18), CTX).state;
    const { state: aborted, effect } = reduce(state, { kind: 'escape' }, CTX);
    expect(aborted.mode).toBe('home');
    expect(aborted.anchor).toBeNull();
    expect(aborted.metrics.slotCount).toBe(METRICS.slotCount);
    expect(effect).toBeNull();
  });

  it('runs the whole flow twice without leaking state', () => {
    let state = createInitialState(METRICS);

    for (let round = 0; round < 2; round += 1) {
      state = reduce(state, addSlotPress, CTX).state;
      state = reduce(state, press(10 + round, 8), CTX).state;
      state = reduce(state, motion(30 + round, 12), CTX).state;
      state = reduce(state, release(30 + round, 12), CTX).state;
      expect(state.mode).toBe('created');
      state = reduce(state, { kind: 'tick', elapsedMs: CREATED_FADE_MS }, CTX).state;
      expect(state.mode).toBe('home');
    }

    expect(state.metrics.slotCount).toBe(METRICS.slotCount + 2);
  });

  it('keeps the metrics it was given rather than inventing new ones', () => {
    const state = createInitialState(METRICS);
    expect(state.metrics.fullName).toBe('Ada Lovelace');
    expect(state.metrics.adsSeen).toBe(12345);
    expect(state.metrics.earningsMilliCents).toBe(1_234_560);
  });
});

/* ------------------------------------------------------------------ *
 * The command: overlay.ts wires the panel to disk
 * ------------------------------------------------------------------ */

describe('commands/overlay', () => {
  const KEY = `clirevenue_ads_${'A1b2C3d4E5f6G7h8I9j0KlMnOpQrSt'}`;

  function project(): string {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    return root;
  }

  const created = async () => ({
    id: 'pl_1',
    key: 'home',
    name: 'Home',
    enabled: true,
    allowedAudienceId: null,
    created: true,
    publisherId: 'pub_1',
  });

  /**
   * The one network round trip the command makes, stubbed through the `verify`
   * seam rather than by mocking the module: the dependency is declared in
   * `OverlayOptions`, so the test says out loud that it is not making a call.
   */
  const verified = async () => ({
    publisherId: 'pub_1',
    placements: [{ id: 'pl_1', key: 'home', name: 'Home', enabled: true, allowedAudienceId: null }],
    fullName: 'Ada Lovelace',
    publisherName: 'Untitled publisher',
    adsSeen: 12_345,
    earningsMilliCents: 1_234_560,
    slotCount: 1,
  });

  it('turns a dragged box into exactly one config slot and nothing else', async () => {
    const { overlay } = await import('../src/commands/overlay.js');
    const { listRenderableSlots } = await import('../src/project/config.js');
    const root = project();
    const lines: string[] = [];

    const result = await overlay({
      cwd: root,
      write: (line) => lines.push(line),
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      create: created,
      verify: verified,
      run: async (options) => {
        options.save({ left: 10, top: 6, width: 20, height: 4 }, { cols: 80, rows: 24 });
        return { created: 1 };
      },
    });

    expect(result).toEqual({ placementKey: 'home', created: 1 });
    // `seedSlot: false` is the point: a seeded 320x100 default next to the
    // one the user drew would be an ad they never asked for.
    expect(listRenderableSlots(root)).toHaveLength(1);
    expect(lines.join('')).toContain('Added 1 slot');
  });

  it('saves a layout that resolves back to the box the user drew', async () => {
    const { overlay } = await import('../src/commands/overlay.js');
    const { listRenderableSlots } = await import('../src/project/config.js');
    const { resolveAdBox } = await import('../src/project/geometry.js');
    const { CELL_WIDTH, CELL_HEIGHT } = await import('../src/tui/cells.js');
    const root = project();

    await overlay({
      cwd: root,
      write: () => undefined,
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      create: created,
      verify: verified,
      run: async (options) => {
        options.save({ left: 10, top: 6, width: 20, height: 4 }, { cols: 80, rows: 24 });
        return { created: 1 };
      },
    });

    const { slot } = listRenderableSlots(root)[0]!;
    const box = resolveAdBox(slot.layout, { width: 80 * CELL_WIDTH, height: 24 * CELL_HEIGHT });
    expect(box.left).toBe(10 * CELL_WIDTH);
    expect(box.top).toBe(6 * CELL_HEIGHT);
    expect(box.width).toBe(20 * CELL_WIDTH);
    expect(box.height).toBe(4 * CELL_HEIGHT);
  });

  it('keeps the slot proportional when the window it was drawn in grows', async () => {
    // "the slot goes small with the window": the layout is an anchor plus
    // offsets, so it re-resolves against whatever container the SDK renders in.
    const { overlay } = await import('../src/commands/overlay.js');
    const { listRenderableSlots } = await import('../src/project/config.js');
    const { resolveAdBox } = await import('../src/project/geometry.js');
    const { CELL_WIDTH, CELL_HEIGHT } = await import('../src/tui/cells.js');
    const root = project();

    await overlay({
      cwd: root,
      write: () => undefined,
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      create: created,
      verify: verified,
      run: async (options) => {
        options.save({ left: 0, top: 0, width: 20, height: 4 }, { cols: 80, rows: 24 });
        return { created: 1 };
      },
    });

    const { slot } = listRenderableSlots(root)[0]!;
    const narrow = resolveAdBox(slot.layout, { width: 80 * CELL_WIDTH, height: 24 * CELL_HEIGHT });
    const wide = resolveAdBox(slot.layout, { width: 160 * CELL_WIDTH, height: 24 * CELL_HEIGHT });
    expect(wide.width).toBe(narrow.width);
    expect(wide.height).toBe(narrow.height);
  });

  it('writes nothing and says so when the overlay is closed without placing', async () => {
    const { overlay } = await import('../src/commands/overlay.js');
    const { listRenderableSlots } = await import('../src/project/config.js');
    const root = project();
    const lines: string[] = [];

    const result = await overlay({
      cwd: root,
      write: (line) => lines.push(line),
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      create: created,
      verify: verified,
      run: async () => ({ created: 0 }),
    });

    expect(result).toBeNull();
    expect(listRenderableSlots(root)).toHaveLength(0);
    expect(lines.join('')).toContain('Nothing was changed');
  });

  it('refuses to run without a key, and says how to get one', async () => {
    const { overlay } = await import('../src/commands/overlay.js');
    const { EditorError } = await import('../src/editor/index.js');
    const root = project();

    // The actionable text lives in `hint`, not `message`: `index.ts` prints the
    // message as the error and the hint as the dimmed next step, so asserting on
    // the message alone would pass on a hint nobody ever sees.
    const failure = await overlay({ cwd: root, write: () => undefined, env: {} }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(EditorError);
    expect((failure as { hint?: string }).hint).toMatch(/clirevenue setup/);
    expect((failure as { hint?: string }).hint).toContain('.env.local');
  });

  it('turns an unverifiable key into an error pointing at setup', async () => {
    const { overlay } = await import('../src/commands/overlay.js');
    const { EditorError } = await import('../src/editor/index.js');
    const root = project();

    const failure = await overlay({
      cwd: root,
      write: () => undefined,
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      verify: async () => {
        throw new Error('revoked');
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EditorError);
    expect((failure as Error).message).toBe('revoked');
    expect((failure as { hint?: string }).hint).toMatch(/clirevenue setup/);
  });
});
