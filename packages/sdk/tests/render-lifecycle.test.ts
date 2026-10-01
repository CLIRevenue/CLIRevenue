import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { init, SDK_VERSION, SDK_VERSION_HEADER } from '../src/index.ts'

/* ------------------------------------------------------------------ */
/* a hand-rolled DOM, because there is no jsdom here and the SDK must   */
/* not require one. Only the surface render() actually touches is        */
/* modelled, and every stub is inspectable so a test can prove that a    */
/* listener or observer was torn down rather than merely created.        */
/* ------------------------------------------------------------------ */

const KEY = 'pk_test_' + 'a'.repeat(32)
const BASE = 'https://api.test'
const SELECTOR = '#terminal'

function servedAd(requestId = 'req-1', overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    ad: {
      id: 'ad-1',
      name: null,
      headline: 'Headline',
      description: null,
      cta: null,
      audience: 'cli-revenue',
      landingUrl: 'https://advertiser.example/landing',
      ...((overrides.ad as Record<string, unknown>) ?? {}),
    },
    impressionToken: 'tok-1',
    expiresAt: '2099-01-01T00:00:00Z',
  }
}

function ok(body: unknown) {
  return { status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

function noContent() {
  return { status: 204, json: async () => null, text: async () => '' }
}

/** Records every request the SDK makes, tagged by which endpoint it hit. */
function stubFetch(handler: (init: any) => unknown) {
  const calls: { url: string; init: any }[] = []
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, init })
    return handler(init, url, calls.length - 1)
  }
  impl.calls = calls
  return impl
}

const paths = (fetchImpl: { calls: { url: string }[] }) =>
  fetchImpl.calls.map((c) => c.url.slice(c.url.indexOf('/ads/')))

const countOf = (fetchImpl: { calls: { url: string }[] }, path: string) =>
  paths(fetchImpl).filter((p) => p === path).length

/* --- element stubs ------------------------------------------------- */

/**
 * A real CSSStyleDeclaration reads '' for a property that was never set, so
 * the stub must do the same -- otherwise "is this position set?" logic that
 * is correct in a browser looks wrong in a test.
 */
function makeStyle(initial: Record<string, string> = {}) {
  const style: Record<string, string> = { ...initial }
  return new Proxy(style, {
    get(target, prop: string) {
      return typeof prop === 'string' && !(prop in target) ? '' : (target as any)[prop]
    },
    set(target, prop: string, value) {
      if (value === '' || value === undefined) delete target[prop]
      else target[prop] = String(value)
      return true
    },
  }) as Record<string, string>
}

function makeAnchor() {
  return {
    href: '',
    textContent: '',
    attributes: {} as Record<string, string>,
    style: makeStyle(),
    listeners: {} as Record<string, number>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    addEventListener(type: string, fn: () => void) {
      this.listeners[type] = (this.listeners[type] ?? 0) + 1
      ;(this as any)[`_on_${type}`] = fn
    },
    dispatch(type: string) {
      ;(this as any)[`_on_${type}`]?.()
    },
  }
}

function makeHost(width = 1200, height = 800, position = '') {
  return {
    width,
    height,
    position,
    style: makeStyle(position ? { position } : {}),
    appended: [] as unknown[],
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ width, height }),
    appendChild(child: unknown) {
      this.appended.push(child)
    },
  }
}

/** Controllable ResizeObserver: instances are inspectable and triggerable. */
function fakeResizeObserver() {
  const instances: any[] = []
  class Impl {
    callback: () => void
    observed: unknown[] = []
    disconnected = false
    constructor(callback: () => void) {
      this.callback = callback
      instances.push(this)
    }
    observe(target: unknown) {
      this.observed.push(target)
    }
    disconnect() {
      this.disconnected = true
    }
    emit() {
      if (this.disconnected) return
      this.callback()
    }
  }
  return { Impl, instances }
}

/** Controllable IntersectionObserver for the viewability gate. */
function fakeIntersectionObserver() {
  const instances: any[] = []
  class Impl {
    callback: (entries: unknown[]) => void
    disconnected = false
    constructor(callback: (entries: unknown[]) => void) {
      this.callback = callback
      instances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
    emit(entries: unknown[]) {
      if (this.disconnected) return
      this.callback(entries)
    }
  }
  return { Impl, instances }
}

/** Manual rAF queue so "pending frame" is observable rather than inferred. */
function manualRaf() {
  let next = 1
  const queue = new Map<number, FrameRequestCallback>()
  return {
    requestAnimationFrame(cb: FrameRequestCallback) {
      const id = next++
      queue.set(id, cb)
      return id
    },
    cancelAnimationFrame(id: number) {
      queue.delete(id)
    },
    pending: () => queue.size,
    runAll(time = 0) {
      const entries = [...queue.entries()]
      queue.clear()
      for (const [, cb] of entries) cb(time)
      return entries.length
    },
  }
}

type Harness = ReturnType<typeof installDom>

function installDom(host = makeHost()) {
  const anchor = makeAnchor()
  const raf = manualRaf()
  const resize = fakeResizeObserver()
  const io = fakeIntersectionObserver()

  const dom = {
    anchor,
    host,
    raf,
    resize,
    io,
    computedPosition: 'static' as string,
    restore: () => {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    },
  }

  vi.stubGlobal('document', {
    referrer: '',
    querySelector: (selector: string) => (selector === SELECTOR ? host : null),
    createElement: () => anchor,
  })
  vi.stubGlobal('getComputedStyle', () => ({ position: dom.computedPosition }))
  vi.stubGlobal('ResizeObserver', resize.Impl)
  vi.stubGlobal('IntersectionObserver', io.Impl)
  vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame)
  vi.stubGlobal('location', { href: 'https://publisher.example/page' })
  return dom
}

function makeClient(fetchImpl: unknown, extra: Record<string, unknown> = {}) {
  return init(KEY, {
    baseUrl: BASE,
    fetchImpl: fetchImpl as never,
    sleep: async () => {},
    random: () => 0.5,
    storage: null,
    ...extra,
  })
}

/** Deliver one ad, let the ad appear, and return the SDK handle. */
async function renderOne(client: ReturnType<typeof makeClient>, layout?: unknown) {
  return (client as any).render('placement-1', SELECTOR, layout)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ */
/* lifecycle invariants                                                */
/* ------------------------------------------------------------------ */

describe('render() lifecycle', () => {
  it('delivers exactly once, no matter how many times the host resizes', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client)

    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)

    // A burst of resize notifications must not re-deliver.
    dom.resize.instances[0].emit()
    dom.resize.instances[0].emit()
    expect(dom.raf.runAll()).toBe(1)
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
    expect(countOf(fetchImpl, '/ads/impression')).toBe(0)
    expect(countOf(fetchImpl, '/ads/click')).toBe(0)
  })

  it('records at most one impression, however often the ad is reported viewable', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd()),
    )
    const client = makeClient(fetchImpl)

    await renderOne(client)

    const gate = dom.io.instances.at(-1)!
    gate.emit([{ isIntersecting: true, intersectionRatio: 1 }])
    vi.advanceTimersByTime(1000)
    await vi.advanceTimersByTimeAsync(0)

    // Repeats, including a drop below the threshold in between.
    gate.emit([{ isIntersecting: true, intersectionRatio: 1 }])
    gate.emit([{ isIntersecting: true, intersectionRatio: 0.2 }])
    gate.emit([{ isIntersecting: true, intersectionRatio: 1 }])
    await vi.advanceTimersByTimeAsync(5000)

    expect(countOf(fetchImpl, '/ads/impression')).toBe(1)
    expect(countOf(fetchImpl, '/ads/click')).toBe(0)
  })

  it('records at most one click per activation, and never blocks navigation', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd()),
    )
    const client = makeClient(fetchImpl)

    await renderOne(client)
    dom.anchor.dispatch('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(countOf(fetchImpl, '/ads/click')).toBe(1)
    expect(fetchImpl.calls.every((c: any) => c.url.includes('/ads/'))).toBe(true)
  })

  it('survives a click report that rejects: one activation, retried, never thrown', async () => {
    const dom = installDom()
    let clicks = 0
    const fetchImpl = stubFetch((_init: any, url: string) => {
      if (url.endsWith('/ads/click')) {
        clicks += 1
        throw new TypeError('fetch failed')
      }
      return ok(servedAd())
    })
    const client = makeClient(fetchImpl)

    await renderOne(client)
    // dispatch() must not throw even though every attempt fails.
    expect(() => dom.anchor.dispatch('click')).not.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)

    // One logical click; the retry budget is what expands it into attempts.
    expect(clicks).toBe(3) // 1 + maxRetries(2)
  })

  it('renders nothing and records nothing when the gateway returns no fill', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => noContent())
    const client = makeClient(fetchImpl)

    const result = await renderOne(client)

    expect(result.served).toBeNull()
    expect(dom.host.appended).toHaveLength(0)
    expect(dom.resize.instances).toHaveLength(0)
    expect(paths(fetchImpl)).toEqual(['/ads/deliver'])
  })

  it('re-throws a configuration error without touching the network', async () => {
    installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await expect(client.render('placement-1', '')).rejects.toThrow()
    await expect(client.render('placement-1', '#missing')).rejects.toThrow()
    expect(paths(fetchImpl)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* layout configuration does not disturb the accounting lifecycle      */
/* ------------------------------------------------------------------ */

describe('a configured ad keeps the same lifecycle as an unconfigured one', () => {
  const layouts: [string, unknown][] = [
    ['no layout argument', undefined],
    ['null layout', null],
    ['default size, centre', { size: {}, position: {} }],
    ['custom size and anchor', { size: { width: 300, height: 250 }, position: { anchor: 'bottom-left' } }],
    ['offsets', { position: { anchor: 'top-right', offsetX: -12, offsetY: 8 } }],
    ['hostile configuration', { size: { width: -5, height: Number.NaN }, position: { anchor: 'nope', offsetX: 1e9 } }],
  ]

  for (const [name, layout] of layouts) {
    it(`records one delivery and at most one impression with ${name}`, async () => {
      const dom = installDom()
      const fetchImpl = stubFetch((init: any) =>
        (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd()),
      )
      const client = makeClient(fetchImpl)

      await renderOne(client, layout)

      expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)

      dom.io.instances.at(-1)!.emit([{ isIntersecting: true, intersectionRatio: 1 }])
      vi.advanceTimersByTime(1000)
      await vi.advanceTimersByTimeAsync(0)

      expect(countOf(fetchImpl, '/ads/impression')).toBe(1)
      dom.anchor.dispatch('click')
      await vi.advanceTimersByTimeAsync(0)

      expect(countOf(fetchImpl, '/ads/click')).toBe(1)
    })
  }

  it('applies the requested geometry and keeps the ad inside its host', async () => {
    const dom = installDom(makeHost(1000, 500))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, {
      size: { width: 300, height: 120 },
      position: { anchor: 'bottom-right', offsetX: 20, offsetY: 10 },
    })

    const { style } = dom.anchor
    expect(style.position).toBe('absolute')
    expect(style.width).toBe('300px')
    expect(style.height).toBe('120px')
    // bottom-right anchors the ad's right/bottom edge to the host's. An
    // outward offset would escape the host, so containment wins and the
    // offset is clamped away: left = 1000 - 300, top = 500 - 120.
    expect(style.left).toBe('700px')
    expect(style.top).toBe('380px')
    expect(parseInt(style.left, 10) + parseInt(style.width, 10)).toBeLessThanOrEqual(1000)
    expect(parseInt(style.top, 10) + parseInt(style.height, 10)).toBeLessThanOrEqual(500)
  })

  it('honours an inward offset, which is how a publisher asks for a margin', async () => {
    const dom = installDom(makeHost(1000, 500))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, {
      size: { width: 300, height: 120 },
      position: { anchor: 'bottom-right', offsetX: -20, offsetY: -10 },
    })

    expect(dom.anchor.style.left).toBe('680px')
    expect(dom.anchor.style.top).toBe('370px')
  })

  it('shrinks to fit a host smaller than the requested size', async () => {
    const dom = installDom(makeHost(200, 70))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, { size: { width: 900, height: 600 } })

    expect(dom.anchor.style.width).toBe('200px')
    expect(dom.anchor.style.height).toBe('70px')
    expect(dom.anchor.style.left).toBe('0px')
    expect(dom.anchor.style.top).toBe('0px')
  })

  it('re-contains the ad when the host shrinks after first paint', async () => {
    const dom = installDom(makeHost(1000, 500))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, {
      size: { width: 400, height: 200 },
      position: { anchor: 'bottom-right' },
    })
    expect(dom.anchor.style.left).toBe('600px')

    // The viewport gets much smaller than the ad.
    dom.host.width = 150
    dom.host.height = 80
    dom.host.clientWidth = 150
    dom.host.clientHeight = 80
    dom.host.getBoundingClientRect = () => ({ width: 150, height: 80 })

    dom.resize.instances[0].emit()
    dom.raf.runAll()

    expect(dom.anchor.style.width).toBe('150px')
    expect(dom.anchor.style.height).toBe('80px')
    expect(dom.anchor.style.left).toBe('0px')
    expect(dom.anchor.style.top).toBe('0px')
    // Still no extra delivery: a resize is not a new request.
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
  })

  it('collapses a burst of resize notifications into one layout per frame', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client)

    for (let i = 0; i < 25; i += 1) dom.resize.instances[0].emit()
    expect(dom.raf.pending()).toBe(1)
    expect(dom.raf.runAll()).toBe(1)
    expect(dom.raf.pending()).toBe(0)
  })

  it('creates exactly one observer, not one per layout change', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, { size: { width: 200, height: 100 } })
    expect(dom.resize.instances).toHaveLength(1)
    expect(dom.io.instances).toHaveLength(1)
    expect(dom.resize.instances[0].observed).toEqual([dom.host])
  })
})

/* ------------------------------------------------------------------ */
/* dispose                                                             */
/* ------------------------------------------------------------------ */

describe('dispose()', () => {
  it('tears down the observer, the pending frame and the host mutation', async () => {
    const dom = installDom(makeHost(1000, 500, ''))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    const result = await renderOne(client, { size: { width: 200, height: 100 } })
    expect(dom.host.style.position).toBe('relative')

    // A resize arrives but the frame has not run yet.
    dom.resize.instances[0].emit()
    expect(dom.raf.pending()).toBe(1)

    result.dispose()

    expect(dom.resize.instances[0].disconnected).toBe(true)
    expect(dom.io.instances.at(-1)!.disconnected).toBe(true)
    expect(dom.raf.pending()).toBe(0)
    expect(dom.host.style.position).toBe('')
  })

  it('stops the viewability gate, so a late sighting records nothing', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd()),
    )
    const client = makeClient(fetchImpl)

    const result = await renderOne(client)
    const gate = dom.io.instances.at(-1)!

    // Half-visible before disposal must not be enough later.
    gate.emit([{ isIntersecting: true, intersectionRatio: 1 }])
    result.dispose()
    gate.emit([{ isIntersecting: true, intersectionRatio: 1 }])
    vi.advanceTimersByTime(2000)
    await vi.advanceTimersByTimeAsync(0)

    expect(countOf(fetchImpl, '/ads/impression')).toBe(0)
  })

  it('is idempotent and safe to call twice', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    const result = await renderOne(client)
    result.dispose()
    expect(() => result.dispose()).not.toThrow()
    expect(() => result.dispose()).not.toThrow()
    expect(dom.resize.instances[0].disconnected).toBe(true)
  })

  it('leaves a host that was already positioned exactly as it found it', async () => {
    const dom = installDom(makeHost(1000, 500, 'absolute'))
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    const result = await renderOne(client)
    expect(dom.host.style.position).toBe('absolute')
    result.dispose()
    expect(dom.host.style.position).toBe('absolute')
  })

  it('does not disturb the client, which stays usable after dispose', async () => {
    installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    const first = await renderOne(client)
    first.dispose()

    // Same client, same placement: the 60s cache answers, no new request.
    const second = await client.getAd('placement-1')
    expect(second?.requestId).toBe('req-1')
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
    expect((client as any).pendingEvents).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* request shape                                                       */
/* ------------------------------------------------------------------ */

describe('a rendered ad still reports only what it is entitled to', () => {
  it('sends the SDK version header and no invented accounting fields', async () => {
    installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))
    const client = makeClient(fetchImpl)

    await renderOne(client, { size: { width: 200, height: 100 } })

    const deliver = fetchImpl.calls.find((c) => c.url.endsWith('/ads/deliver'))!
    const keys = Object.keys(JSON.parse(deliver.init.body)).sort()
    expect(keys).toEqual(['placementKey', 'publisherKey', 'referrer', 'requestId', 'url'])
    const headerKeys = Object.keys(deliver.init.headers).map((k) => k.toLowerCase())
    expect(headerKeys).toContain(SDK_VERSION_HEADER.toLowerCase())
    expect(
      Object.entries(deliver.init.headers).find(
        ([k]) => k.toLowerCase() === SDK_VERSION_HEADER.toLowerCase(),
      )?.[1],
    ).toBe(SDK_VERSION)
    const body = JSON.parse(deliver.init.body)
    for (const forbidden of ['campaignId', 'advertiserId', 'publisherId', 'reward', 'amount', 'size', 'position']) {
      expect(Object.keys(body)).not.toContain(forbidden)
    }
  })
})
