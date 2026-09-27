import { ecosystem } from '../data/demo.js'

const { nodes, flows, order } = ecosystem

const POSITIONS = {
  advertiser: { left: 50, top: 10.7 },
  platform: { left: 50, top: 48 },
  user: { left: 17, top: 85.3 },
  developer: { left: 83, top: 85.3 },
}

const WIRES = {
  pay: 'M50 13.5 L50 29',
  'user-share': 'M43 41.5 C43 52, 17 50, 17 57',
  'dev-share': 'M57 41.5 C57 52, 83 50, 83 57',
}

const WIRE_LABELS = {
  pay: { left: 50, top: 28.3 },
  'user-share': { left: 30, top: 67.4 },
  'dev-share': { left: 70, top: 67.4 },
}

function FlowNode({ id }) {
  const node = nodes[id]
  const Icon = node.icon
  const pos = POSITIONS[id]
  const isHub = id === 'platform'

  return (
    <div
      className={`flow__node ${isHub ? 'flow__node--hub' : ''}`}
      style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
    >
      <span className="flow__node-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="flow__node-label">{node.label}</span>
    </div>
  )
}

function RevenueFlow() {
  return (
    <div>
      <div className="flow">
        <svg
          className="flow__wires"
          viewBox="0 0 100 75"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* One marker per wire, so a head can arrive with its own
              line instead of hanging in mid-air at the end of a path
              that has not been drawn yet. `context-stroke` ties the
              head to whatever colour its wire currently is. */}
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
                <path
                  className="flow__arrowhead"
                  d="M0 0.6 L5.4 3 L0 5.4 z"
                  opacity="0"
                />
              </marker>
            ))}
          </defs>

          {flows.map((flow) => (
            <g key={flow.id}>
              <path
                id={`wire-${flow.id}`}
                className="flow__wire flow__wire--active"
                d={WIRES[flow.id]}
                markerEnd={`url(#clir-arrow-${flow.id})`}
              />
              <circle
                className="flow__particle"
                data-particle={flow.id}
                r="1.2"
                opacity="0"
              />
            </g>
          ))}
        </svg>

        {order.map((id) => (
          <FlowNode key={id} id={id} />
        ))}

        {flows.map((flow) => (
          <span
            key={flow.id}
            className="flow__flowlabel"
            style={{
              left: `${WIRE_LABELS[flow.id].left}%`,
              top: `${WIRE_LABELS[flow.id].top}%`,
            }}
          >
            {flow.label}
          </span>
        ))}
      </div>

      <ul className="flow__legends">
        {order.map((id) => {
          const node = nodes[id]
          const Icon = node.icon
          const isHub = id === 'platform'
          return (
            <li
              key={id}
              className={`flow__legend ${isHub ? 'flow__legend--hub' : ''}`}
            >
              <span className="flow__legend-icon">
                <Icon aria-hidden="true" />
              </span>
              <span>
                <span className="flow__legend-label">{node.label}</span>
                <span className="flow__legend-blurb">{node.blurb}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default RevenueFlow
