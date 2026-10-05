/* =============================================================
   CLIRevenue — terminal emission layer
   -------------------------------------------------------------
   One canvas for the whole film, not one per terminal.

   That decision is the performance story. A per-terminal canvas
   would mean a per-terminal rAF, a per-terminal layout read, and a
   compositor layer each — four of them for a page that shows two at
   a time. A single fixed layer means one rAF, one clear, one paint,
   and exactly one DOM node no matter how many surfaces exist. The
   particle budget then lives in the field, which is already pooled
   and already capped, so "how many particles" stays one number
   rather than one number per terminal.

   The surfaces are discovered from the DOM rather than declared by
   the scenes. Every terminal in the film is a `.terminal`, the
   component that renders it is shared, and the scenes have no reason
   to know that a particle layer exists — so adding the layer here
   covers the hero and every in-chapter window at once, and a future
   terminal is covered by rendering one. Nothing in a scene changes
   to get the effect.

   The layer is mounted as a sibling of the stage rather than inside
   it, for two reasons. It is `position: fixed`, and the stage
   carries a scroll-driven `transform` — a transformed ancestor
   becomes the containing block for fixed descendants, which would
   quietly turn a viewport-locked layer into a stage-locked one. And
   the master timeline runs inside a `gsap.context` scoped to the
   stage, so staying outside it means nothing here can be picked up,
   reverted, or measured by chapter planning.

   Energy is read from the cinema store each frame rather than being
   animated on its own clock. That is what ties the effect to the
   film: the field brightens while the playhead is inside a scene's
   chapter and while that chapter is actually moving, and settles
   when the viewer stops. Particles therefore breathe with the
   scroll instead of running beside it.
   ============================================================= */

import { useEffect, useRef } from 'react'

import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'
import { getSceneProgress } from '../lib/cinemaStore.js'
import {
  createField,
  readPalette,
  HERO_CAP,
  SURFACE_CAP,
} from '../lib/emission.js'

const STAGE = '.stage'
const SURFACE = '.terminal'
const HERO_SCENE = 'wait'

/* Spawn attempts per second at full energy, per surface. The
   fractional accumulator below means this is an average, not a
   per-frame decision, so a 144Hz display and a 60Hz display carry
   the same density. */
const RATE = 7.5

/* The canvas is drawn at up to 2x. Past that the extra pixels are
   not visible on a 1px dot and the fill cost is real. */
const MAX_DPR = 2

/* Margins around the origin band, in CSS px, measured inward from
   the surface's top-right corner. The band is deliberately a
   fraction of the surface rather than a fixed size, so the hero and
   a narrow window both emit from a corner that looks like theirs. */
const INSET_X = 8
const INSET_Y = 6
const BAND_X = 0.3
const BAND_Y = 0.16

/* How far outside the viewport a surface may sit and still be worth
   measuring. Particles are short-lived, so a surface that is about
   to arrive has nothing to show yet. */
const CULL = 120

/* A surface is not measured or emitted into outside this band of
   viewport height. Keeps the observer's work proportional to what
   is actually on screen. */
const OBSERVER_MARGIN = '15% 0px'

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

function TerminalEmission() {
  const canvasRef = useRef(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    /* Reduced motion gets no layer at all. Not a static frame, not
       a slower version: the honest reading of the preference is that
       nothing moves without being asked, and a particle field is
       nothing but movement. The canvas is never mounted, so there is
       no rAF, no layout read and no paint to pay for either. */
    if (reduced) return undefined

    const canvas = canvasRef.current
    const stage = document.querySelector(STAGE)
    if (!canvas || !stage) return undefined

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return undefined

    const field = createField()
    field.setPalette(readPalette())

    /* Stable per-element identity.

       Surfaces are re-discovered on every resize, and a terminal that
       moved from first to second in that list would otherwise be handed
       a new key — which would orphan the particles already in flight
       under the old one and let the new surface spend a second cap
       while the old key's particles are still alive. Keying off the
       element itself means a re-scan is a refresh, not a renumbering. */
    const keys = new WeakMap()
    let nextKey = 0
    const keyFor = (el) => {
      if (!keys.has(el)) keys.set(el, nextKey++)
      return keys.get(el)
    }

    /* Each surface carries the state the frame loop needs: which
       scene owns it, whether it is on screen, its smoothed energy,
       its previous playhead value for the velocity term, and a
       fractional spawn accumulator. */
    let surfaces = []
    let dpr = 1
    let last = 0
    let raf = 0
    let observer = null
    /* Whether the canvas currently holds a drawn frame. The field
       empties between bursts, and a canvas keeps its pixels until
       something clears them — so without this the last few particles
       of a burst would hang on the screen forever. */
    let painted = false

    const sceneOf = (el) => el.closest('[data-scene]')?.dataset.scene || ''

    function measure() {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
    }

    function discover() {
      if (observer) observer.disconnect()
      observer = null

      /* Carried across a re-scan so a resize does not make every
         surface look like it has just come to rest, and so the
         playhead-velocity term does not read a spurious jump. */
      const prior = new Map(surfaces.map((s) => [s.el, s]))

      surfaces = Array.from(stage.querySelectorAll(SURFACE)).map((el) => {
        const scene = sceneOf(el)
        const previous = prior.get(el)
        return {
          key: keyFor(el),
          el,
          scene,
          hero: scene === HERO_SCENE,
          onScreen: previous ? previous.onScreen : true,
          energy: previous ? previous.energy : 0,
          previous: previous ? previous.previous : 0,
          carry: previous ? previous.carry : 0,
        }
      })

      /* Off-screen surfaces are not merely skipped in the loop, they
         are dropped from the observer's set, so the callback does
         not fire for them while they are away. A terminal that
         scrolls out takes its particles with it. */
      if (typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const surface = surfaces.find((s) => s.el === entry.target)
              if (surface) surface.onScreen = entry.isIntersecting
            }
          },
          { rootMargin: OBSERVER_MARGIN },
        )
        for (const surface of surfaces) observer.observe(surface.el)
      }
    }

    /* --- the frame ------------------------------------------------
       One pass. Read the surfaces that are on screen, advance their
       energy, spawn what that energy has bought, then step and draw
       the field once.

       The only layout read in here is `getBoundingClientRect` on the
       visible surfaces, and it is deliberately the *only* thing that
       touches layout: nothing in this loop writes to the DOM, so the
       read cannot force a synchronous re-layout mid-frame. */
    function frame(now) {
      raf = window.requestAnimationFrame(frame)
      if (document.hidden) {
        last = now
        return
      }

      /* Clamped so a backgrounded tab or a long task cannot teleport
         every particle across the screen on the next frame. */
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now
      if (dt <= 0) return

      const height = window.innerHeight
      const width = window.innerWidth

      for (const surface of surfaces) {
        if (!surface.onScreen) continue

        const rect = surface.el.getBoundingClientRect()
        if (
          rect.bottom < -CULL ||
          rect.top > height + CULL ||
          rect.right < -CULL ||
          rect.left > width + CULL ||
          rect.width === 0
        ) {
          continue
        }

        /* Two terms, and the difference between them is the whole
           point. `arc` is where the playhead is inside the chapter:
           nothing at either end, strongest through the middle, so a
           scene emits as it is being read. `playing` is how fast that
           playhead is moving: the film is streaming output, and the
           surface responds to being worked. Stop scrolling and both
           terms fall away, which is what stops the page from looking
           like it is running on its own. */
        const progress = getSceneProgress(surface.scene)
        const delta = Math.abs(progress - surface.previous)
        surface.previous = progress

        const arc = Math.sin(Math.PI * clamp(progress, 0, 1))
        const playing = clamp(delta / 0.035, 0, 1)
        const target = clamp(0.26 + 0.44 * arc + 0.4 * playing, 0, 1)

        /* Smoothed rather than applied raw: the playhead is scrubbed,
           so its velocity is noisy frame to frame, and an unsmoothed
           energy would make the field stutter with the scrub. */
        surface.energy += (target - surface.energy) * Math.min(1, dt * 3.2)

        if (surface.energy <= 0.01) continue

        surface.carry += RATE * surface.energy * dt
        while (surface.carry >= 1) {
          surface.carry -= 1
          field.spawn(
            surface.key,
            rect.right - INSET_X,
            rect.top + INSET_Y,
            rect.width * BAND_X,
            rect.height * BAND_Y,
            surface.energy,
            surface.hero ? HERO_CAP : SURFACE_CAP,
          )
        }
      }

      /* Nothing alive and nothing about to be born: skip the step and
         the paint entirely, so an idle film costs a counter check
         rather than a full-viewport repaint sixty times a second.

         The one-off clear matters, though. `draw` clears before it
         paints, but `draw` is not called when the field is empty — so
         a single explicit clear is what stops the final frame of a
         burst from being stranded on the canvas. */
      if (field.count > 0) {
        field.step(dt)
        field.draw(ctx, dpr)
        painted = true
      } else if (painted) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        painted = false
      }
    }

    /* --- lifecycle ---------------------------------------------- */

    function onResize() {
      measure()
      discover()
    }

    function onVisibility() {
      /* Drop the clock on the way back so the first frame after a
         hidden tab is a fresh delta rather than a huge one. */
      last = 0
    }

    measure()
    discover()

    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    raf = window.requestAnimationFrame(frame)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      field.clear()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [reduced])

  /* Nothing is rendered under reduced motion, so the canvas is not
     rendered either — an empty, pointer-transparent layer sitting in
     the tree for the rest of the session is a cost with no picture. */
  if (reduced) return null

  return (
    <canvas
      ref={canvasRef}
      className="emission"
      aria-hidden="true"
      /* The layer is decoration over the whole page and must never
         intercept a click, a text selection or a scroll gesture. */
      role="presentation"
    />
  )
}

export default TerminalEmission
