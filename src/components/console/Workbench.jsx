/* =============================================================
   CLIRevenue — the workbench
   -------------------------------------------------------------
   The film's terminal is scrubbed by scroll progress; this one runs
   on wall-clock time, because it belongs to a tool rather than to a
   timeline. Every line in the run is mounted from the start and only
   withheld, exactly as `OutputStream` does, so the sponsored slot
   never moves a pixel when it arrives — which is the entire argument
   the slot exists to make.
   ============================================================= */

import { useEffect, useRef, useState } from 'react'

import Terminal from '../Terminal.jsx'
import SponsoredSlot from './SponsoredSlot.jsx'
import { SectionHead } from './ui.jsx'
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion.js'
import { AGENT_RUN, REWARD_PER_INTERACTION_CENTS } from '../../data/economy.js'
import { runDuration, sampleRun, slotIndex } from '../../lib/run.js'
import { formatMoney } from '../../lib/economy.js'
import {
  getActiveCampaign,
  recordImpression,
  recordQualifyingEvent,
} from '../../lib/economyStore.js'

const SLOT_AT = slotIndex(AGENT_RUN)

/* Reduced motion gets one complete, static pass: the whole transcript
   is legible immediately and nothing about it depends on a timer, so
   this sample is derived at render rather than pushed by an effect. */
const STATIC_SAMPLE = sampleRun(AGENT_RUN, Number.POSITIVE_INFINITY)

function valueClass(tone) {
  if (tone === 'ok') return 'out__value out__value--ok'
  if (tone === 'warn') return 'out__value out__value--warn'
  return 'out__value'
}

function Line({ line, state }) {
  const attrs = { 'data-state': state }

  if (line.kind === 'rule') return <span className="out out--rule" {...attrs} />

  if (line.kind === 'kv') {
    return (
      <span className="out out--kv" {...attrs}>
        <span className="out__key">{line.key}</span>
        <span className="out__val"> {line.value}</span>
      </span>
    )
  }

  if (line.kind === 'muted') {
    return (
      <span className="out out--muted" {...attrs}>
        {line.text}
      </span>
    )
  }

  /* step / read / write / run all share the label — leader — value row.
     The verb is the label, the detail is the value; no glyphs, so the
     line survives any monospace face the reader happens to have. */
  return (
    <span className="out out--step" {...attrs}>
      <span className="out__label">{line.text}</span>
      <span className="out__leader"> </span>
      <span className={valueClass(line.tone)}>{line.meta}</span>
    </span>
  )
}

function sameFrame(a, b) {
  return (
    a.phase === b.phase &&
    a.visible === b.visible &&
    a.command === b.command &&
    a.showCursor === b.showCursor &&
    a.settled === b.settled
  )
}

function Workbench({ economy }) {
  const reduced = usePrefersReducedMotion()
  const hostRef = useRef(null)
  const elapsedRef = useRef(0)
  const [onScreen, setOnScreen] = useState(false)
  const [liveSample, setSample] = useState(() => sampleRun(AGENT_RUN, 0))
  const [signal, setSignal] = useState(null)

  const campaign = getActiveCampaign(economy)
  const connected = economy.account.connected

  /* Only stream while the workbench can actually be seen — a run that
     loops off-screen is a timer nobody asked for. */
  useEffect(() => {
    const node = hostRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setOnScreen(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reduced || !onScreen) return undefined

    elapsedRef.current = 0
    const id = window.setInterval(() => {
      elapsedRef.current += 60
      if (elapsedRef.current > runDuration(AGENT_RUN)) elapsedRef.current = 0
      const next = sampleRun(AGENT_RUN, elapsedRef.current)
      setSample((prev) => (sameFrame(prev, next) ? prev : next))
    }, 60)
    return () => window.clearInterval(id)
  }, [reduced, onScreen])

  const sample = reduced ? STATIC_SAMPLE : liveSample

  /* The advertiser's side of the story: a slot that rendered counted. */
  useEffect(() => {
    if (!onScreen) return
    recordImpression(campaign.id)
  }, [onScreen, campaign.id])

  useEffect(() => {
    if (!signal) return undefined
    const id = window.setTimeout(() => setSignal(null), 5000)
    return () => window.clearTimeout(id)
  }, [signal])

  const handleActivate = () => {
    recordQualifyingEvent(campaign.id)
    setSignal(
      connected
        ? {
            tone: 'ok',
            text: `Interaction recorded · ${formatMoney(
              REWARD_PER_INTERACTION_CENTS,
            )} pending · settles in 5s`,
          }
        : {
            tone: 'warn',
            text: 'Interaction recorded for the advertiser · connect CLIRevenue to earn',
          },
    )
  }

  const frame = {
    command: sample.command,
    lines: [],
    phase:
      sample.phase === 'typing' ? 'typing' : sample.phase === 'hold' ? 'idle' : 'streaming',
    showCursor: sample.phase !== 'working',
    settled: sample.phase === 'hold',
    resetPrompt: false,
  }

  return (
    <div className="block workbench" id="workbench" ref={hostRef}>
      <SectionHead
        index="01"
        label="AI coding workflow"
        title="An agent session, with the slot in the empty space."
        body="A real task, a real stream of tool output, and one reserved region in the middle of it that is honestly labelled. The agent never prints it, never reads it, and never acts on it."
      />

      <div className="workbench__stage">
        <Terminal
          title={AGENT_RUN.windowTitle}
          live
          slot="ad"
          frame={frame}
          foot={<span>demo workspace · simulated output · loops</span>}
        >
          <Transcript
            campaign={campaign}
            connected={connected}
            visible={sample.visible}
            onActivate={handleActivate}
          />
        </Terminal>

        <p className="workbench__signal" data-tone={signal ? signal.tone : 'idle'} aria-live="polite">
          {signal ? signal.text : 'Select the call to action to record a qualifying event.'}
        </p>
      </div>
    </div>
  )
}

function Transcript({ campaign, connected, visible, onActivate }) {
  return AGENT_RUN.lines.map((line, index) => {
    const state = index < visible ? 'printed' : 'pending'
    if (index === SLOT_AT) {
      return (
        <SponsoredSlot
          key="slot"
          campaign={campaign}
          connected={connected}
          hidden={index >= visible}
          onActivate={onActivate}
        />
      )
    }
    return <Line key={index} line={line} state={state} />
  })
}

export default Workbench
