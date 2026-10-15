/**
 * The escape sequences this overlay needs, plus the one measurement every
 * centred line in the panel depends on.
 *
 * Everything here is a pure string builder except the cursor-position probe,
 * and even that only exposes the request and the parse — actually writing the
 * request and waiting for the reply is the caller's job, because that is I/O
 * and this module should stay testable without a terminal.
 *
 * Note what is deliberately absent: there is no alternate-screen helper. The
 * overlay is drawn over the user's existing CLI output, because that is what
 * was asked for — the running command stays visible behind it. The cost of
 * that choice is that every redraw must be precise about which rows it owns,
 * and `overlay.ts` is where that discipline lives.
 */

const ESC = '\x1b[';

/** Move the cursor to a 0-based row/column. */
export function cursorTo(row: number, col: number): string {
  return `${ESC}${row + 1};${col + 1}H`;
}

/** Move the cursor up `n` rows without changing the column. */
export function moveUp(n: number): string {
  return n > 0 ? `${ESC}${n}A` : '';
}

/** Move the cursor down `n` rows without changing the column. */
export function moveDown(n: number): string {
  return n > 0 ? `${ESC}${n}B` : '';
}

/** Column zero. Cheaper than an absolute move, and immune to line wrapping. */
export function carriageReturn(): string {
  return '\r';
}

/** Erase the whole current line, then leave the cursor at column zero. */
export function eraseLine(): string {
  return '\x1b[2K\r';
}

/** Erase from the cursor down to the bottom of the screen. */
export function eraseToEndOfScreen(): string {
  return `${ESC}J`;
}

/** Hide the cursor while something is drawing itself. */
export const HIDE_CURSOR = `${ESC}?25l`;

/** Show the cursor again. Must happen on every exit path, including a throw. */
export const SHOW_CURSOR = `${ESC}?25h`;

/**
 * Ask the terminal where the cursor is (DSR, Device Status Report).
 *
 * The reply arrives on stdin as `\x1b[<row>;<col>R`, which we find by reading
 * stdin until we see an `R`. That is the only way to learn which screen row the
 * panel actually starts on: mouse coordinates are absolute, the panel is
 * anchored to the bottom, and nothing else in the protocol reports the
 * difference. Terminals that do not answer are common enough (some CI pty
 * emulators, some multiplexers swallow the reply) that the caller must have a
 * fallback rather than waiting forever.
 */
export function cursorPositionRequest(): string {
  return `${ESC}6n`;
}

const CURSOR_POSITION_RE = /\x1b\[(\d+);(\d+)R/;

/**
 * Pull a cursor position out of a chunk of stdin.
 *
 * Returns null when the chunk holds no complete report, which is the normal
 * answer for every keystroke that is not a report and for a partial one split
 * across chunks. 1-based row/column in, 0-based out, because every other
 * function in this overlay addresses the screen in 0-based cells and a
 * conversion that lives in only one place cannot be forgotten in the other.
 */
export function parseCursorPosition(chunk: string): { row: number; col: number } | null {
  const match = CURSOR_POSITION_RE.exec(chunk);
  if (!match) return null;
  const row = Number.parseInt(match[1]!, 10);
  const col = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row: Math.max(0, row - 1), col: Math.max(0, col - 1) };
}

/**
 * Remove CSI escape sequences so a styled string can be measured.
 *
 * Measurement has to run on rendered text — `colors.bold('CLIRevenue')` is what
 * the panel actually draws — and `\x1b[1m` is nine columns of nothing a user
 * can see. Any function here that takes text that might already be styled
 * strips first, so callers cannot forget to.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * East Asian Wide and Fullwidth code points, plus emoji.
 *
 * A terminal gives these two cells. `String.length` gives them one, because
 * they are single UTF-16 code units (or, for the astral ones, a surrogate
 * pair). Centring a title without this gets it visibly wrong by half its
 * width — the defect only appears for users whose names contain CJK or emoji,
 * which is exactly the kind of bug that survives a test suite written in
 * English and then fails in front of a customer.
 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo initial
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, Kangxi, punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Kana through CJK compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK unified extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xa960 && codePoint <= 0xa97f) || // Hangul Jamo extended A
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical forms
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || // Emoji, pictographs, transport
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) || // Transport and map
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || // Supplemental symbols
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK extensions B and beyond
  );
}

/** Combining marks and the zero-width joiner occupy no cell of their own. */
function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x200d ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

/**
 * How many terminal columns a string occupies, ignoring any styling in it.
 *
 * Iterates code points rather than UTF-16 units so that astral characters (and
 * surrogate pairs in general) are counted once rather than twice.
 */
export function stringWidth(input: string): number {
  const plain = stripAnsi(input);
  let width = 0;
  for (const character of plain) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isZeroWidthCodePoint(codePoint)) continue;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

/** Truncate to a column budget, appending an ellipsis when something was lost. */
export function truncateToWidth(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(input) <= maxWidth) return stripAnsi(input);
  if (maxWidth === 1) return '…';

  let width = 0;
  let out = '';
  for (const character of stripAnsi(input)) {
    const charWidth = stringWidth(character);
    if (width + charWidth > maxWidth - 1) break;
    out += character;
    width += charWidth;
  }
  return `${out}…`;
}

/**
 * Centre a string inside a width, measured in display columns.
 *
 * Left over from an odd width goes to the right, which is what a terminal does
 * with its own centering and keeps successive rows aligned to the same gutter.
 */
export function centerWithin(input: string, width: number): string {
  const plain = truncateToWidth(input, width);
  const slack = width - stringWidth(plain);
  if (slack <= 0) return plain;
  const left = Math.floor(slack / 2);
  return ' '.repeat(left) + plain + ' '.repeat(slack - left);
}
