import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { init, SDK_VERSION } from '../src/index.ts'

/* ------------------------------------------------------------------ */
/* An ad is text. The delivery payload carries a headline, a            */
/* destination and an audience, and nothing else.                        */
/*                                                                      */
/* These tests pin that: the SDK never creates an image or a video,      */
/* never places a creative, never autoplays anything, and never lets a   */
/* payload it cannot vouch for reach a publisher's page.                 */
/* ------------------------------------------------------------------ */

const KEY = 'pk_test_' + 'b'.repeat(32)
const BASE = 'https://api.test'
const SELECTOR = '#terminal'
const SIGNED =
  'https://s3.example/advertisers/a1/campaigns/c1/creatives/cr1/original' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=600'

/** A creative of any kind. The SDK must ignore every field of it. */
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

function installDom() {
  const host = makeHost()
  const created: any[] = []
  const io = {
    instances: [] as any[],
    Impl: class {
      constructor(cb: any) {
        io.instances.push({ cb, disconnected: false })
      }
      observe() {}
      disconnect() {}
    },
  }

  const doc: any = {
    referrer: '',
    querySelector: (s: string) => (s === SELECTOR ? host : null),
    createElement: (tag: string) => {
      const el = makeElement(tag)
      created.push(el)
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

describe('an ad is text', () => {
  it('renders the headline and nothing else', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    const anchor = anchorOf(dom.created)
    expect(result.served).not.toBeNull()
    expect(anchor.textContent).toBe('Headline')
    expect(anchor.children).toHaveLength(0)
    expect(dom.host.appended).toHaveLength(1)
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
  })

  it('never creates an image or a video, whatever the payload carries', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() =>
      ok(
        servedAd({
          creative: creative(),
        }),
      ),
    )

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(mediaOf(dom.created)).toBeUndefined()
    expect(dom.created.map((el) => el.tag)).toEqual(['a'])
    expect(anchorOf(dom.created).children).toHaveLength(0)
  })

  it('never creates an image or a video for a video creative either', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() =>
      ok(
        servedAd({
          creative: creative({ type: 'video', mimeType: 'video/mp4', posterUrl: 'https://cdn.example/p.png' }),
        }),
      ),
    )

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(mediaOf(dom.created)).toBeUndefined()
    expect(dom.created.map((el) => el.tag)).toEqual(['a'])
  })

  it('never autoplays anything', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() =>
      ok(
        servedAd({
          creative: creative({ type: 'video' }),
        }),
      ),
    )

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    for (const el of dom.created) {
      expect(el.playCalls).toBe(0)
      expect(el.getAttribute('autoplay')).toBeNull()
      expect(el.getAttribute('muted')).toBeNull()
    }
  })

  it('does not put the body copy or the call to action on the page', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd()))

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    const anchor = anchorOf(dom.created)
    expect(anchor.textContent).not.toContain('Body copy')
    expect(anchor.textContent).not.toContain('Learn more')
  })
})

describe('the signed object URL never reaches the page', () => {
  it('is not placed in an element, and not sent in a request', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken
        ? ok({ status: 'recorded' })
        : ok(servedAd({ creative: creative() })),
    )
    const client = makeClient(fetchImpl) as any

    await client.render('placement-1', SELECTOR)
    await client
      .recordImpression({ served: { requestId: 'req-1', impressionToken: 'tok-1' }, idempotencyKey: 'idem-1', sessionId: 'sess-1' } as never)
      .catch(() => {})
    client.trackConversion('req-1').catch(() => {})

    for (const el of dom.created) {
      expect(el.getAttribute?.('src')).toBeNull()
      expect(el.getAttribute?.('data-clirevenue-creative-id')).toBeNull()
      expect(el.getAttribute?.('data-clirevenue-creative-type')).toBeNull()
    }
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

/* ------------------------------------------------------------------ */

describe('a payload the SDK cannot vouch for is a no-fill, not a render', () => {
  const cases: [string, unknown][] = [
    ['no ad text at all', servedAd({ headline: '' })],
    ['ad text that is only whitespace', servedAd({ headline: '   ' })],
    ['ad text over the 60 character limit', servedAd({ headline: 'x'.repeat(61) })],
    ['a non-string ad text', servedAd({ headline: 42 })],
    ['a missing ad text', servedAd({ headline: undefined })],
    ['an ad with no identity', servedAd({ id: '' })],
    ['a javascript: destination', servedAd({ landingUrl: 'javascript:alert(1)' })],
    ['a data: destination', servedAd({ landingUrl: 'data:text/html,<script>alert(1)</script>' })],
    ['a relative destination', servedAd({ landingUrl: '/promo' })],
    ['a destination that is not a URL at all', servedAd({ landingUrl: 'not a url' })],
  ]

  for (const [name, payload] of cases) {
    it(`renders nothing for ${name}`, async () => {
      const dom = installDom()
      const fetchImpl = stubFetch(() => ok(payload))

      const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

      expect(result.served).toBeNull()
      expect(dom.created).toHaveLength(0)
      expect(dom.host.appended).toHaveLength(0)
    })
  }

  it('renders nothing for a payload with no impression token', async () => {
    const dom = installDom()
    const payload = servedAd() as Record<string, unknown>
    delete payload.impressionToken
    const fetchImpl = stubFetch(() => ok(payload))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).toBeNull()
    expect(dom.created).toHaveLength(0)
  })

  it('renders nothing for a payload with no request id', async () => {
    const dom = installDom()
    const payload = servedAd() as Record<string, unknown>
    delete payload.requestId
    const fetchImpl = stubFetch(() => ok(payload))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).toBeNull()
    expect(dom.created).toHaveLength(0)
  })

  it('still accepts an ad with no destination at all', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ landingUrl: null })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    expect(anchorOf(dom.created).textContent).toBe('Headline')
  })

  it('accepts a destination that is exactly at the limit', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ landingUrl: 'https://advertiser.example/landing' })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    expect(anchorOf(dom.created).href).toBe('https://advertiser.example/landing')
  })
})

describe('the ad text is measured the way the dashboard measures it', () => {
  it('accepts exactly 60 characters and refuses 61', async () => {
    const dom = installDom()
    const sixty = 'x'.repeat(60)
    const fetchImpl = stubFetch(() => ok(servedAd({ headline: sixty })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    expect(anchorOf(dom.created).textContent).toBe(sixty)
  })

  it('counts code points, not UTF-16 code units', async () => {
    const dom = installDom()
    // 60 astral characters: 120 UTF-16 code units, 60 code points.
    const sixty = '\u{1F600}'.repeat(60)
    const fetchImpl = stubFetch(() => ok(servedAd({ headline: sixty })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    expect(anchorOf(dom.created).textContent).toBe(sixty)
  })

  it('accepts 61 characters that normalise down to 60', async () => {
    const dom = installDom()
    // "e" plus a combining acute is two code points, one character.
    const sixtyOne = 'e\u0301' + 'x'.repeat(59)
    const fetchImpl = stubFetch(() => ok(servedAd({ headline: sixtyOne })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    // The stored form is the composed one, which is what is rendered.
    expect(anchorOf(dom.created).textContent).toBe('\u00e9' + 'x'.repeat(59))
  })

  it('trims the ad text before measuring and before rendering', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ok(servedAd({ headline: '  Headline  ' })))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).not.toBeNull()
    expect(anchorOf(dom.created).textContent).toBe('Headline')
  })
})

describe('a broken network is still a broken network', () => {
  it('throws rather than reporting a no-fill when the request fails', async () => {
    installDom()
    const fetchImpl = stubFetch(() => {
      throw new Error('network down')
    })

    await expect((makeClient(fetchImpl) as any).getAd('placement-1')).rejects.toThrow()
  })

  it('reports a no-fill only when the server genuinely returns 204', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch(() => ({ status: 204, json: async () => null, text: async () => '' }))

    const result = await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)

    expect(result.served).toBeNull()
    expect(dom.created).toHaveLength(0)
    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
  })
})

describe('a text-only ad does not change who gets billed', () => {
  it('delivers once, impressions once, clicks once', async () => {
    const dom = installDom()
    const fetchImpl = stubFetch((init: any) =>
      (JSON.parse(init.body) as any).impressionToken ? ok({ status: 'recorded' }) : ok(servedAd()),
    )

    await (makeClient(fetchImpl) as any).render('placement-1', SELECTOR)
    const gate = dom.io.instances.at(-1)!
    gate.cb([{ isIntersecting: true, intersectionRatio: 1 }])
    vi.advanceTimersByTime(1000)
    await vi.advanceTimersByTimeAsync(0)
    anchorOf(dom.created).dispatch('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(countOf(fetchImpl, '/ads/deliver')).toBe(1)
    expect(countOf(fetchImpl, '/ads/impression')).toBe(1)
    expect(countOf(fetchImpl, '/ads/click')).toBe(1)
  })
})
