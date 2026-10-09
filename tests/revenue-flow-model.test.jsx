/* =============================================================
   CLIRevenue — section 3 revenue flow model tests
   -------------------------------------------------------------
   The advertising chain is a fixed contract, not a design
   preference: the advertiser pays CLIRevenue, CLIRevenue
   delivers to the developer, and the developer's app or site
   serves the advertisement to the user. Every arrow is a
   single hop and the order is the order.

   These tests pin that contract at three levels — the data that
   describes it, the markup that renders it, and the source that
   used to contradict it. A behavioural assertion cannot see a
   label that is present in a stylesheet, so the source level
   exists to catch a stale branch coming back.
   ============================================================= */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import RevenueFlow from '../src/components/RevenueFlow.jsx'
import TheMoney from '../src/components/scenes/TheMoney.jsx'
import { ecosystem } from '../src/data/demo.js'

const ROOT = new URL('..', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** Source with its comments removed — prose must not satisfy a check. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/.test(line))
    .join('\n')

const markup = renderToStaticMarkup(<RevenueFlow />)
const scene = renderToStaticMarkup(<TheMoney />)

/** How many times `pattern` matches in `haystack`. */
const count = (haystack, pattern) => haystack.match(pattern)?.length ?? 0

const NODE_PLATE = /class="flow__node(?:\s|")/g
const CONNECTOR_LABEL = /class="flow__flowlabel"/g
const text = (label) => `>${label}<`
const at = (label) => markup.indexOf(text(label))

describe('the ecosystem describes the canonical chain', () => {
  test('stages the four participants in order', () => {
    expect(ecosystem.order).toEqual(['advertiser', 'platform', 'developer', 'user'])
  })

  test('names CLIRevenue as the ad network', () => {
    expect(ecosystem.nodes.platform.label).toBe('CLIRevenue')
    expect(ecosystem.nodes.platform.sub).toBe('Ad Network')
  })

  test('connects each stage to exactly one successor', () => {
    expect(ecosystem.flows.map((flow) => [flow.from, flow.to])).toEqual([
      ['advertiser', 'platform'],
      ['platform', 'developer'],
      ['developer', 'user'],
    ])
  })

  test('labels the three connections pays, delivers and serves', () => {
    expect(ecosystem.flows.map((flow) => flow.label)).toEqual([
      'pays',
      'delivers',
      'serves',
    ])
  })

  test('explains the same four stages the diagram draws', () => {
    expect(ecosystem.stages.map((stage) => stage.node)).toEqual(ecosystem.order)
    expect(ecosystem.stages.map((stage) => stage.label)).toEqual([
      'Advertiser runs the campaign and pays CLIRevenue.',
      'CLIRevenue operates the ad network and delivers the campaign.',
      'Developer integrates CLIRevenue into their app or site.',
      'The app or site serves the advertisement to the user.',
    ])
  })

  test('never describes the developer as publishing advertisements', () => {
    const all = JSON.stringify(ecosystem)
    expect(all).not.toMatch(/publish/i)
    expect(all).not.toMatch(/share/i)
  })
})

describe('the rendered diagram is one vertical chain', () => {
  test('renders four stages and three connections', () => {
    expect(count(markup, NODE_PLATE)).toBe(4)
    expect(count(markup, CONNECTOR_LABEL)).toBe(3)
  })

  test('orders the plates advertiser, CLIRevenue, developer, user', () => {
    const seen = ecosystem.order.map((id) => at(ecosystem.nodes[id].label))
    expect(seen.every((position) => position !== -1)).toBe(true)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  test('renders pays, delivers and serves beside their connectors', () => {
    expect(markup).toContain(text('pays'))
    expect(markup).toContain(text('delivers'))
    expect(markup).toContain(text('serves'))
  })

  test('carries no share branch and no live flag', () => {
    expect(markup).not.toMatch(/share/i)
    expect(markup).not.toMatch(/flow__flag/)
  })

  test('interleaves plates and connectors so no label can overlap a plate', () => {
    // The order below can only hold if each connector sits between the two
    // plates it joins, which is what makes a label ever touching a node
    // geometrically impossible rather than merely unlikely.
    const chain = ecosystem.order.flatMap((id, index) => {
      const flow = ecosystem.flows[index]
      return [at(ecosystem.nodes[id].label), flow && at(flow.label)]
    })
    expect(chain.every((position) => position !== -1)).toBe(true)
    expect([...chain].sort((a, b) => a - b)).toEqual(chain)
  })
})

describe('the scene copy matches the diagram', () => {
  test('spells out the same chain in the scene body', () => {
    expect(scene).toContain('pays CLIRevenue')
    expect(scene).toContain('delivers the campaign')
    expect(scene).toContain('serves the advertisement to the user')
    expect(scene).not.toMatch(/share/i)
  })
})

describe('the source no longer contradicts the model', () => {
  const flow = code('src/components/RevenueFlow.jsx')
  const flowCss = code('src/components/RevenueFlow.css')
  const data = code('src/data/demo.js')
  const money = code('src/components/scenes/TheMoney.jsx')

  test('uses no per-wire particle and no live flag markup', () => {
    expect(flow).not.toMatch(/flow__particle/)
    expect(flow).not.toMatch(/flow__flag/)
    expect(flowCss).not.toMatch(/flow__particle/)
    expect(flowCss).not.toMatch(/flow__flag/)
  })

  test('has no branching wire geometry left behind', () => {
    // The old model branched off the platform base; every connector is now
    // a single vertical hop between two measured plates.
    expect(flow).not.toMatch(/left:\s*\d|top:\s*\d/)
    expect(flow).not.toMatch(/user-share|dev-share/)
    expect(data).not.toMatch(/user-share|dev-share/)
  })

  test('leaves no share or live vocabulary in the scene data', () => {
    // `demo.js` also holds scenes 5 and 6, which are out of scope here, so
    // the ban applies to the ecosystem this test owns.
    expect(JSON.stringify(ecosystem)).not.toMatch(/share/i)
    expect(money).not.toMatch(/share/i)
    expect(money).not.toMatch(/publish/i)
  })

  test('draws one travelling pulse, not one per wire', () => {
    // The pulse is measured from real layout, so it only exists client-side
    // and is asserted at source level.
    expect(count(flow, /flow__pulse/g)).toBe(1)
    expect(flow).not.toMatch(/flow__particle/)
  })

  test('boots on the two approved brand files', () => {
    const intro = code('src/components/Intro.jsx')
    expect(intro).toContain('/brand/clirevenue-logo-dark.png')
    expect(intro).toContain('/brand/clirevenue-wordmark.png')
    expect(read('src/App.css')).not.toMatch(/\.intro__word\b/)
  })
})