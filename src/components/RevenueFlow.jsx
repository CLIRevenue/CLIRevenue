import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ecosystem } from '../data/demo.js'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'
import './RevenueFlow.css'

const { nodes, flows, order, stages } = ecosystem

// react-dom/server has no layout, so the measuring effect below has
// nothing to measure there and must not warn about it.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

// The diagram is one centred column: four plates with a single connector
// between each adjacent pair. There is no second column and no
// diagonal, so there is nothing that can cross anything else.
const SPEED_PX_PER_SECOND = 150
const DWELL_SECONDS = 0.55
const LOOP_GAP_SECONDS = 0.6

/* The geometry is read off the rendered layout rather than hard-coded
   as percentages of a fixed-ratio box. A connector is then literally
   the gap between two plates: `d` starts at the bottom edge of the
   plate above and ends at the top edge of the plate below, and the
   pulse's endpoints are those plates' centres. Same numbers, same
   units, one source — so the dot cannot drift off the line, at any
   width, and the plates are free to be whatever height their copy
   needs. */
function readGeometry(flowEl) {
  if (!flowEl) return null

  const frame = flowEl.getBoundingClientRect()
  const plates = Array.from(flowEl.querySelectorAll('.flow__node'))

  if (plates.length < 2 || frame.width <= 0) return null

  const centreX = frame.width / 2
  const boxes = plates.map((plate) => {
    const rect = plate.getBoundingClientRect()
    const top = rect.top - frame.top

    return { top, bottom: rect.bottom - frame.top, centre: top + rect.height / 2 }
  })

  return {
    centreX,
    height: frame.height,
    startY: boxes[0].centre,
    segments: boxes.slice(0, -1).map((box, index) => {
      const next = boxes[index + 1]

      return {
        from: box.centre,
        to: next.centre,
        path: `M ${centreX} ${box.bottom} L ${centreX} ${next.top}`,
      }
    }),
  }
}

function FlowNode({ id, isActive }) {
  const node = nodes[id]
  const Icon = node.icon
  const isHub = id === 'platform'

  return (
    <div
      className={`flow__node ${isHub ? 'flow__node--hub' : ''} ${isActive ? 'is-active' : ''}`}
    >
      <span className="flow__node-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="flow__node-label">{node.label}</span>
      <span className="flow__node-sub">{node.sub}</span>
    </div>
  )
}

/* One connector: a vertical rule spanning the whole gap, a chevron at
   the plate it arrives at, and the verb set beside the rule rather than
   over it. The label lives in its own gap, so there is no geometry in
   which it could sit on top of a plate. */
function FlowConnector({ flow, isLit }) {
  return (
    <div className={`flow__connector ${isLit ? 'is-lit' : ''}`}>
      <span className="flow__flowlabel">{flow.label}</span>
      <span className="flow__connector-head" aria-hidden="true" />
    </div>
  )
}

function RevenueFlow() {
  const reduced = usePrefersReducedMotion()
  const flowRef = useRef(null)
  const pulseRef = useRef(null)
  const [geometry, setGeometry] = useState(null)
  const [activeStage, setActiveStage] = useState(null)

  useIsomorphicLayoutEffect(() => {
    const flowEl = flowRef.current
    if (!flowEl) return undefined

    const measure = () => setGeometry(readGeometry(flowEl))
    measure()

    if (typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(measure)
    observer.observe(flowEl)

    return () => observer.disconnect()
  }, [])

  /* One dot, one timeline. It leaves the first plate, crosses the
     connector it is sitting in, and arrives under the next plate — the
     gaps are the only part of that run anyone can see, which is why
     the dwell at each plate reads as the stage landing. The connector
     it just crossed stays lit, and the stage list below marks the plate
     it reached, so the line, the dot and the sentence always describe
     the same moment.

     Built paused and started by an observer, so nothing moves until
     the diagram is actually on screen, and killed when it leaves. */
  useEffect(() => {
    const flowEl = flowRef.current
    if (!flowEl || !geometry || reduced) return undefined

    let timeline

    const context = gsap.context(() => {
      const dot = pulseRef.current
      if (!dot) return

      timeline = gsap.timeline({
        paused: true,
        repeat: -1,
        defaults: { ease: 'none' },
        onRepeat: () => setActiveStage(0),
      })

      timeline
        .fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.18 }, 0)
        .set(dot, { attr: { cy: geometry.startY } }, 0)

      geometry.segments.forEach((segment, index) => {
        const travel = Math.max(0.5, (segment.to - segment.from) / SPEED_PX_PER_SECOND)

        timeline
          .to(dot, { attr: { cy: segment.to }, duration: travel, ease: 'power1.inOut' })
          .call(() => setActiveStage(index + 1))
          .to({}, { duration: DWELL_SECONDS })
      })

      timeline
        .to(dot, { opacity: 0, duration: 0.2 })
        .to({}, { duration: LOOP_GAP_SECONDS })
    })

    if (typeof IntersectionObserver === 'undefined') {
      timeline?.play()
      return () => context.revert()
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!timeline) return

        if (entry.isIntersecting) timeline.play()
        else {
          timeline.pause()
          setActiveStage(null)
        }
      },
      { threshold: 0.3 },
    )

    observer.observe(flowEl)

    return () => {
      observer.disconnect()
      context.revert()
    }
  }, [geometry, reduced])

  const wires = flows.map((flow, index) => ({ flow, segment: geometry?.segments[index] }))

  return (
    <div className="revenue-flow">
      <div className="flow" ref={flowRef}>
        {geometry && (
          <svg
            className="flow__wires"
            viewBox={`0 0 ${geometry.centreX * 2} ${geometry.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              {flows.map((flow) => (
                <marker
                  key={flow.id}
                  id={`clir-arrow-${flow.id}`}
                  viewBox="0 0 6 6"
                  refX="5.4"
                  refY="3"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path className="flow__arrowhead" d="M0 0.6 L5.4 3 L0 5.4 z" />
                </marker>
              ))}
            </defs>

            {wires.map(({ flow, segment }, index) => (
              <path
                key={flow.id}
                id={`wire-${flow.id}`}
                className={`flow__wire ${activeStage === index + 1 ? 'is-lit' : ''}`}
                d={segment?.path ?? ''}
                markerEnd={`url(#clir-arrow-${flow.id})`}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {!reduced && (
              <circle
                ref={pulseRef}
                className="flow__pulse"
                cx={geometry.centreX}
                cy={geometry.startY}
                r="2.4"
              />
            )}
          </svg>
        )}

        <div className="flow__stages">
          {order.map((id, index) => (
            <Fragment key={id}>
              <FlowNode id={id} isActive={activeStage === index} />
              {flows[index] && (
                <FlowConnector
                  flow={flows[index]}
                  isLit={activeStage === index + 1}
                />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <ol className="flow__timeline flow__legends">
        {stages.map((stage, index) => {
          const Icon = nodes[stage.node].icon

          return (
            <li
              key={stage.id}
              className={`flow__stage ${activeStage === index ? 'is-active' : ''}`}
            >
              <span className="flow__stage-mark" aria-hidden="true">
                <span className="flow__stage-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon className="flow__stage-icon" aria-hidden="true" />
              </span>
              <span className="flow__stage-label">{stage.label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default RevenueFlow