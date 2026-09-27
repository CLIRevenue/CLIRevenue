/* =============================================================
   CLIRevenue — terminal script sampling
   -------------------------------------------------------------
   Pure, framework-free math. `sampleTerminal` takes a script (a
   command plus the output lines it produces) and a 0..1 progress
   value, then reports exactly what should be on screen at that
   point: how much of the command has been typed, and how far each
   output line has printed.

   Progress is the single source of truth for every terminal in the
   prototype, and that is deliberate. The same script can be driven
   by a self-playing tween, or later by a scroll-scrubbed master
   timeline, with no duplicated sequencing logic and nothing in this
   file knowing that React exists.

   Out of the box every line is already present in the DOM and only
   its opacity is withheld until it prints, so the reserved output
   region never reflows while output arrives.
   ============================================================= */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

const span = (value, from, to) =>
  to === from ? (value >= to ? 1 : 0) : clamp01((value - from) / (to - from))

/* Where each beat of a command execution sits, in progress units.
   The gap between `type` and `stream` is the deliberate pause that
   reads as a keystroke being submitted rather than a race. */
const SPANS = {
  type: [0, 0.3],
  stream: [0.36, 0.94],
  settle: [0.94, 1],
}

/* A script may override the whole map when a scene needs to hand part of
   its chapter to something else — the ad scene compresses the run so the
   reserved slot has room to materialise before the chapter closes. */
const defaultSpans = (over) => over ?? SPANS

/* Share of a line's slot spent printing its characters. The rest is
   the hold that stops a stream from reading as a typewriter race. */
const PRINT = 0.6

/* Lines that arrive character by character, versus the ones a real
   terminal materialises whole the moment a step resolves. */
const SLICE = {
  step: 'label',
  label: 'text',
  json: 'text',
  muted: 'text',
  rule: 'none',
  kv: 'none',
}

const source = (line) =>
  (SLICE[line.kind] === 'label' ? line.label : line.text) ?? ''

function phaseAt(p, streaming, spans) {
  if (p < spans.type[1]) return 'typing'
  if (p < spans.stream[0]) return 'submitted'
  if (streaming && p < spans.stream[1]) return 'streaming'
  return 'idle'
}

/* One output line resolved against its own slice of the stream. */
function reveal(line, t) {
  const mode = SLICE[line.kind] ?? 'none'
  const state = t <= 0 ? 'pending' : t >= 1 ? 'done' : 'active'

  if (state === 'pending')
    return { line, state, mode, text: '', printed: false }

  const print = span(t, 0, PRINT)

  if (mode === 'none') return { line, state, mode, text: null, printed: true }

  const full = source(line)
  return {
    line,
    state,
    mode,
    text: full.slice(0, Math.round(full.length * print)),
    printed: print >= 1,
  }
}

export function sampleTerminal(
  { command = '', lines = [], resetPrompt = true, spans: override } = {},
  progress = 0,
) {
  const p = clamp01(progress)
  const spans = defaultSpans(override)
  const count = lines.length || 1
  const typed = Math.round(command.length * span(p, spans.type[0], spans.type[1]))
  const streamed = span(p, spans.stream[0], spans.stream[1])

  return {
    command: command.slice(0, typed),
    lines: lines.map((line, i) =>
      reveal(line, span(streamed, i / count, (i + 1) / count)),
    ),
    phase: phaseAt(p, lines.length > 0, spans),
    /* the caret belongs to the prompt only while something is being
       entered — once the command is submitted the shell is busy */
    showCursor: p < spans.type[1],
    settled: p >= spans.stream[1],
    /* a finished command leaves a fresh prompt behind it, which is
       what keeps the command line demonstrably usable. Scenes with
       nothing to stream opt out and hold the command they typed. */
    resetPrompt,
  }
}

export const terminalSpans = SPANS
