/* =============================================================
   CLIRevenue — the sequence plan
   -------------------------------------------------------------
   The prototype is a scrollytelling film: one master timeline, one
   ScrollTrigger, one chapter per scene. This file decides where the
   chapter cuts fall.

   That decision cannot just be an equal split. ScrollTrigger maps
   scroll to timeline progress linearly, and the six scenes are not
   exactly one viewport tall, so equal chapters would drift further
   and further out of step with the scene they belong to — by the
   last scene, badly enough that a chapter would open while the
   viewer was still two scenes away.

   Instead each scene is given the scroll window during which it is
   actually on screen — from the moment its top edge enters the
   bottom of the viewport to the moment its bottom edge meets the
   viewport bottom, i.e. the scroll at which the scene fully covers
   the viewport and its successor's top edge begins to enter.
   Chapter boundaries are those windows, normalised into timeline
   seconds. Neighbouring windows are contiguous (one scene's `to` is
   the next's `from`), so a chapter reaches local 1.0 while its scene
   still occupies the viewport: each scene finishes communicating
   before the next scene's window opens, and useful content never
   lags behind the physical viewport.

   Everything here is pure arithmetic over measured geometry, so the
   plan can be recomputed without touching React or GSAP.
   ============================================================= */

export const SCENES = [
  'wait',
  'ad',
  'money',
  'experience',
  'incentive',
  'cta',
]

/* Nominal running time of the full cinematic pass, in timeline
   seconds. Autoplay walks the scrollbar in roughly this long. */
export const TOTAL = 13.8

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

/* Shortest chapter worth animating. Guards against a scene that is
   measured as zero-height, which would otherwise produce a division
   by zero in `local`. */
const MIN_LENGTH = 0.4

export function planChapters(stage, viewport, total = TOTAL) {
  const range = Math.max(1, stage.offsetHeight - viewport)
  const stageTop = stage.getBoundingClientRect().top

  return SCENES.reduce((chapters, id) => {
    const node = stage.querySelector(`[data-scene="${id}"]`)
    if (!node) return chapters

    const top = node.getBoundingClientRect().top - stageTop
    /* The chapter opens as the scene's top edge enters the viewport
       bottom. Clamped to zero for a scene already on screen at load. */
    const from = clamp01((top - viewport) / range)
    /* The chapter closes one scene-height of scroll later — the moment
       the scene's bottom edge meets the viewport bottom, i.e. the scene
       fully covers the viewport and its successor begins to enter.
       Content mapped to local fractions of this window therefore
       completes while the scene still occupies the viewport, never
       after it has left. For adjacent scenes this makes `to` of one
       equal `from` of the next exactly: contiguous chapters, no
       viewport-wide overlap dragging every reveal a scene late. */
    const to = clamp01(from + node.offsetHeight / range)
    const at = from * total
    const length = Math.max(MIN_LENGTH, (to - from) * total)

    chapters.push({ id, from, to, at, length, local: localAt(at, length) })
    return chapters
  }, [])
}

function localAt(at, length) {
  return (time) => clamp01((time - at) / length)
}

export const clampProgress = clamp01
