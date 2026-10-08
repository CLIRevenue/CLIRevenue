import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { init, SDK_VERSION } from '../src/index.ts'

/* ------------------------------------------------------------------ */
/* A creative is the one part of an ad that is *bytes*. Everything else */
/* the SDK renders is text it was handed. So these tests are mostly about */
/* the boundary between the two: an asset may be placed, a broken or    */
/* hostile one may not stop the ad, and the signed URL that unlocks it   */
/* may never travel anywhere except into the element that shows it.      */
/* ------------------------------------------------------------------ */

const KEY = 'pk_test_' + 'b'.repeat(32)
const BASE = 'https://api.test'
const SELECTOR = '#terminal'
const SIGNED =
  'https://s3.example/advertisers/a1/campaigns/c1/creatives/cr1/original' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=600'

function creative(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cr-1',
    type: 'image',
    mimeType: 'image/png',
    url: SIGNED,
    width: 1200,
    height: 628,
    ...overrides,
  }
}

function servedAd(adOverrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    ad: {
      id: 'ad-1',
      name: 'Spring sale',
      headline: 'Headline',
      description: 'Body copy',
      cta: 'Learn more',
      audience: 'backend',
      landingUrl: 'https://advertiser.example/landing',
      ...adOverrides,
    },
    impressionToken: 'tok-1',
    expiresAt: '2099-01-01T00:00:00Z',
  }
}

function ok(body: unknown) {
  return { status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

function stubFetch(handler: (init: any, url: string) => unknown) {
  const calls: { url: string; init: any }[] = []
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, init })
    return handler(init, url)
  }
  impl.calls = calls
  return impl
}

const countOf = (f: { calls: { url: string }[] }, path: string) =>
  f.calls.filter((c) => c.url.includes(path)).length

/* --- DOM stubs ------------------------------------------------------ */

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

/**
 * An element that models the handful of things creative placement touches:
 * attributes, a child list that keeps insertion order, and a settable
 * `firstChild`. `insertBefore` is intentionally a separate method from
 * `appendChild` so a test can remove it and prove the ad survives.
 */
function makeElement(tag: string) {
  const el: any = {
    tag,
    attributes: {} as Record<string, string>,
    style: makeStyle(),
    listeners: {} as Record<string, number>,
    children: [] as any[],
    textContent: '',
    href: '',
    muted: false,
    loop: false,
    playsInline: false,
    preload: '',
    playCalls: 0,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null
    },
    addEventListener(type: string, fn: () => void) {
      this.listeners[type] = (this.listeners[type] ?? 0) + 1
      this[`_on_${type}`] = fn
    },
    dispatch(type: string) {
      this[`_on_${type}`]?.()
    },
    appendChild(child: any) {
      this.children.push(child)
      return child
    },
    insertBefore(child: any, reference: any) {
      const at = reference === null || reference === undefined ? 0 : this.children.indexOf(reference)
      this.children.splice(at < 0 ? 0 : at, 0, child)
      return child
    },
    play() {
      this.playCalls += 1
      return Promise.resolve()
    },
  }
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] ?? null })
  return el
}

function makeHost() {
  return {
    width: 1200,
    height: 800,
    position: '',
    style: makeStyle(),
    appended: [] as unknown[],
    clientWidth: 1200,
    clientHeight: 800,
    getBoundingClientRect: () => ({ width: 1200, height: 800 }),
    appendChild(child: unknown) {
      this.appended.push(child)
    },
  }
}

function installDom(opts: { noInsertBefore?: boolean } = {}) {
  const host = makeHost()
  const created: any[] = []
  const io = { instances: [] as any[], Impl: class { constructor(cb: any) { io.instances.push({ cb, disconnected: false }) } observe() {} disconnect() {} } }

  const doc: any = {
    referrer: '',
    querySelector: (s: string) => (s === SELECTOR ? host : null),
    createElement: (tag: string) => {
      const el = makeElement(tag)
      created.push(el)
      if (opts.noInsertBefore) delete el.insertBefore
      return el
    },
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('getComputedStyle', () => ({ position: 'static' }))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', io.Impl as never)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('location', { href: 'https://publisher.example/page' })
  return { host, created, io }
}

function makeClient(fetchImpl: unknown) {
  return init(KEY, {
    baseUrl: BASE,
    fetchImpl: fetchImpl as never,
    sleep: async () => {},
    random: () => 0.5,
    storage: null,
  })
}

/** The anchor render() builds, i.e. the only 'A' element it created. */
const anchorOf = (created: any[]) => created.find((el) => el.tag === 'a')
const mediaOf = (created: any[]) => created.find((el) => el.tag === 'img' || el.tag === 'video')

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ */

describe('image creatives', () => {
  it('places the asset inside the clickable anchor, ahead of the headline', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: creative() })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    const anchor = anchorOf(dom.created)
    const img = mediaOf(dom.created)
    expect(result.served).not.toBeNull()
    expect(img.tag).toBe('img')
    expect(img.getAttribute('src')).toBe(SIGNED)
    expect(img.getAttribute('data-clirevenue-creative-id')).toBe('cr-1')
    expect(img.getAttribute('data-clirevenue-creative-type')).toBe('image')
    expect(img.getAttribute('data-clirevenue-creative-mime')).toBe('image/png')
    // Decorative: the anchor's text is the accessible name.
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(anchor.children).toContain(img)
    expect(anchor.children.indexOf(img)).toBe(0)
    // The headline survives as the fallback and the accessible name.
    expect(anchor.textContent).toBe('Headline')
    // An image never autoplays.
    expect(img.playCalls).toBe(0)
  })

  it('does not force dimensions the server did not send', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() =>
      ok(servedAd({ creative: creative({ width: null, height: null }) })),
    )

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    const img = mediaOf(dom.created)
    expect(img.getAttribute('width')).toBeNull()
    expect(img.getAttribute('height')).toBeNull()
  })
})

describe('video creatives', () => {
  const video = (overrides: Record<string, unknown> = {}) =>
    creative({
      type: 'video',
      mimeType: 'video/mp4',
      durationMs: 15000,
      posterUrl: 'https://cdn.example/poster.png',
      ...overrides,
    })

  it('uses muted, inline, looping autoplay -- the only settings a browser permits', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: video() })))

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    const v = mediaOf(dom.created)
    expect(v.tag).toBe('video')
    expect(v.getAttribute('src')).toBe(SIGNED)
    expect(v.muted).toBe(true)
    expect(v.playsInline).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.getAttribute('autoplay')).toBe('')
    expect(v.getAttribute('muted')).toBe('')
    expect(v.getAttribute('playsinline')).toBe('')
    // Streamed, not downloaded: a single object must never be preloaded whole.
    expect(v.preload).toBe('metadata')
    expect(v.getAttribute('preload')).toBe('metadata')
    expect(v.getAttribute('poster')).toBe('https://cdn.example/poster.png')
    expect(v.getAttribute('width')).toBe('1200')
    expect(v.getAttribute('height')).toBe('628')
  })

  it('omits the poster attribute when the server had no poster', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: video({ posterUrl: null }) })))

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(mediaOf(dom.created).getAttribute('poster')).toBeNull()
  })

  it('asks the player to start only once the element is in the document', async () => {
    const dom = installDom()
    let playSawDocument = false
    vi.stubGlobal('document', {
      ...(globalThis as any).document,
      createElement: (tag: string) => {
        const el = makeElement(tag)
        dom.created.push(el)
        if (tag === 'video') {
          el.play = () => {
            playSawDocument = dom.host.appended.length > 0
            el.playCalls += 1
            return Promise.resolve()
          }
        }
        if (tag === 'a') delete el.insertBefore
        return el
      },
    })
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: video() })))

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(playSawDocument).toBe(true)
    expect(mediaOf(dom.created).playCalls).toBe(1)
  })

  it('swallows a refused autoplay: the ad still renders and still earns an impression', async () => {
    const dom = installDom()
    vi.stubGlobal('document', {
      referrer: '',
      querySelector: (s: string) => (s === SELECTOR ? dom.host : null),
      createElement: (tag: string) => {
        const el = makeElement(tag)
        if (tag === 'video') el.play = () => Promise.reject(new Error('NotAllowedError'))
        return el
      },
    })
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd({ creative: video() })),
    )

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)
    expect(result.served).not.toBeNull()

    const gate = dom.io.instances.at(-1)!
    gate.cb([{ isIntersecting: true, intersectionRatio: 1 }])
    vi.advanceTimersByTime(1000)
    await vi.advanceTimersByTimeAsync(0)

    // Viewability, not playback, is what earns the impression.
    expect(countOf(fetchImpl, '/ads/impression')).toBe(1)
  })

  it('survives a play() that throws synchronously', async () => {
    const dom = installDom()
    vi.stubGlobal('document', {
      referrer: '',
      querySelector: (s: string) => (s === SELECTOR ? dom.host : null),
      createElement: (tag: string) => {
        const el = makeElement(tag)
        if (tag === 'video') el.play = () => { throw new Error('no') }
        return el
      },
    })
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: video() })))

    await expect((makeClient(fetchImpl) as any).render('placement-1', SELECTOR)).resolves.toBeTruthy()
  })
})

describe('a creative that cannot be placed is never a failed ad', () => {
  const cases: [string, unknown][] = [
    ['no creative at all', undefined],
    ['an explicit null', null],
    ['a type the SDK does not implement', creative({ type: 'html' })],
    ['a type the SDK has never heard of', creative({ type: 'application/x-shockwave-flash' })],
    ['an empty url', creative({ url: '' })],
    ['a whitespace url', creative({ url: '   ' })],
    ['a non-string url', creative({ url: null })],
  ]

  for (const [name, value] of cases) {
    it(`renders text-only for ${name}`, async () => {
      const dom = installDom()
      const fetchImpl = stubFetch(() => ok(servedAd({ creative: value })))

      const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

      const anchor = anchorOf(dom.created)
      expect(result.served).not.toBeNull()
      expect(anchor.children).toHaveLength(0)
      expect(anchor.textContent).toBe('Headline')
      expect(dom.host.appended).toHaveLength(1)
      expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
    })
  }

  it('falls back to text when the host cannot take children', async () => {
    const dom = installDom({ noInsertBefore: true })
    const fetchImpl = stubFetch(() => ok(servedAd({ creative: creative() })))

    await expect((makeClient(fetchImpl) as any).render('placement-1', SELECTOR)).resolves.toBeTruthy()
    expect(anchorOf(dom.created).textContent).toBe('Headline')
  })

  it('renders nothing and sends nothing extra when the gateway returns no fill', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ({ status: 204, json: async () => null, text: async () => '' }))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).toBeNull()
    expect(dom.created).toHaveLength(0)
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
  })
})

describe('the signed object URL stays in the element', () => {
  it('is never included in a delivery, impression, click or telemetry request', async () => {
    installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd({ creative: creative() })),
    )
    const client = makeClient(fetchImpl) as any

    await client.render('placement-1', SELECTOR)
    await client.recordImpression({ served: { requestId: 'req-1', impressionToken: 'tok-1' }, idempotencyKey: 'idem-1', sessionId: 'sess-1' } as never).catch(() => {})
    client.trackConversion('req-1').catch(() => {})

    for (const call of fetchImpl.calls) {
      const body = String(call.init?.body ?? '')
      expect(body).not.toContain('X-Amz-Signature')
      expect(body).not.toContain('X-Amz-Credential')
      expect(body).not.toContain('/creatives/')
    }
    // The SDK version travels in a header, as it always has.
    expect(fetchImpl.calls[0].init.headers['X-CLIRevenue-SDK-Version']).toBe(SDK_VERSION)
  })
})

describe('a creative does not change who gets billed', () => {
  it('delivers once, impressions once, clicks once -- with or without an asset', async () => {
    for (const [name, creativeValue] of [
      ['text-only', undefined],
      ['image', creative()],
      ['video', creative({ type: 'video', mimeType: 'video/webm' })],
    ] as [string, unknown][]) {
      const dom = installDom()
      const fetchImpl = stubFetch((init: any) =>
        (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd({ creative: creativeValue })),
      )

      await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)
      const gate = dom.io.instances.at(-1)!
      gate.cb([{ isIntersecting: true, intersectionRatio: 1 }])
      vi.advanceTimersByTime(1000)
      await vi.advanceTimersByTimeAsync(0)
      anchorOf(dom.created).dispatch('click')
      await vi.advanceTimersByTimeAsync(0)

      expect(countOf(fetchImpl, '/ads/deliver'), name).toBe(1)
      expect(countOf(fetchImpl, '/ads/impression'), name).toBe(1)
      expect(countOf(fetchImpl, '/ads/click'), name).toBe(1)
    }
  })
})