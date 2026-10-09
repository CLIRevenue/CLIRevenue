/* =============================================================
   CLIRevenue — the boot
   -------------------------------------------------------------
   A short technical sequence that plays over a locked document
   before the hero is uncovered. It is an introduction, not a
   second film: it runs once per page load, it owns no scroll, and
   the moment it finishes it hands the page back and reports
   itself done through `introStore`.

   The brand itself is the content of this sequence. The mark is
   the approved CLIRevenue logo file and the name is the approved
   CLIRevenue wordmark file, served from `public/brand` — nothing
   here redraws, approximates or re-types the identity. They are
   shown in sequence rather than together: the mark arrives and
   settles, clears, and only then does the wordmark resolve. One
   asset at a time reads as a brand reveal; both at once reads as
   a loading screen.

   The hero's own entrance is animated from here rather than from
   the cinema hook, for two reasons. The film's playhead is the
   scrollbar, and at scrollbar zero the hero would have nowhere to
   come from; and the elements it touches live in the opening scene,
   whose chapter deliberately has no generic reveal. So the boot
   lifts the cover, brings the hero in behind it, and opens the
   terminal window — and from that point on the hero is simply
   there, at rest, for the rest of the page load.

   Reduced motion gets no overlay at all: the store is marked done
   synchronously and the hero paints in its finished state, which is
   the same thing the CSS already describes.
   ============================================================= */

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'

import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'
import { isIntroDone, markIntroComplete } from '../lib/introStore.js'

gsap.registerPlugin(ScrambleTextPlugin)

/* The approved brand files, byte-for-byte from the supplied source
   of truth. Intrinsic dimensions are declared so the browser reserves
   the right box before either file lands.

   Both are decoded asynchronously, and both are preloaded from
   `index.html`. Decoding them synchronously put two 1.5-megapixel PNG
   decodes on the critical path in front of the cover's very first
   paint, which is what made the sequence appear to hang before it
   started; `async` lets the cover paint the moment React commits while
   the bitmaps finish in the background. The preload is what makes that
   safe — the fetch starts during HTML parse, in parallel with the
   bundle, instead of waiting for React to mount before it even begins. */
const MARK_SRC = '/brand/clirevenue-logo-dark.png'
const WORDMARK_SRC = '/brand/clirevenue-wordmark.png'
const MARK_SIZE = { width: 164, height: 178 }
const WORDMARK_SIZE = { width: 2164, height: 727 }

const STATUS = 'SYS/00 · READY'

function Intro() {
  const rootRef = useRef(null)
  const reduced = usePrefersReducedMotion()

  useLayoutEffect(() => {
    const root = rootRef.current

    if (reduced || !root || isIntroDone()) {
      if (root) root.style.display = 'none'
      markIntroComplete()
      return undefined
    }

    const doc = document.documentElement
    doc.classList.add('intro-lock')
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    window.scrollTo(0, 0)

    /* Scoped to the whole app rather than to the overlay, because the
       timeline reaches past the overlay into the opening scene. */
    const ctx = gsap.context(() => {
      const vLines = gsap.utils.toArray('.intro__line--v')
      const ticks = gsap.utils.toArray('.intro__tick')
      const heroTitle = gsap.utils.toArray('#wait .hero__title span')
      const heroBits = gsap.utils.toArray(
        '#wait .eyebrow, #wait .hero__body, #wait .hero__fact, #wait .hero__cta .btn, #wait .hero__meta span',
      )
      const heroTerminal = gsap.utils.toArray('#wait .hero__terminal .terminal')
      const heroBody = gsap.utils.toArray('#wait .terminal__body')

      /* Hero content is only ever hidden here, and only behind a
         cover, so there is no painted frame of it before it is
         supposed to exist. Everything the CSS describes is the
         finished state — which is also what reduced motion reads. */
      gsap.set(heroTitle, { yPercent: 108, opacity: 0 })
      gsap.set(heroBits, { y: 16, opacity: 0 })
      gsap.set(heroTerminal, { y: 26, opacity: 0 })
      gsap.set(heroBody, { clipPath: 'inset(100% 0% 0% 0%)' })
      gsap.set(vLines, { scaleY: 0 })
      gsap.set('.intro__bar', { scaleX: 0 })
      /* Both brand files start absent. They share one slot, so the
         mark has to be cleared before the wordmark is allowed in. */
      gsap.set('.intro__mark', { opacity: 0, scale: 0.94 })
      gsap.set('.intro__wordmark', { opacity: 0, scale: 0.97 })

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => {
          gsap.set(root, { display: 'none' })
          doc.classList.remove('intro-lock')
          markIntroComplete()
        },
      })

      /* 1 — the grid draws itself: verticals only, so the stage is
         measured out before anything is written on it. (Horizontal
         rules were removed with the rest of the band language.) */
      tl.to(vLines, { scaleY: 1, duration: 0.55, stagger: 0.05, ease: 'power2.out' }, 0)

      /* 2 — boot ticks. Scrambled rather than faded: this is text
         being resolved, not text arriving. */
      tl.fromTo(
        ticks,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.28, stagger: 0.07 },
        0.06,
      )

      /* 3 — the mark. The approved logo file, settling into place.
         No glow, no particles: it arrives the way a printed mark
         sits down on a page. */
      tl.to('.intro__mark', { opacity: 1, scale: 1, duration: 0.5 }, 0.3)

      /* 4 — the mark clears before the name arrives. Sequential, so
         the identity is stated rather than stacked. */
      tl.to('.intro__mark', { opacity: 0, scale: 1.03, duration: 0.32 }, 0.98)

      /* 5 — the wordmark. The approved wordmark file, resolving
         behind the mark's exit. */
      tl.to('.intro__wordmark', { opacity: 1, scale: 1, duration: 0.5 }, 1.18)

      /* 6 — the signal bar sweeps. The one saturated accent in the
         sequence, and it is a rule rather than a glow: the palette
         says rules, not halos. */
      tl.to('.intro__bar', { scaleX: 1, duration: 0.42, ease: 'power4.inOut' }, 1.78)

      tl.fromTo(
        '.intro__status',
        { opacity: 0 },
        { opacity: 1, duration: 0.3 },
        1.9,
      )
      tl.to(
        '.intro__status',
        {
          duration: 0.42,
          ease: 'none',
          scrambleText: { text: STATUS, chars: 'upperCase', speed: 0.6 },
        },
        1.92,
      )

      /* 7 — the cover lifts, and the hero comes up behind it rather
         than after it, so the handover reads as one move. */
      tl.to(
        '.intro__cover',
        { yPercent: -100, duration: 0.78, ease: 'power4.inOut' },
        2.42,
      )

      tl.to(heroTitle, { yPercent: 0, opacity: 1, duration: 0.85, stagger: 0.08 }, 2.62)
      tl.to(heroBits, { y: 0, opacity: 1, duration: 0.55, stagger: 0.045 }, 2.84)
      tl.to(heroTerminal, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 2.75)
      tl.to(
        heroBody,
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.65, ease: 'power2.out' },
        3.0,
      )
    }, document.getElementById('root'))

    return () => {
      ctx.revert()
      doc.classList.remove('intro-lock')
    }
  }, [reduced])

  if (reduced) return null

  return (
    <div className="intro" ref={rootRef} aria-hidden="true">
      <div className="intro__cover">
        <div className="intro__grid">
          <i className="intro__line intro__line--v" style={{ left: '16%' }} />
          <i className="intro__line intro__line--v" style={{ left: '50%' }} />
          <i className="intro__line intro__line--v" style={{ left: '84%' }} />
        </div>

        <div className="intro__corner intro__corner--tl">
          <span className="intro__tick">boot</span>
          <span className="intro__tick">seq 00</span>
        </div>
        <div className="intro__corner intro__corner--tr">
          <span className="intro__tick">ad / cli</span>
          <span className="intro__tick">4 parties</span>
        </div>
        <div className="intro__corner intro__corner--bl">
          <span className="intro__tick">stdout: clean</span>
          <span className="intro__tick">slot: native</span>
        </div>

        <div className="intro__centre">
          {/* The approved CLIRevenue brand files. Decorative: the cover
              is aria-hidden and the page announces its own name. Both
              sit in one slot so neither displaces the other.

              The slot is also what the red boot line is positioned
              against, so the line sits directly under the wordmark's
              artwork instead of trailing the left-hand status column. */}
          <span className="intro__brand">
            <img
              className="intro__mark"
              src={MARK_SRC}
              alt=""
              width={MARK_SIZE.width}
              height={MARK_SIZE.height}
              decoding="async"
            />
            <img
              className="intro__wordmark"
              src={WORDMARK_SRC}
              alt=""
              width={WORDMARK_SIZE.width}
              height={WORDMARK_SIZE.height}
              decoding="async"
            />
            <span className="intro__bar" />
          </span>
          <span className="intro__status">{STATUS}</span>
        </div>
      </div>
    </div>
  )
}

export default Intro