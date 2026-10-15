/**
 * Reading the mouse out of a terminal.
 *
 * Two separate problems live here, and both have bitten this CLI's authors
 * before, so neither is treated as obvious.
 *
 * The first is that a terminal has no pointer. What it has is escape sequences
 * that a program asks for and the terminal then emits on stdin as if the user
 * had typed them. We ask for SGR encoding (mode 1006), which is the only
 * encoding that survives a column count past 223 — the older formats pack
 * coordinates into a single byte and therefore cannot address the right-hand
 * side of a modern terminal at all.
 *
 * The second is that we only asked for button-event tracking (mode 1002), not
 * any-event tracking (1003). That is deliberate: 1002 reports motion only while
 * a button is held, which is exactly the drag this overlay implements. 1003
 * would additionally report every mouse movement across the whole terminal,
 * including the movements that happen while the user is typing a command and
 * has no idea a program is even listening.
 */

/**
 * A decoded pointer report.
 *
 * `col` and `row` are 0-based, converted from the 1-based values the protocol
 * specifies, because every other coordinate in this overlay is 0-based and a
 * mixed convention produces off-by-one bugs only on the first row or column.
 */
export interface MouseEvent {
  type: 'press' | 'release' | 'motion';
  /** 0 left, 1 middle, 2 right. Motion reports carry 32 as the low bits of a drag. */
  button: number;
  col: number;
  row: number;
}

/** Turn tracking on: button presses, drags, in an encoding that scales. */
export const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';

/**
 * Turn tracking off, in the reverse order it was enabled.
 *
 * This runs on every exit path — including the one where the user pressed
 * Ctrl+C — because a terminal left in mouse-reporting mode prints escape
 * garbage at the shell prompt forever, and the user blames the shell.
 */
export const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

/** The callback bit for a button state change in the SGR `Cb` field. */
const MOTION_BIT = 32;

/**
 * Length of the control sequence starting at `buffer[start]`, if it is complete.
 *
 * Returns `'incomplete'` when the sequence has been started but not finished,
 * which is the common case: stdin delivers arbitrary chunks, and an escape
 * sequence can straddle two of them. Guessing here — flushing a half-read
 * sequence, or treating the `\x1b` as a bare Escape keypress — is how a click
 * silently becomes a "close the overlay" no matter where the user clicked.
 */
function controlSequenceAt(buffer: string, start: number): number | 'incomplete' | null {
  if (buffer[start] !== '\x1b' || buffer[start + 1] !== '[') return null;
  for (let index = start + 2; index < buffer.length; index += 1) {
    const code = buffer.charCodeAt(index);
    // Final bytes of a CSI sequence run 0x40-0x7E; everything between the
    // introducer and the final byte is a parameter or an intermediate.
    if (code >= 0x40 && code <= 0x7e) return index - start + 1;
  }
  return 'incomplete';
}

/**
 * Pull every complete mouse report out of `buffer`.
 *
 * Returns the reports it found and whatever it did not consume. Everything
 * else — a cursor-position reply, a keypress, half a sequence that has not
 * arrived yet — is handed back untouched, because stdin is one stream shared by
 * every input source and this function has no business discarding what it does
 * not recognise.
 *
 * Keeping the remainder is also what makes the buffer safe to keep appending
 * to across chunks: `parseMouseReports(parser.push(chunk))` is not how to use
 * it, but `pending += chunk; const { events, rest } = parseMouseReports(pending); pending = rest;`
 * is, and that is the shape the tests cover.
 */
export function parseMouseReports(buffer: string): { events: MouseEvent[]; rest: string } {
  const events: MouseEvent[] = [];
  let rest = '';
  let index = 0;

  while (index < buffer.length) {
    const length = controlSequenceAt(buffer, index);

    if (length === 'incomplete') {
      rest += buffer.slice(index);
      break;
    }

    if (length === null) {
      rest += buffer[index];
      index += 1;
      continue;
    }

    const sequence = buffer.slice(index, index + length);
    const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence);
    if (match) {
      const code = Number.parseInt(match[1]!, 10);
      const rawCol = Number.parseInt(match[2]!, 10);
      const rawRow = Number.parseInt(match[3]!, 10);
      events.push({
        type: match[4] === 'm' ? 'release' : (code & MOTION_BIT) !== 0 ? 'motion' : 'press',
        button: code & 3,
        col: Math.max(0, rawCol - 1),
        row: Math.max(0, rawRow - 1),
      });
    } else {
      rest += sequence;
    }
    index += length;
  }

  return { events, rest };
}
