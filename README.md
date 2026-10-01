# CLIRevenue

**An advertising slot that lives above your command line — and shares what it earns.**

A scrollytelling prototype for an advertising and revenue-sharing concept for CLI
and AI-CLI applications. Not a real product, and not a pitch deck: a working
demonstration of one specific idea, built to be scrolled.

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run build
```

---

## The idea

A CLI's output is sacred. Scripts parse it, pipes consume it, people diff it.
Anything that appears on a terminal is something the tool *said*. So the obvious
place to put an advertisement is the one place that isn't output: a dedicated
region of the interface between the transcript and the prompt.

That region is permanent and native. It is not printed, so a script reading
`stdout` still receives exactly what the tool emitted. The user always knows
which is which, and they can keep working.

Four parties are involved:

| | |
|---|---|
| **Advertisers** | reach the people who actually read documentation |
| **Platform** | provides the infrastructure and takes a service fee |
| **Users** | can earn a share from advertising engagement |
| **Developers** | get a new revenue stream for free and open-source tools |

No CPMs, no earnings figures, no conversion claims. The concept is the point,
and the copy stays conceptual on purpose.

## The six scenes

1. **The wait** — a command goes in, the terminal says nothing, and an agent works through a task one line at a time
2. **The ad** — a real command runs, then the sponsored region materialises above the prompt
3. **The money** — the diagram: advertiser → platform → user, developer
4. **The experience** — the ad stays put, the command line keeps working, output stays clean
5. **The incentive** — what each of the three sides gets out of it
6. **Close** — *Turn terminal attention into shared revenue.*

## How it runs

The film plays once on load, then scroll becomes a scrub head.

```
window.scrollY  ──►  ScrollTrigger  ──►  master timeline
                          (scrub)              │
                                                ├─► chapter.local(time)  ──►  store
                                                │                            │
                                                ├─► GSAP reveals ──────────────┤
                                                │                            ▼
                                                │                      <Terminal frame>
                                                └─► MotionPath particles  useSceneProgress()
```

Autoplay is not a second mechanism. It is a GSAP tween that moves `window.scrollY`
to the end of the stage, so the autoplay pass and a manual scroll drive the exact
same timeline through the exact same code. Touch the wheel and the tween is
killed mid-flight; from that point the film is entirely yours.

That single mechanism is why the terminal, the diagram, and the typography can all
be scrubbed backwards and forwards without any of them keeping state of their own.

**Chapter windows are measured, not divided.** A naive six-equal-chapters timeline
drifts badly: the scenes are `min-height: 100svh` but measure ~1032px against a
900px viewport, so by scene 6 a fixed sixth of the timeline would open ~750px
before the scene had entered. `src/lib/sequence.js` measures where each scene
actually enters and leaves the viewport and gives each one exactly that slice of
the film. Neighbouring windows overlap by one viewport, which produces the
crossfade — a scene is still assembling as the next one arrives.

**Terminal output is progress-driven, not time-driven.** `src/lib/terminal.js` is
pure arithmetic mapping `0..1` to a frame. Scroll at 40% and you get the fifth line
half-typed; scroll back and you get the first. The same sampler serves the cinematic
and the replay, which is why scrubbing a terminal backwards works at all.

## Layout

```
src/
  lib/
    sequence.js         scene order, geometry → chapter plan      (pure math)
    terminal.js         progress → terminal frame                  (pure math)
    cinemaStore.js      per-scene progress store                  (no React)
  hooks/
    useCinema.js        master timeline, ScrollTrigger, autoplay, particles
    useSceneProgress.js subscribe to one scene's progress
    useTerminal.js      sample a script at a progress value
    usePrefersReducedMotion.js
  components/
    Cinema.jsx          the stage, the master timeline's scope
    Scene.jsx           one <section>, named by its heading
    Terminal.jsx        window chrome, output region, ad slot, prompt
    OutputStream.jsx    the typed transcript
    AgentStream.jsx     the wait scene's looping agent work
    CommandLine.jsx     the prompt
    AdSlot.jsx          the sponsored region — the only interactive control
    RevenueFlow.jsx     the participant diagram
    scenes/             TheWait, TheAd, TheMoney, TheExperience, TheIncentive, Cta
  data/demo.js          all scripted copy, in one place
```

`lib/` is deliberately React-free and mostly free of GSAP. The sequencing decisions
are testable arithmetic, separated from the machinery that animates them.

## The ad is the only interactive thing on the page

Worth calling out, because it is the load-bearing claim of the whole prototype.
Pressing **Learn More** expands a panel *in place* and changes nothing above it:
the transcript's height, line count, and `textContent` are byte-identical before
and after. That is the cheapest available proof that the region is interface
rather than output — a surface that can open without disturbing what the tool said.

Opening it does not re-measure the scroll timeline. The chapter plan is measured
once; a few percent of drift while the panel is open snaps back on close, whereas
refreshing the trigger from new geometry while holding the same progress visibly
yanks the playhead. A surface that can open is worth more than a scrollbar that
measures it perfectly.

## Accessibility

- Every scene is a named `<section>`, so the film is six navigable landmarks
  rather than one wall of text. The CTA names itself from its own headline; the
  hook, which has no headline, carries an `aria-label`.
- One visually-hidden `<h1>`, five `<h2>` scene titles, no gaps in the outline.
- The ink ramp clears WCAG AA on every surface it is used on, including the
  window chrome, which is the tightest one. The old ramp read well as a gradient
  and failed as type; size and weight, not hue, now separate the lower tiers.
- `prefers-reduced-motion: reduce` disables the autoplay, the scroll hijack, the
  cursor blink, the transitions, and every GSAP reveal, and lands the page on its
  final state. The ad still opens — instantly, and without animating.
- `forced-colors: active` is handled: borders and strokes survive the palette swap,
  and the ad's identity, which normally rests on a `box-shadow` ring, is restated
  as a dashed border.
- The diagram's SVG is `aria-hidden`; the participant information is duplicated as
  a real list with icons, labels, and descriptions, because that is what a screen
  reader should be given instead of a picture of arrows.

## Deliberately not here

- **MorphSVG.** Available and free, but no beat earns its ~30 kB — every shape in
  the diagram is load-bearing geometry whose endpoints must land on node centres.
- **Cross-scene layout morphs.** A `layoutId` needs its two elements to be mounted
  alternately. Both ends are permanently on screen here, so one id would be claimed
  twice. Faked, it would have looked like it worked and broken on interaction.
- **A second reveal gate.** The chapter windows already decide what is revealed
  when. A `useInView` alongside them would be a second source of truth for the
  same decision, disagreeing with the film near the boundaries.
- **Real numbers.** None. Every figure in the terminal output — `148 files`,
  `12 issues`, `exit 0` — is the sample output of a stand-in host application, not
  a claim about anything.

## Developer documentation

The public SDK onboarding page and the full reference are in the repository:

- `http://localhost:5173/developer` — the SDK landing page (install, key,
  placements, render, events, sizing, FAQ).
- `docs/developer/` — getting-started, installation, sdk, placements,
  ad-slots, configuration, analytics, authorization, troubleshooting,
  faq.

The SDK surface is the `packages/sdk` workstream. Where the API is still
settling, this documentation marks the integration point and tracks it in
`docs/AI_HANDOFF.md`.

## Status

**Early concept.** Looking for developers, advertisers, and CLI users.
