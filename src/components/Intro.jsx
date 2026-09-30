/* =============================================================
   CLIRevenue — the boot
   -------------------------------------------------------------
   A short technical sequence that plays over a locked document
   before the hero is uncovered. It is an introduction, not a
   second film: it runs once per page load, it owns no scroll, and
   the moment it finishes it hands the page back and reports
   itself done through `introStore`.

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

const WORD = 'CLIRevenue'

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
      tl.to(vLines, { scaleY: 1, duration: 0.6, stagger: 0.05, ease: 'power2.out' }, 0)

      /* 2 — boot ticks. Scrambled rather than faded: this is text
         being resolved, not text arriving. */
      tl.fromTo(
        ticks,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, stagger: 0.07 },
        0.08,
      )

      /* 3 — the name resolves out of noise. */
      tl.fromTo(
        '.intro__word',
        { opacity: 0 },
        { opacity: 1, duration: 0.2 },
        0.5,
      )
      tl.to(
        '.intro__word',
        {
          duration: 0.7,
          ease: 'none',
          scrambleText: { text: WORD, chars: 'upperCase', speed: 0.7 },
        },
        0.52,
      )

      /* 4 — the signal bar sweeps. The one saturated accent in the
         sequence, and it is a rule rather than a glow: the palette
         says rules, not halos. */
      tl.to('.intro__bar', { scaleX: 1, duration: 0.5, ease: 'power4.inOut' }, 1.05)

      tl.fromTo(
        '.intro__status',
        { opacity: 0 },
        { opacity: 1, duration: 0.3 },
        1.25,
      )
      tl.to(
        '.intro__status',
        {
          duration: 0.45,
          ease: 'none',
          scrambleText: { text: 'SYS/00 · READY', chars: 'upperCase', speed: 0.6 },
        },
        1.27,
      )

      /* 5 — the cover lifts, and the hero comes up behind it rather
         than after it, so the handover reads as one move. */
      tl.to(
        '.intro__cover',
        { yPercent: -100, duration: 0.85, ease: 'power4.inOut' },
        1.75,
      )

      tl.to(heroTitle, { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.08 }, 2.0)
      tl.to(heroBits, { y: 0, opacity: 1, duration: 0.55, stagger: 0.045 }, 2.25)
      tl.to(heroTerminal, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 2.15)
      tl.to(
        heroBody,
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'power2.out' },
        2.45,
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
          <span className="intro__word">{WORD}</span>
          <span className="intro__bar" />
          <span className="intro__status">SYS/00 · READY</span>
        </div>
      </div>
    </div>
  )
}

export default Intro
