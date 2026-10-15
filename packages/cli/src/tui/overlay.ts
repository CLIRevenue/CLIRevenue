/**
 * The terminal I/O behind the `/clirevenue` overlay.
 *
 * Everything the user actually *does* lives in `panel.ts` as a pure reducer so
 * it can be tested without a pty. This file is the thin, untidy half that turns
 * those states into escape sequences and reads the pointer back out.
 *
 * ## Why the panel scrolls instead of painting over
 *
 * A program talking to a terminal cannot read the screen back. tmux can
 * save/restore a screen buffer because it owns that buffer; a program only owns
 * the characters it has written. Painting the overlay over the user's output
 * therefore destroys it permanently. So the overlay first emits newlines to
 * scroll the viewport, which guarantees the rows it is about to use are blank,
 * and leaves the user's history above where they can scroll back to it.
 *
 * ## Why there is a cursor-position query at all
 *
 * The newlines above guarantee the *rows* are blank but say nothing about which
 * row the cursor ended on — a newline scrolls only if it has to, and how far it
 * scrolled depends on output this process did not write. Mouse coordinates are
 * absolute screen positions while the panel is anchored to the bottom of the
 * viewport, so without knowing the cursor row every click would be off by
 * however much the viewport happened to scroll. `\x1b[6n` is the only thing in
 * the protocol that reports it. Do not "simplify" this away: scrolling into
 * blank rows makes them safe to write on, it does not make the anchor knowable.
 *
 * A terminal that never answers is common enough (some pty emulators and some
 * multiplexers swallow the reply) that the request has a timeout and falls back
 * to assuming the cursor is on the last row, which is where the preparation
 * newlines leave it in the ordinary case.
 */

import type { AdBox } from '../project/geometry.js';
import {
  HIDE_CURSOR,
  SHOW_CURSOR,
  carriageReturn,
  cursorPositionRequest,
  eraseLine,
  moveUp,
  parseCursorPosition,
} from './ansi.js';
import { clampCellBox, enforceCellMinimum, isDegenerate } from './cells.js';
import { DISABLE_MOUSE, ENABLE_MOUSE, parseMouseReports } from './mouse.js';
import {
  PANEL_HEIGHT,
  boxFromDrag,
  createInitialState,
  reduce,
  renderBoxOutline,
  renderCreated,
  renderPanel,
  renderScrim,
  type CellRun,
  type OverlayEffect,
  type OverlayEvent,
  type OverlayState,
  type PanelMetrics,
} from './panel.js';

/** How often the fade advances while waiting for the user. */
const TICK_MS = 40;

/** How long to wait for `\x1b[6n` before assuming the worst. */
const CURSOR_QUERY_TIMEOUT_MS = 120;

/** Terminal size assumed when a stream does not report one. */
const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

const CTRL_C = '\x03';
const ESCAPE = '\x1b';

const TOO_SHORT_HINT =
  'Make the window taller, or run `clirevenue editor` which has no height requirement.';

/** Raised when the overlay cannot run at all, as opposed to failing mid-drag. */
export class OverlayError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'OverlayError';
    this.hint = hint;
  }
}

/** The viewport a box was drawn in, so the caller can convert cells to pixels. */
export interface OverlayViewport {
  cols: number;
  rows: number;
}

export interface OverlayOptions {
  /** Name and counters shown on the home panel. */
  metrics: PanelMetrics;
  /**
   * Persist a slot. The box is in terminal cells; the caller converts with
   * `cellsToPixels` and `boxToLayout` so the stored layout is relative and
   * survives the window being resized afterwards.
   */
  save: (box: AdBox, viewport: OverlayViewport) => void | Promise<void>;
  /** Injected for tests; defaults to the process streams. */
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  /** Injected for tests; defaults to `process`. */
  signals?: NodeJS.Process;
}

export interface OverlayResult {
  /** How many slots were written while the overlay was open. */
  created: number;
}

type OverlayStream = NodeJS.WriteStream & { columns?: number; rows?: number };
type OverlayInput = NodeJS.ReadStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
};

class OverlaySession {
  private readonly output: OverlayStream;
  private readonly input: OverlayInput;
  private readonly signals: NodeJS.Process;
  private readonly save: OverlayOptions['save'];
  private readonly settle: (error?: Error) => void;

  private state: OverlayState;
  private cols: number;
  private rows: number;

  /** 0-based viewport row the panel's first line occupies. */
  private panelTop = 0;
  /** 0-based viewport row the panel's last line occupies, and where the cursor rests. */
  private anchorRow = 0;
  /** Whether a frame is on screen, so the next paint knows to walk back up. */
  private painted = false;
  /** Whether teardown has run, so it is a no-op the second time. */
  private torndown = false;
  /** stdin bytes that were not mouse reports. */
  private pending = '';
  private created = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;

  private readonly onData = (chunk: Buffer | string): void => {
    this.pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const { events, rest } = parseMouseReports(this.pending);
    this.pending = rest;

    for (const event of events) {
      this.dispatch({ kind: event.type, col: event.col, row: event.row });
      if (this.torndown) return;
    }
    this.consumeKeys();
  };

  private readonly onResize = (): void => {
    if (this.torndown) return;
    const rows = this.readRows();
    if (rows < PANEL_HEIGHT) {
      this.settle(new OverlayError(`This terminal is ${rows} rows tall and the overlay needs ${PANEL_HEIGHT}.`, TOO_SHORT_HINT));
      return;
    }
    this.cols = this.readCols();
    this.rows = rows;
    try {
      this.erasePanel();
      this.anchorRow = this.pendingAnchorRow;
      void this.anchorFromHere();
    } catch (error) {
      this.settle(error instanceof Error ? error : new Error(String(error)));
    }
  };

  constructor(options: OverlayOptions, settle: (error?: Error) => void) {
    this.output = (options.output ?? process.stdout) as OverlayStream;
    this.input = (options.input ?? process.stdin) as OverlayInput;
    this.signals = options.signals ?? process;
    this.save = options.save;
    this.settle = settle;
    this.state = createInitialState(options.metrics);
    this.cols = this.readCols();
    this.rows = this.readRows();
    this.pendingAnchorRow = this.rows - PANEL_HEIGHT;
  }

  /** Where the cursor should be assumed to be when the query is not answered. */
  private pendingAnchorRow = 0;

  private readCols(): number {
    const value = Number(this.output.columns);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : FALLBACK_COLS;
  }

  private readRows(): number {
    const value = Number(this.output.rows);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : FALLBACK_ROWS;
  }

  private write(text: string): void {
    this.output.write(text);
  }

  /**
   * Ask where the cursor is.
   *
   * The listener is attached before the request is written: a terminal that
   * answers synchronously would otherwise deliver the reply into nothing.
   */
  private queryAnchorRow(): Promise<number> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (row: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.input.removeListener('data', onData);
        resolve(row);
      };
      const onData = (chunk: Buffer | string): void => {
        const parsed = parseCursorPosition(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        if (parsed) finish(parsed.row);
      };
      const timer = setTimeout(() => finish(this.pendingAnchorRow), CURSOR_QUERY_TIMEOUT_MS);
      timer.unref?.();
      this.input.on('data', onData);
      this.write(cursorPositionRequest());
    });
  }

  /**
   * Scroll blank rows into existence, learn the anchor, park the cursor at the
   * panel's first row.
   */
  private async anchor(): Promise<void> {
    this.write('\n'.repeat(PANEL_HEIGHT - 1));
    this.anchorRow = await this.queryAnchorRow();
    this.panelTop = Math.max(0, this.anchorRow - (PANEL_HEIGHT - 1));
    this.paint();
  }

  /** Re-establish the anchor after a resize, keeping what is on screen. */
  private async anchorFromHere(): Promise<void> {
    this.write('\n'.repeat(PANEL_HEIGHT - 1));
    this.anchorRow = await this.queryAnchorRow();
    this.panelTop = Math.max(0, this.anchorRow - (PANEL_HEIGHT - 1));
    this.paint();
  }

  async open(): Promise<void> {
    if (typeof this.input.setRawMode !== 'function') {
      throw new OverlayError(
        'The overlay needs a real terminal to read the mouse from.',
        'It cannot run in a pipe, a CI log, or an editor task pane. Run it in a normal terminal window.',
      );
    }
    if (this.output.isTTY === false || this.input.isTTY === false) {
      throw new OverlayError(
        'The overlay needs an interactive terminal.',
        'Redirected output has no pointer to read. Run `clirevenue overlay` in a terminal window.',
      );
    }
    if (this.rows < PANEL_HEIGHT) {
      throw new OverlayError(
        `This terminal is ${this.rows} rows tall and the overlay needs ${PANEL_HEIGHT}.`,
        TOO_SHORT_HINT,
      );
    }

    this.write(HIDE_CURSOR);
    this.write(ENABLE_MOUSE);
    this.input.setRawMode(true);
    this.input.resume?.();
    this.input.on('data', this.onData);
    this.signals.on('SIGWINCH', this.onResize);

    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();

    await this.anchor();
  }

  private tick(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastTickAt;
    this.lastTickAt = now;
    if (elapsedMs <= 0) return;
    this.dispatch({ kind: 'tick', elapsedMs });
  }

  /** Route one event through the pure reducer and act on its effect. */
  private dispatch(event: OverlayEvent): void {
    if (this.torndown) return;
    const before = this.state;
    const { state, effect } = reduce(before, event, {
      panelTop: this.panelTop,
      cols: this.cols,
      rows: this.rows,
    });

    this.state = state;
    if (effect) this.applyEffect(effect);
    if (state !== before) this.paint();
  }

  private applyEffect(effect: OverlayEffect): void {
    if (effect.kind === 'close') {
      this.settle();
      return;
    }
    // `boxFromDrag` always yields at least 1x1, so `isDegenerate` is false even
    // for a click with no movement. That is deliberate: a click is a placement
    // of the smallest ad, not a mistake to discard, and `enforceCellMinimum`
    // grows it from the corner the user was looking at.
    const box = this.finalizeBox(effect.box);
    if (!box) return;
    try {
      const outcome = this.save(box, { cols: this.cols, rows: this.rows });
      if (outcome && typeof (outcome as Promise<void>).then === 'function') {
        (outcome as Promise<void>).then(
          () => {
            this.created += 1;
          },
          (error: unknown) => {
            this.settle(
              new OverlayError(
                `Could not save the slot: ${error instanceof Error ? error.message : String(error)}`,
                'Check the terminal window size and try again.',
              ),
            );
          },
        );
        return;
      }
      this.created += 1;
    } catch (error) {
      this.settle(
        new OverlayError(
          `Could not save the slot: ${error instanceof Error ? error.message : String(error)}`,
          'Check the terminal window size and try again.',
        ),
      );
    }
  }

  /**
   * Turn a raw drag rectangle into one that can actually be stored.
   *
   * Clamp, then grow to the minimum ad size, then clamp again — growing pushes
   * the box past the right and bottom edges on a narrow terminal, and a layout
   * resolved outside its own container is a slot that renders off-screen.
   */
  private finalizeBox(box: AdBox): AdBox | null {
    const viewport = { cols: this.cols, rows: this.rows };
    let next = clampCellBox(box, viewport);
    if (isDegenerate(next)) return null;
    next = enforceCellMinimum(next);
    next = clampCellBox(next, viewport);
    return isDegenerate(next) ? null : next;
  }

  /** The rectangle currently being dragged, in viewport cells. */
  private currentBox(): AdBox | null {
    const { anchor, pointer } = this.state;
    if (!anchor || !pointer) return null;
    return boxFromDrag(anchor, pointer);
  }

  private frameLines(): string[] {
    const { mode } = this.state;
    if (mode === 'home') return renderPanel(this.state, this.cols);
    if (mode === 'placing') return renderScrim(this.cols, PANEL_HEIGHT);
    if (mode === 'created') return renderCreated(this.state, this.cols, PANEL_HEIGHT);

    // Dragging: the scrim is gone, so these rows are blank again and the
    // outline is all that is drawn. Repainting the whole block every frame is
    // what keeps the rectangle from leaving a trail as it grows.
    const blank = ' '.repeat(this.cols);
    const lines: string[] = new Array<string>(PANEL_HEIGHT).fill(blank);
    const box = this.currentBox();
    if (box) this.applyRuns(lines, renderBoxOutline(box));
    return lines;
  }

  /**
   * Splice positioned runs into the frame.
   *
   * Plain string indexing is correct here and not a shortcut: every cell the
   * outline writes is a single-column box-drawing character, and the line it
   * lands on is a run of spaces, so code-unit index and column index coincide.
   */
  private applyRuns(lines: string[], runs: CellRun[]): void {
    for (const run of runs) {
      const index = run.row - this.panelTop;
      if (index < 0 || index >= lines.length) continue;
      const line = lines[index] as string;
      const col = Math.max(0, Math.min(run.col, line.length));
      lines[index] = line.slice(0, col) + run.text + line.slice(col + run.text.length);
    }
  }

  /**
   * Rewrite every row the overlay owns.
   *
   * No newline is emitted after the last line: a newline on the bottom row
   * scrolls the viewport, which would invalidate `panelTop` and leave the
   * panel drifting up the screen on every frame.
   */
  private paint(): void {
    if (this.torndown) return;
    const lines = this.frameLines();
    let out = '';
    if (this.painted) out += moveUp(PANEL_HEIGHT - 1) + carriageReturn();
    this.painted = true;
    for (let index = 0; index < lines.length; index += 1) {
      out += eraseLine() + (lines[index] as string);
      if (index < lines.length - 1) out += '\n';
    }
    this.write(out);
  }

  private erasePanel(): void {
    if (!this.painted) return;
    let out = moveUp(PANEL_HEIGHT - 1) + carriageReturn();
    for (let index = 0; index < PANEL_HEIGHT; index += 1) {
      out += eraseLine();
      if (index < PANEL_HEIGHT - 1) out += '\n';
    }
    this.painted = false;
    this.write(out);
  }

  /** Handle stdin tail bytes that were not mouse reports. */
  private consumeKeys(): void {
    if (this.torndown || this.pending.length === 0) return;
    const control = this.pending[0];
    this.pending = '';
    if (control === CTRL_C) {
      this.interrupt();
      return;
    }
    if (control === ESCAPE) {
      this.dispatch({ kind: 'escape' });
    }
  }

  /**
   * Ctrl+C in raw mode arrives as a byte, not a signal.
   *
   * Restoring the terminal and then re-raising SIGINT for real is the only
   * honest way to exit: `process.exit` here would skip teardown that any future
   * cleanup depends on, and swallowing the interrupt would leave the user with
   * a shell that ignores Ctrl+C.
   */
  private interrupt(): void {
    this.teardown();
    this.signals.kill(this.signals.pid, 'SIGINT');
  }

  /** Idempotent, and safe to call from a throw path. */
  teardown(): void {
    if (this.torndown) return;
    this.torndown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.signals.removeListener('SIGWINCH', this.onResize);
    this.input.removeListener('data', this.onData);
    this.write(DISABLE_MOUSE);
    this.input.setRawMode?.(false);
    this.input.pause?.();
    this.erasePanel();
    this.write(SHOW_CURSOR);
  }

  /** Finish cleanly and report how many slots were written. */
  complete(): void {
    this.teardown();
    this.settle();
  }

  get result(): OverlayResult {
    return { created: this.created };
  }
}

/**
 * Run the overlay until the user closes it or a slot has been placed.
 *
 * Resolves with the number of slots written, so the caller can print a summary
 * rather than leaving the only evidence of success to be something that faded
 * away on screen.
 */
export async function runOverlay(options: OverlayOptions): Promise<OverlayResult> {
  // The session calls `settle` exactly once, from wherever the interaction
  // ends, so the promise has to exist before the session is built. Capturing
  // `resolve`/`reject` into locals is what lets the session be constructed
  // afterwards without a cast through `null`.
  let resolveFinished: (result: OverlayResult) => void = () => undefined;
  let rejectFinished: (error: Error) => void = () => undefined;
  const finished = new Promise<OverlayResult>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const session = new OverlaySession(options, (error) => {
    if (error) {
      rejectFinished(error);
      return;
    }
    resolveFinished(session.result);
  });

  try {
    await session.open();
  } catch (error) {
    // Restore the terminal before propagating. Otherwise a failure to open --
    // no TTY, an unreadable key -- would leave the terminal in raw mode with
    // mouse reporting on and the user's shell needing a manual reset.
    session.teardown();
    // The caller gets `error`, not `finished`, so attach a no-op handler to
    // stop Node reporting this rejection as unhandled in the meantime.
    finished.catch(() => undefined);
    throw error;
  }

  return finished;
}

export { OverlaySession };
