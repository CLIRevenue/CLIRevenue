/* =============================================================
   CLIRevenue — the cinema
   -------------------------------------------------------------
   One hook, one master timeline, one ScrollTrigger. The film only
   ever runs on scroll: the scrollbar is the playhead, and there is
   no second mechanism that can move it.

   What used to live here was an autoplay — an animated scroll to
   the end of the stage that any user input cancelled. It is gone,
   and the page opens on the boot overlay instead, which is a
   different thing with a different job: the boot is an
   introduction that runs once and never touches the scroll, and
   when it finishes it simply reports itself done. This hook waits
   for that report and then re-measures, because the document is
   locked while it plays and `overflow: hidden` changes what the
   viewport is worth.

   Lenis owns the scrollbar, GSAP owns the playhead. They are
   connected in one direction only: Lenis reports where the scroll is,
   ScrollTrigger.update reads that, and the playhead follows. Neither
   one ever writes to the other, so there is no feedback loop to go
   unstable and no frame where the film disagrees with the scrollbar.
   Lenis runs on the GSAP ticker, which matters for more than tidiness
   — the film and the scroll surface are then sampled by the same
   rAF, so a scrubbed playhead and an eased scroll can never tear.


   Everything GSAP creates lives inside a single `gsap.context`
   scoped to the stage, and the effect's cleanup reverts it. That is
   not optional tidiness: there is no `@gsap/react` in this project,
   and `main.jsx` renders under `StrictMode`, which double-invokes
   effects. Without the context, a second mount would stack a second
   timeline and a second ScrollTrigger on top of the first and
   everything would animate twice.
   ============================================================= */

import { useLayoutEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import Lenis from 'lenis'

import { planChapters, TOTAL } from '../lib/sequence.js'
import { publishAll, publishSceneProgress, resetCinema } from '../lib/cinemaStore.js'
import { isIntroDone, subscribeIntro } from '../lib/introStore.js'
import usePrefersReducedMotion from './usePrefersReducedMotion.js'

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin, MotionPathPlugin, ScrambleTextPlugin)

/* The playhead tracks the scrollbar directly, with no catch-up of its
   own. That used to be a 0.35s lag, back when the scrollbar was the
   only thing smoothing the input — the lag was what made a flicked
   trackpad read as motion rather than teleporting. Lenis now does
   that job, and it does it on the frame the film is drawn on.

   Leaving the lag in place would not stack two nice effects. It would
   mean the playhead is chasing a scroll value that is itself still
   moving, so the film permanently trails the viewer's intent by a
   third of a second and a stop reads as a slow drift rather than a
   stop. One smoothing surface, not two. */
const SCRUB = true

export function useCinema(stageRef) {
  const reduced = usePrefersReducedMotion()

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined

    /* Reduced motion is not a shortened film, it is no film. The
       scene progress is pinned to the end so every terminal renders
       its finished state, and no ScrollTrigger or autoplay is
       created at all — the page becomes a normal scrollable
       document. The CSS `prefers-reduced-motion` block is what
       clears the handful of elements that ship with a hidden
       initial state. */
    if (reduced) {
      publishAll(1)
      return undefined
    }

    /* Measure from the top of the document. Restoring the previous
       scroll position first would mean measuring a stage that is
       already scrolled halfway through its own geometry. */
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    window.scrollTo(0, 0)

    const chapters = planChapters(stage, window.innerHeight, TOTAL)

    /* The scroll surface. Lenis wraps the browser's own scroll rather
       than replacing it, which is the reason to use it here and not
       something exotic: `position: sticky`, anchor links, focus
       scrolling and the scrollbar itself all keep working, because
       there is a real scroll position underneath all of it.

       Two options are left deliberately at their defaults and are
       worth knowing about. `respectReducedMotion` is `true`, so Lenis
       disables its own smoothing and makes programmatic scrolls
       instant when the viewer has asked for reduced motion — except
       that this branch never runs in that case at all (see above), so
       the flag is a second line of defence rather than the mechanism.
       And `syncTouch` is `false`: it makes touch scrolling feel right
       on modern iOS and visibly stutter on older versions, and no
       amount of easing makes that trade worth taking by default. */
    const lenis = new Lenis({ autoRaf: false, anchors: true })
    window.__clirLenis = lenis

    /* One direction only. Lenis reports, ScrollTrigger reads. */
    const onLenisScroll = () => {
      const start = performance.now()
      ScrollTrigger.update()
      const duration = performance.now() - start
      if (!window.__cascadeTimings) window.__cascadeTimings = []
      window.__cascadeTimings.push({ stage: 'scrolltrigger-update', duration, scrollY: window.scrollY })
    }
    lenis.on('scroll', onLenisScroll)

    /* Both on the same clock. `lagSmoothing(0)` is required, not
       cosmetic: GSAP clamps a long frame delta by default, which
       would leave Lenis's clock running ahead of the frame the film
       was drawn on, and the two would drift apart for as long as the
       tab stayed busy. */
    const raf = (time) => {
      const start = performance.now()
      lenis.raf(time * 1000)
      const duration = performance.now() - start
      if (!window.__cascadeTimings) window.__cascadeTimings = []
      window.__cascadeTimings.push({ stage: 'lenis-raf', duration, scrollY: window.scrollY })
    }
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)

    /* The particles are the one thing in the film that does not obey
       the playhead. A looping tween is by definition longer than any
       chapter, and a timeline containing an infinite repeat reports an
       infinite duration, which would take the whole scroll mapping
       with it. So they live on the global timeline instead and are
       switched on the first time the diagram has been drawn — from
       there on the money keeps moving, which is the right answer for
       a scene about money, and is what keeps the page alive after the
       cinematic has finished. */
    let particles = []
    let workLoop = null

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        paused: true,
        defaults: { ease: 'none' },
      })

      /* An empty tween at position zero, purely so the timeline has
         a duration. Without it a paused timeline with nothing at the
         end reports zero length and the scrub has nothing to map. */
      timeline.to({}, { duration: TOTAL }, 0)

      for (const chapter of chapters) {
        buildChapter(timeline, chapter, stage)
      }

      let flowing = false
      let working = false

      /* The one place scroll position becomes per-scene progress.
         Each chapter is handed its own local 0..1 clock, so scenes
         are never told about time that belongs to somebody else. */
      timeline.eventCallback('onUpdate', () => {
        const start = performance.now()
        const time = timeline.time()
        const gsapStart = performance.now()
        const progress = timeline.progress().toFixed(4)
        const gsapDuration = performance.now() - gsapStart

        const domStart = performance.now()
        stage.style.setProperty('--film-p', progress)
        const domDuration = performance.now() - domStart

        const chapterStart = performance.now()
        for (const chapter of chapters) {
          const localStart = performance.now()
          const local = chapter.local(time)
          const localDuration = performance.now() - localStart

          const publishStart = performance.now()
          publishSceneProgress(chapter.id, local)
          const publishDuration = performance.now() - publishStart

          if (!flowing && chapter.id === 'money' && local > 0.5) {
            flowing = true
            const particleStart = performance.now()
            particles.forEach((loop) => loop.play(0))
            const particleDuration = performance.now() - particleStart
            if (!window.__cascadeTimings) window.__cascadeTimings = []
            window.__cascadeTimings.push({ stage: 'particles-play', duration: particleDuration, scrollY: window.scrollY })
          }

          if (chapter.id === 'wait') {
            const active = local < 0.84
            if (active && !working) {
              working = true
              const workStart = performance.now()
              workLoop?.play()
              const workDuration = performance.now() - workStart
              if (!window.__cascadeTimings) window.__cascadeTimings = []
              window.__cascadeTimings.push({ stage: 'workLoop-play', duration: workDuration, scrollY: window.scrollY })
            } else if (!active && working) {
              working = false
              const workStart = performance.now()
              workLoop?.pause()
              const workDuration = performance.now() - workStart
              if (!window.__cascadeTimings) window.__cascadeTimings = []
              window.__cascadeTimings.push({ stage: 'workLoop-pause', duration: workDuration, scrollY: window.scrollY })
            }
          }

          if (!window.__cascadeTimings) window.__cascadeTimings = []
          window.__cascadeTimings.push({ stage: 'chapter-iteration', chapterId: chapter.id, localDuration, publishDuration, scrollY: window.scrollY })
        }
        const chapterDuration = performance.now() - chapterStart
        const duration = performance.now() - start
        if (!window.__cascadeTimings) window.__cascadeTimings = []
        window.__cascadeTimings.push({
          stage: 'timeline-onUpdate',
          duration,
          gsapDuration,
          domDuration,
          chapterDuration,
          scrollY: window.scrollY
        })
      })

      ScrollTrigger.create({
        trigger: stage,
        start: 'top top',
        end: 'bottom bottom',
        scrub: SCRUB,
        animation: timeline,
        invalidateOnRefresh: true,
      })

      particles = buildParticles(stage)
      workLoop = buildWorkLoop(stage)
    }, stage)

    /* The document is locked while the boot plays, and a locked
       document is measured differently from an unlocked one: the
       scrollbar is gone, so the viewport is a few pixels wider and
       every chapter length derived from it is wrong. The stages below
       were therefore planned against the *locked* geometry — the hook
       runs before the lock is released, which is exactly why it has to
       wait for the release rather than assume it.

       `scrollbar-gutter: stable` means the released layout is the same
       as the locked one, so this is a re-confirmation rather than a
       correction — but it is still the moment ScrollTrigger is allowed
       to trust the document, and the moment the viewer is allowed to
       move it. */
    const release = () => {
      lenis.resize()
      ScrollTrigger.refresh()
      window.scrollTo(0, 0)
    }

    const unsubscribeIntro = subscribeIntro(release)

    /* Lenis and ScrollTrigger both need to re-measure on resize, and
       in that order: Lenis recomputes its own limit, and ScrollTrigger
       then re-derives the scroll range against the fresh document. */
    const onResize = () => {
      lenis.resize()
      ScrollTrigger.refresh()
    }

    window.addEventListener('resize', onResize)

    /* If the boot had already finished by the time this ran — reduced
       motion marks it synchronously — there is no release event left
       to wait for, so measure now instead of never. */
    if (isIntroDone()) release()

    return () => {
      unsubscribeIntro()
      window.removeEventListener('resize', onResize)
      gsap.ticker.remove(raf)
      lenis.off('scroll', onLenisScroll)
      lenis.destroy()
      particles.forEach((loop) => loop.kill())
      workLoop?.kill()
      ctx.revert()
      resetCinema()
    }
  }, [reduced, stageRef])
}

/* -------------------------------------------------------------
   One chapter of the film.

   Every scene gets the same opening — the section head rises, the
   main object settles into place — and then the scene's own beat on
   top. Timing is expressed as a fraction of the chapter's measured
   length rather than in seconds, because chapters are not the same
   size: the diagram is a short, wide scene and the window scenes are
   tall, and a fixed schedule would either rush the diagram or stall
   the windows.
   ------------------------------------------------------------- */
function buildChapter(timeline, chapter, stage) {
  const root = stage.querySelector(`[data-scene="${chapter.id}"]`)
  if (!root) return

  const pick = (selector) => Array.from(root.querySelectorAll(selector))
  const at = (fraction) => chapter.at + chapter.length * fraction
  const span = (fraction) => Math.max(0.15, chapter.length * fraction)

  /* The opening scene's terminal is the anchor for every scene after
     it, so it gets no generic arrival. An element that animates in is
     announcing itself, and this film opens on something that was
     already running — the window is not introduced, it is uncovered,
     and the chrome, the output pane and the foot do not get to rise
     into place one at a time. Their only entrance is the clip in
     `waitBeat`, and `waitBeat` is also the only thing in the film
     that hides this body again, so there is nothing to leave in
     conflict. */
  if (chapter.id !== 'wait') {
    reveal(
      timeline,
      pick('.scene__head'),
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: span(0.26), ease: 'power3.out' },
      at(0.02),
    )

    reveal(
      timeline,
      pick('.terminal'),
      { opacity: 0, y: 22, scale: 0.99 },
      { opacity: 1, y: 0, scale: 1, duration: span(0.28), ease: 'power3.out' },
      at(0),
    )
  }

  beatFor(chapter.id, timeline, { pick, at, span })
}

/* A `fromTo` applies its starting values to the first target of a
   staggered tween and leaves the rest at their natural state until
   their own sub-tween starts. For a staggered reveal that is exactly
   backwards: every element after the first would sit fully visible
   for the length of the stagger before the film reached it, so the
   third scene's diagram and the fifth scene's benefit list would all
   be on screen before the viewer had scrolled anywhere.

   Setting the start values across the whole set first makes the
   hidden state real, and keeps the timeline responsible only for the
   motion. */
function reveal(timeline, targets, from, to, position) {
  if (!targets.length) return
  gsap.set(targets, from)
  timeline.fromTo(targets, from, to, position)
}

/* The diagram's nodes and wire labels centre themselves in CSS with
   `transform: translate(-50%,-50%)`, because their positions are
   percentages of the flow box and the box has to stay responsive.
   GSAP parses that translate into its own x/y the first time it
   touches an element, which means the centring is already inside the
   transform GSAP owns. Restating it as xPercent/yPercent on both ends
   of the tween applies it a second time: the top row looks fine
   because its centring is nearly zero, but the bottom row gets dragged
   half a node-width to the left and stops lining up with the wires
   that terminate at it.

   So the centring stays owned by the stylesheet — which also means it
   still holds under reduced motion, where this hook never runs — and
   the animation moves each element relative to the offset GSAP has
   already resolved. Scale is safe to set directly: GSAP scales about
   the element's own centre, which does not move that offset. */
function revealCentred(timeline, targets, { rise: amount, ...from }, to, position) {
  if (!targets.length) return

  const baseX = targets.map((target) => Number(gsap.getProperty(target, 'x')) || 0)
  const baseY = targets.map((target) => Number(gsap.getProperty(target, 'y')) || 0)

  const rest = (bases) => (index) => bases[index]

  reveal(
    timeline,
    targets,
    { ...from, x: rest(baseX), y: (index) => baseY[index] - amount },
    { ...to, x: rest(baseX), y: rest(baseY) },
    position,
  )
}

/* A dot of value running each wire, forever. Built paused so nothing
   moves until the diagram has actually been reached, and built on the
   global timeline rather than the master one so its infinite repeat
   cannot stretch the scroll mapping. The fade at each end keeps the
   dot from popping into existence at the start of a wire and blinking
   out at the end of it. */
function buildParticles(stage) {
  return Array.from(stage.querySelectorAll('.flow__particle')).map((dot, index) => {
    const wire = `#wire-${dot.dataset.particle}`
    const travel = 2.6 + index * 0.45

    return gsap
      .timeline({ paused: true, repeat: -1, defaults: { ease: 'none' } })
      .fromTo(
        dot,
        { opacity: 0 },
        { opacity: 1, duration: travel * 0.16 },
        0,
      )
      .to(
        dot,
        {
          motionPath: { path: wire, align: wire, alignOrigin: [0.5, 0.5] },
          duration: travel,
        },
        0,
      )
      .to(dot, { opacity: 0, duration: travel * 0.18 }, travel * 0.82)
  })
}

/* The agent's activity stream, cycling, which is the second thing in
   the film that does not obey the playhead — but for a different
   reason than the particles. Those loop because a scene about money
   should stay alive after it has been read. This loops because the
   scene's entire claim is that the agent is working *right now*, and
   a stream that only advanced while the viewer scrolled would freeze
   at the exact moment somebody stopped to watch it, which is the one
   thing the scene cannot afford.

   So the scroll decides whether the agent is working, and the cycle
   decides what it is doing. Those are separate questions, and the
   gate that couples them is in the master's onUpdate.

   It lives on the global timeline for the same reason the particles
   do — an infinite repeat inside the master would report an infinite
   duration and take the scroll mapping with it.

/* The idle state of this list is dim, not empty.

   It used to be zero, and zero is correct for a stream being read
   against a playhead — but the opening scene is a hero, and a hero
   whose only proof of life is whichever single line happens to be lit
   at that frame reads as a panel with a hole in it. The unlit rows now
   sit at DIM, so the viewer sees the whole shape of the work with one
   line of it in progress, and the lit row is unmistakable because it
   is the only one at full strength.

   The three things are still collapsed together — item, text and
   detail — because the loop fades all three *in* on every pass, and
   that only reads as one motion if they all start from the same
   place. Left at their natural opacity the first pass would have
   nothing to fade from and would show every row at full strength the
   instant it was lit, while every pass after that faded in properly.

   The set stays out here rather than inside the loop: a `set` at a
   position past zero does not apply at build time (GSAP's `set`
   defaults to `immediateRender: false` inside a timeline), so the
   first frame would arrive with the whole list showing and the loop
   would then reset it — a visible flash.

   The row leaves as a whole, and the row is in the target list for a
   reason that is not tidiness. The dots are a sibling of the text, not
   a child of it, so fading the text and the detail out would leave
   every finished row sitting on screen with its dots still pulsing and
   nothing written next to them — four lines that look like they are
   still in progress, which is the one thing the stream must never say.
   Fading the item takes the dots with it.

   The gap between one row leaving and the next arriving is the point.
   A quarter of a second goes by with the screen at its quietest, and
   that beat is what separates two states instead of blending them. */
function buildWorkLoop(stage) {
  const items = Array.from(stage.querySelectorAll('.work__item'))
  if (!items.length) return null

  const texts = []
  const details = []
  const rows = []

  items.forEach((item) => {
    const text = item.querySelector('.work__text')
    const detail = item.querySelector('.work__detail')
    if (!text || !detail) return
    rows.push({ item, text, detail })
    texts.push(text)
    details.push(detail)
  })

  if (!rows.length) return null

  const DIM = 0.16
  gsap.set([...rows.map((row) => row.item), ...texts, ...details], { opacity: DIM })

  const loop = gsap.timeline({
    paused: true,
    repeat: -1,
    defaults: { ease: 'power2.out' },
  })
  const STEP = 1.5

  rows.forEach((row, index) => {
    const from = index * STEP

    loop.set(row.item, { opacity: 1 }, from)
    loop.to(row.text, { opacity: 1, duration: STEP * 0.16 }, from)
    loop.to(
      row.text,
      {
        duration: STEP * 0.5,
        scrambleText: { text: row.text.textContent, chars: 'lowerCase', speed: 0.5 },
      },
      from + STEP * 0.1,
    )
    loop.to(row.detail, { opacity: 1, duration: STEP * 0.14 }, from + STEP * 0.4)
    loop.to(
      [row.item, row.text, row.detail],
      { opacity: DIM, duration: STEP * 0.16 },
      from + STEP * 0.84,
    )
  })

  return loop
}

function beatFor(id, timeline, { pick, at, span }) {
  switch (id) {
    case 'wait':
      return waitBeat(timeline, { pick, at, span })
    case 'ad':
      return adBeat(timeline, { pick, at, span })
    case 'money':
      return moneyBeat(timeline, { pick, at, span })
    case 'experience':
      return experienceBeat(timeline, { pick, at, span })
    case 'incentive':
      return incentiveBeat(timeline, { pick, at, span })
    case 'cta':
      return ctaBeat(timeline, { pick, at, span })
    default:
      return undefined
  }
}

/* The opening scene, and the only one that opens on something rather
   than on its own furniture.

   The window's entrance is not here. The clip that opens the terminal
   body and the ramp that brings it out of 35% opacity used to be the
   first two tweens of this chapter, and they are now the boot
   overlay's job: at scroll position zero the film has nowhere to come
   *from*, because zero is also where the viewer lands when they scroll
   back to the top. Moving them to the intro means the window opens
   once, on load, and every later arrival at the top of the document
   finds it already running — which is what the scene always claimed.

   The stream arrives as soon as the gate in `onUpdate` opens it, which
   is now at the top of the chapter.

   The last move in the chapter is subtraction, and it is the one place
   where the film leaves a scene by making less of it. The rows go
   first, and then the live light goes out — and only the light. Fading
    the whole terminal instead would leave the last line of output as
    small dim text in a static frame, which reads as a disabled control
   rather than a program that is still thinking. A nine-pixel light
   going out is the same information, and it carries no contrast
   obligation with it. */
function waitBeat(timeline, { pick, at, span }) {
  timeline
    .fromTo(
      pick('.work'),
      { opacity: 1, y: 0 },
      { opacity: 0, y: -6, duration: span(0.1), ease: 'power2.in' },
      at(0.82),
    )
    .to(
      pick('.terminal__light--live'),
      { opacity: 0.2, duration: span(0.08), ease: 'power1.in' },
      at(0.82),
    )
}

/* The whole point of this scene. The terminal is already on screen
   and busy by the time the slot arrives, so the slot gets its own
   entrance — dropping in from above with a slight vertical squash,
   the way a reserved region fills rather than an element fading
   up. Deliberately not folded into the generic terminal reveal.
   It lands in the first half of the chapter: the slot IS the
   subject of this scene, so the reader has to be able to see it
   for most of the pass, not only after they have scrolled past. */
function adBeat(timeline, { pick, at, span }) {
  reveal(
    timeline,
    pick('.adslot'),
    { opacity: 0, y: -14, scaleY: 0.82 },
    { opacity: 1, y: 0, scaleY: 1, duration: span(0.18), ease: 'power3.out' },
    at(0.22),
  )
}

function moneyBeat(timeline, { pick, at, span }) {
  revealCentred(
    timeline,
    pick('.flow__node'),
    { opacity: 0, scale: 0.84, rise: 16 },
    {
      opacity: 1,
      scale: 1,
      duration: span(0.26),
      ease: 'back.out(1.7)',
      stagger: span(0.07),
    },
    at(0.12),
  )

  /* The wires are drawn, not faded in. A diagram that assembles by
     having its own opacity ramp up looks like a dissolve, and the
     shape of the flow is the whole point of this scene — the line has
     to arrive as a line. The stroke already carries its final palette
     colour in the markup: the draw is the animation, and the wire
     arriving in its final colour is simpler than a line that draws
     dim and then ignites. */
  const wires = pick('.flow__wire')
  const heads = pick('.flow__arrowhead')
  const step = span(0.07)

  wires.forEach((wire, index) => {
    const head = heads[index]
    const start = at(0.2) + step * index
    const draw = span(0.24) - step * index * 0.6

    timeline.fromTo(
      wire,
      { drawSVG: '0% 0%' },
      { drawSVG: '0% 100%', duration: draw, ease: 'power1.inOut' },
      start,
    )

    /* The head is a marker on the path, and a marker is painted at a
       vertex whether or not any stroke has reached it. Without this
       the first wire would wear a finished arrowhead over an empty
       page. */
    if (head) {
      timeline.fromTo(
        head,
        { opacity: 0 },
        { opacity: 1, duration: span(0.05), ease: 'none' },
        start + draw * 0.82,
      )
    }
  })

  revealCentred(
    timeline,
    pick('.flow__flowlabel'),
    { opacity: 0, rise: 8 },
    {
      opacity: 1,
      duration: span(0.18),
      ease: 'power2.out',
      stagger: span(0.05),
    },
    at(0.34),
  )

  reveal(
    timeline,
    pick('.flow__legends'),
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: span(0.2), ease: 'power2.out' },
    at(0.44),
  )
}

/* The annotations are the argument of this scene — four flat claims
   about what does not break. They land after the terminal has been
   left running long enough to be believable.

   The sponsored region gets its own earlier beat here, for the same
   reason it has one in the ad chapter: the slot is an interface
   region of the host application, so it has to be present before the
   reader starts reading the claims around it. Without this the slot
   simply sat at its natural opacity and never participated in the
   scene's staging. */
function experienceBeat(timeline, { pick, at, span }) {
  reveal(
    timeline,
    pick('.adslot'),
    { opacity: 0, y: -14, scaleY: 0.82 },
    { opacity: 1, y: 0, scaleY: 1, duration: span(0.18), ease: 'power3.out' },
    at(0.24),
  )

  reveal(
    timeline,
    pick('.annot__item'),
    { opacity: 0, y: 14 },
    {
      opacity: 1,
      y: 0,
      duration: span(0.16),
      ease: 'power2.out',
      stagger: span(0.05),
    },
    at(0.52),
  )
}

function incentiveBeat(timeline, { pick, at, span }) {
  reveal(
    timeline,
    pick('.benefit'),
    { opacity: 0, y: 16 },
    {
      opacity: 1,
      y: 0,
      duration: span(0.26),
      ease: 'power2.out',
      stagger: span(0.08),
    },
    at(0.16),
  )

  /* The rule above each benefit ships as `scaleX(0)` in CSS so it
     never flashes before the chapter is reached. It is the one
     initial state in the project that GSAP is not the author of,
     and the one thing `prefers-reduced-motion` has to undo. */
  reveal(
    timeline,
    pick('.benefit__rule'),
    { scaleX: 0 },
    {
      scaleX: 1,
      duration: span(0.22),
      ease: 'power2.inOut',
      stagger: span(0.08),
    },
    at(0.2),
  )
}

function ctaBeat(timeline, { pick, at, span }) {
  const rise = (selector, fraction) =>
    reveal(
      timeline,
      pick(selector),
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: span(0.24),
        ease: 'power3.out',
        stagger: span(0.06),
      },
      at(fraction),
    )

  /* The mark's children are revealed against their parent rather than
     after it. `.closing__wordmark`, `.closing__status` and
     `.closing__ask` are all inside `.closing__mark`, so each fades up
     while the box around it is still rising, and their opacities
     multiply. That is what lets the status and the ask arrive after
     the box without ever flashing fully lit against it first: the
     product is dimmer than either factor alone, and both ease out, so
     it rises monotonically. */
  rise('.closing__headline span', 0.1)
  rise('.closing__verbs span', 0.4)
  rise('.closing__mark', 0.5)
  rise('.closing__status', 0.58)
  rise('.closing__ask', 0.64)

  /* The amber half of the wordmark gets the one effect that belongs
     to a title card: the letters arrive out of noise and settle into
     the name. Everything before it is a mechanical reveal — a rise, a
     draw, a fade — and this is the moment the film stops being
     machinery.

     It is the `<em>` alone, not the whole wordmark. ScrambleText
     rebuilds an element's content as plain characters, which would
     flatten the accent's markup, and scrambling the accent on its own
     reads better anyway: the coloured half of the name is the half
     that resolves.

     The scramble overlays the entrance rather than being one. The
     wordmark has no reveal of its own — it is a `<span>` inside
     `.closing__mark`, so it arrives on the box's rise at `at(0.5)`,
     and this tween starts at `at(0.56)` while that rise is still
     going. ScrambleText rearranges the characters of text that is
     already painted; it cannot bring anything into being. What the
     timing buys is the name resolving out of a box that is still
     settling, not a name arriving.

     The target text is stated explicitly rather than left to the
     plugin to read back. Without it the plugin has nothing to
     scramble *towards*, and it resolves to an empty string. */
  const accent = pick('.closing__wordmark em')
  if (accent.length) {
    timeline.to(
      accent,
      {
        duration: span(0.22),
        ease: 'none',
        scrambleText: { text: accent[0].textContent, chars: 'lowerCase', speed: 0.2 },
      },
      at(0.56),
    )
  }
}

export default useCinema
