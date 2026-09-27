/**
 * Clock sampler for the workbench transcript.
 *
 * The film's terminal is driven by scroll progress (`lib/terminal.js`); this
 * one runs on wall-clock time because it is not part of a scrubbed timeline.
 * Pure and framework-free for the same reason: it can be reasoned about, and
 * tested, without a component.
 *
 * Phases: typing -> working -> hold -> (loop)
 */

/**
 * @typedef {Object} RunLine
 * @property {string} kind  rule|kv|step|read|write|run|muted|slot
 * @property {string} [text]
 * @property {string} [meta]
 * @property {string} [key]
 * @property {string} [value]
 * @property {'ok'|'warn'|'dim'} [tone]
 */

/**
 * @typedef {Object} RunSample
 * @property {'typing'|'working'|'hold'} phase
 * @property {string} command       command, fully or partially typed
 * @property {number} visible       how many run lines are on screen
 * @property {boolean} showCursor   caret belongs to the prompt during typing
 * @property {boolean} settled      run finished, holding before the next pass
 */

/**
 * @param {{command:string, typeMs:number, holdMs:number, lines:RunLine[]}} run
 * @param {number} elapsed ms since the current pass started
 * @returns {RunSample}
 */
export function sampleRun(run, elapsed) {
  const typeMs = run.typeMs ?? 1200;
  const lineCount = run.lines.length;

  if (elapsed < typeMs) {
    const ratio = typeMs <= 0 ? 1 : elapsed / typeMs;
    const chars = Math.max(0, Math.ceil(run.command.length * ratio));
    return {
      phase: 'typing',
      command: run.command.slice(0, chars),
      visible: 0,
      showCursor: true,
      settled: false,
    };
  }

  let budget = elapsed - typeMs;
  let visible = 0;
  while (visible < lineCount && budget >= costOf(run.lines[visible])) {
    budget -= costOf(run.lines[visible]);
    visible += 1;
  }

  if (visible < lineCount) {
    return {
      phase: 'working',
      command: run.command,
      visible,
      showCursor: false,
      settled: false,
    };
  }

  return {
    phase: 'hold',
    command: run.command,
    visible: lineCount,
    showCursor: false,
    settled: true,
  };
}

/** Total wall-clock duration of one pass. */
export function runDuration(run) {
  const typeMs = run.typeMs ?? 1200;
  const totalWork = run.lines.reduce((sum, line) => sum + costOf(line), 0);
  return typeMs + totalWork + (run.holdMs ?? 4000);
}

/**
 * Per-line cost in ms. Rules and separators are near-instant, prose steps
 * linger, tool output lands quickly — the rhythm of a real agent session.
 */
function costOf(line) {
  switch (line.kind) {
    case 'rule':
      return 140;
    case 'kv':
      return 340;
    case 'step':
      return 620;
    case 'read':
      return 460;
    case 'write':
      return 540;
    case 'run':
      return 760;
    case 'slot':
      return 300;
    case 'muted':
      return 520;
    default:
      return 400;
  }
}

/** Index of the sponsored-slot anchor, or -1. */
export function slotIndex(run) {
  return run.lines.findIndex((line) => line.kind === 'slot');
}
