# SDK

## What the SDK is

`@clirevenue/sdk` is the browser-side client for CLIRevenue. It asks the
gateway for an ad, hands you something to render, and counts the impression
once the ad is genuinely viewable.

It does not know what a campaign is. It does not know what a payout is. It
cannot decide who gets credit for anything. It reports to the server that a
specific ad was shown to a specific browser, and the server decides what
that means.

## The public surface

```js
import { init, CLIRevenueError } from '@clirevenue/sdk'
```

The ambient exports are:

| Export | Kind | Meaning |
|---|---|---|
| `init(publisherKey, options?)` | function | Create a client. Throws `CLIRevenueConfigError` for a malformed key. |
| `CLIRevenue` | class | The client instance returned by `init`. |
| `CLIRevenueError` | class | Base error all SDK errors extend. |
| `CLIRevenueConfigError` | class | Bad key / missing selector / unknown placement. |
| `CLIRevenueTimeoutError` | class | A request exceeded `timeoutMs`. |
| `CLIRevenueNetworkError` | class | The request never reached the gateway. |
| `CLIRevenueHttpError` | class | The gateway answered 4xx/5xx. Carries `.status` and `.body`. |
| `ServedAd` | type | The value `getAd()` / `render()` can return. |
| `CLIRevenueOptions` | type | The options accepted by `init()`. |

Constants:

| Export | Value |
|---|---|
| `SDK_VERSION` | The published version, e.g. `"1.0.0"`. |
| `SDK_VERSION_HEADER` | `"X-CLIRevenue-SDK-Version"`. |
| `DEFAULT_BASE_URL` | `"https://api.clirevenue.com"`. Point `baseUrl` at your own deployment. |

## Initialize

```js
const clirevenue = init(publisherKey, options?)
```

`publisherKey` is your **publishable** key: `pk_test_…` or `pk_live_…`. It is
public by design — it identifies the publisher and nothing more.

`options` is optional:

| Option | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://api.clirevenue.com` | Gateway base URL. Point this at your own deployment. |
| `timeoutMs` | `8000` | Per-request timeout. |
| `maxRetries` | `2` | Retries for retryable failures (5xx and network errors). |
| `retryBaseMs` | `300` | Base delay for exponential backoff. |
| `retryMaxMs` | `4000` | Ceiling for a single backoff delay. |
| `ObserverImpl` | ambient `IntersectionObserver` | Override for tests or exotic environments. |

A malformed key throws `CLIRevenueConfigError` **before any network request**
is made:

```js
init('not-a-key') // CLIRevenueConfigError
```

`init` returns a single `CLIRevenue` instance. Create it once per page.

## Requesting an ad

```js
const served = await clirevenue.getAd('home-feed')
```

`getAd` POSTs to `{baseUrl}/ads/deliver` with the publisher key, the
placement key, the page URL, the referrer and a requestId the SDK generates
for you. It returns either a `ServedAd` or `null`.

```ts
type ServedAd = {
  requestId: string         // SDK-generated id for this serve
  impressionToken: string   // proves this browser may report the impression
  expiresAt: string         // after this, the serve is no longer countable
  ad: {
    id: string
    name: string | null     // advertiser
    headline: string
    description: string | null
    cta: string | null
    audience: string | null
    landingUrl: string | null // the only destination you should link to; may be absent
  }
}
```

Only `id` and `headline` are guaranteed non-null on `ad`. Treat `name`,
`description`, `cta` and `landingUrl` as optional: when `landingUrl` is
`null` there is no destination, so render the call to action as a
non-navigating control rather than linking to a fallback.

Two things the SDK deliberately does not give you: a campaignId you could
attribute to yourself, and a price. Attribution and pricing live on the
server.

Responses are cached for 60 seconds per placement key, so calling `getAd`
again for the same placement in the same page session returns the same
serve without another round trip.

## Rendering with the SDK

`render` does the boring part: it builds an anchor to the ad's real
destination, wires the click, and starts the viewability watch.

```js
const { served, dispose } = await clirevenue.render('home-feed', '#ad-slot', { size, position })

if (!served) {
  // No fill. Show your own fallback.
}
```

`render()` takes an optional third argument, `layout`, which controls the
size and position of the rendered ad. All geometry stays inside the host
element. See [Layout](configuration.md#layout) for the full object shape.

The element you pass is populated with a link whose text is the ad headline
and whose `href` is `served.ad.landingUrl`. The SDK adds
`data-clirevenue-request-id` to the anchor so you can style or find it.

Call `dispose()` when you remove the slot. It stops the viewability observer.
If you never call it, call `destroy()` — see below.

## Custom rendering

If you want your own markup, do not use `render`. Request the ad, render it
yourself, and hand the SDK the element to watch:

```js
const served = await clirevenue.getAd('home-feed')

if (served) {
  const slot = document.querySelector('#ad-slot')
  slot.innerHTML = `
    <a href="${served.ad.landingUrl}" class="my-ad">
      <strong>${served.ad.headline}</strong>
      <span>${served.ad.description}</span>
      <em>${served.ad.cta}</em>
    </a>
  `

  const link = slot.querySelector('a')

  // 1. The click is a real navigation to the served destination.
  link.addEventListener('click', () => {
    // Fire-and-forget: never block the browser from navigating.
    void clirevenue.recordClick(served).catch(() => {})
  })

  // 2. Watch for viewability on the slot.
  const stopWatching = clirevenue.watchViewability(served, slot)

  // 3. When the slot goes away, stop watching. dispose() is idempotent.
  // stopWatching()
}
```

That is the whole contract. Notice what is missing: you never send an
impression by hand, and you never tell the server who the advertiser is.

> If you escape HTML by string interpolation, you own that. `landingUrl` and
> `headline` come from your advertiser. Sanitise or use `textContent`.

---

## Layout

The SDK owns the geometry of every ad. It reads a size and a position plus
the measured box of the host element, and returns the resolved pixel box
the ad should occupy. The layout object is the only way to influence that
geometry.

```ts
type AdSize = {
  width: number
  height: number
}

type AdPosition = {
  anchor: AdAnchor
  offsetX: number
  offsetY: number
}

type AdLayoutInput = {
  size?: Partial<AdSize> | null
  position?: Partial<AdPosition> | null
}
```

### Size limits

| Limit | Value |
|---|---|
| Minimum width | `120` |
| Minimum height | `60` |
| Maximum width | `1280` |
| Maximum height | `1024` |
| Default width | `320` |
| Default height | `100` |
| Maximum offset magnitude | `512` |

### Anchor

The SDK supports nine anchors:

```text
top-left
top-center
top-right
center-left
center
center-right
bottom-left
bottom-center
bottom-right
```

An unknown anchor is not an error — it degrades to `center`, which is the
least surprising thing to render when the SDK cannot tell what was meant.

### Offset behaviour

Offsets are clamped to `±512` px. A caller that asks for a larger offset
gets the clamped value rather than an error. Real numbers are rounded to
whole pixels; non-finite values fall back to `0` for the offset.

### Containment

The final resolved box is always intersected with the host element's box.
No offset, however large, in either direction, can push the ad outside its
host. The SDK, not the caller, is responsible for containment:

1. the request is normalised,
2. the size is shrunk to fit the host,
3. the anchor is placed inside the free space,
4. the offset is applied,
5. the result is pulled back inside the host.

Steps 2 and 5 are what make the SDK own containment. Step 5 guarantees
`left`/`top` are never negative and never exceed the host, which keeps the
ad out of the surrounding layout.

### ResizeObserver re-containment

When the host changes size, the SDK re-contains the ad via a `ResizeObserver`
so the ad cannot overflow its host before the publisher notices. `dispose()`
is idempotent: calling it more than once is a no-op, and every rotation of
the ad is disposed by the same single disposer.

## React

Wrap the client once, then use the methods directly.

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { init } from '@clirevenue/sdk'

// At module scope, or in a context provider.
const cli = init(import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY)

export function AdSlot({ placementKey }) {
  const hostRef = useRef(null)
  const [state, setState] = useState('loading')
  const [served, setServed] = useState(null)
  const [failure, setFailure] = useState(null)

  useEffect(() => {
    let live = true
    setState('loading')

    cli.getAd(placementKey)
      .then((result) => {
        if (!live) return
        setServed(result)
        setState(result ? 'ready' : 'nofill')
      })
      .catch((error) => {
        if (!live) return
        setFailure(error)
        setState('error')
      })

    return () => {
      live = false
    }
  }, [placementKey])

  useEffect(() => {
    const node = hostRef.current
    if (!served || !node) return
    return cli.watchViewability(served, node)
  }, [served])

  if (state === 'loading') return <div className="ad-slot">Loading…</div>
  if (state === 'nofill') return <div className="ad-slot">No ad for this slot right now.</div>
  if (state === 'error') return <div className="ad-slot">Ad unavailable.</div>

  return (
    <div className="ad-slot" ref={hostRef}>
      <a href={served.ad.landingUrl} onClick={() => void cli.recordClick(served).catch(() => {})}>
        <strong>{served.ad.headline}</strong>
        <span>{served.ad.description}</span>
        <em>{served.ad.cta}</em>
      </a>
    </div>
  )
}
```

## Layout in practice

A complete `render()` call with explicit geometry:

```js
const { served, dispose } = await clirevenue.render(
  'console-workbench',
  '#slot',
  {
    size: { width: 300, height: 90 },
    position: { anchor: 'bottom-right', offsetX: -16, offsetY: -16 },
  },
)
```

If a size or position field is omitted or unusable, the SDK normalises it:
numbers are clamped to the size band, non-finite values fall back to the
default, and an unknown anchor falls back to `center`. The result is
effected the one time, and `dispose()` is the idempotent way to undo the
viewability watch later.

The client holds a per-page `sessionId`, an IntersectionObserver, an
offline queue handle and an `online` listener. If your app replaces the page
without a real navigation — a client-side router, a modal-driven ad view, a
view that unmounts — call `destroy()` when you are finished with the client:

```js
clirevenue.destroy()
```

`destroy()` disposes observers and removes the global `online` listener. It
is safe to call more than once. After `destroy()`, create a new client with
`init()`.

`pendingEvents` tells you whether anything is still waiting to be flushed:

```js
clirevenue.pendingEvents // 0
```

## No fill is normal

`getAd()` returns `null` when the gateway answers with **HTTP 204 No
Content**. That is a successful outcome, not an exception, and it is never
retried:

```js
const served = await clirevenue.getAd('home-feed')

if (served === null) {
  renderHouseAd()   // correct
  return
}

renderAd(served)
```

No-fill is never retried, never throws, and never records anything. Show
your fallback. Do not show an error message for it.

## Error handling

Every error the SDK raises extends `CLIRevenueError` and carries a `.name`:

| Class | Raised when |
|---|---|
| `CLIRevenueConfigError` | Bad publisher key, missing placement key, unknown selector, unknown request id. |
| `CLIRevenueTimeoutError` | A request exceeded `timeoutMs`. |
| `CLIRevenueNetworkError` | The request never reached the gateway (offline, DNS, blocked). |
| `CLIRevenueHttpError` | The gateway answered with a 4xx or 5xx. Carries `.status` and `.body`. |

```js
import { init, CLIRevenueHttpError } from '@clirevenue/sdk'

try {
  const served = await clirevenue.getAd('home-feed')
  if (!served) renderHouseAd()
  else renderAd(served)
} catch (error) {
  if (error instanceof CLIRevenueHttpError) {
    // A 4xx is a configuration / inventory problem, not a transient one.
    if (error.status === 403) renderDisabledSlot()
    else renderHouseAd()
  } else {
    renderHouseAd()
  }
}
```

**Never let an ad failure break the page.** Every ad surface you ship
degrades to your own fallback in a `catch`.

## Timeouts and retries

- Every request has a timeout (`timeoutMs`, default 8s). A request that
  exceeds it rejects with `CLIRevenueTimeoutError`.
- Retryable failures are retried: **5xx responses and network errors**.
  **4xx responses are never retried** — a rejected publisher key or an
  unknown placement will fail identically every time.
- Backoff is exponential with **full jitter** and is capped (`retryMaxMs`),
  so a burst of clients does not synchronise into a thundering herd.
- Each serve keeps **one idempotency key across all of its retries**, so a
  retried `getAd` cannot create two serves.
- Impression, click and conversion requests carry an idempotency key too.
  Replaying one is safe: the server answers `status: 'duplicate'` rather
  than double-counting.

## Viewability: when an impression counts

An impression is not "the SDK returned an ad". It is "a human could
reasonably have seen it".

An impression is recorded only when **both** of these are true:

1. At least **50%** of the slot's area is inside the viewport.
2. It has stayed that way for at least **1 second**.

After that, it fires **once**. Scrolling the slot back into view does not
count it again. `watchViewability()` returns a disposer; call it when the
slot is removed, so an impression cannot land on an element that is already
gone.

```js
const stop = clirevenue.watchViewability(served, element)
// later
stop()
```

If the environment has no `IntersectionObserver`, the SDK logs a warning and
records nothing. It will not guess that an impression happened.

## Clicks

`recordClick(served)` reports the click to `/ads/click` with the serve's
`requestId`, `impressionToken` and an idempotency key.

```js
link.addEventListener('click', () => {
  void clirevenue.recordClick(served).catch(() => {})
})
```

Two rules:

- **Let the navigation happen.** Do not `preventDefault()`, do not `await`
  before navigating. A click report that fails must not stop a user reaching
  the site they clicked. The SDK swallows tracking errors for exactly this
  reason.
- **Use `served.ad.landingUrl`** as the destination. It comes from the
  server's response and is the only link the SDK considers legitimate.

`/ads/click` requires an impression first. A click with no recorded
impression is rejected with `CLICK_WITHOUT_IMPRESSION`. The SDK does not
reorder or fake this.

## Conversions are server-side

`trackConversion(requestId)` exists in the SDK for completeness, but a
browser is the wrong place to call it and it will normally fail:

```js
// In the browser: do not do this.
await clirevenue.trackConversion(requestId)
```

A conversion means money, and money that a third party can trigger just by
loading a page. So conversion reporting happens on **your server**, where
you hold credentials the browser never sees. Treat the browser SDK as a
**reporting tool** for events you can honestly observe (an ad was shown, an
ad was clicked), and your server as the only place where meaning is
assigned.

## Offline behaviour

If an impression or click cannot be delivered, the SDK queues it in
`sessionStorage` rather than dropping it.

- The queue is capped at **100 events**. Oldest events are dropped first.
- Events are replayed automatically when the browser fires `online`.
- `flush()` replays immediately and reports what happened:
  ```js
  const { sent, failed } = await clirevenue.flush()
  ```
- `pendingEvents` is the current queue depth.

Ad **requests** are not queued. If the network is down, `getAd()` rejects
with `CLIRevenueNetworkError` and you show your fallback. Queuing an ad
request would mean serving an ad that was never actually delivered.

## Privacy model

What the SDK stores, exhaustively:

| Store | Used for | Lifetime |
|---|---|---|
| Memory | in-memory placement cache (60s), `sessionId`, queued-event buffer | This page view |
| `sessionStorage` | the offline event queue, keyed by publisher key + base URL | This tab |

What the SDK does **not** do:

- No cookies.
- No `localStorage`.
- No IndexedDB.
- No cross-site identifiers, no fingerprinting, no device or browser
  enumeration.
- No PII in any request body. No name, no email, no user id.
- No third-party requests. The SDK talks to `baseUrl` and nowhere else.
- No tracking pixels, no fingerprint scripts, no third-party analytics.

## Security model

- **The browser proves nothing about itself.** The gateway trusts the
  publisher key for which ads you may request, and the `impressionToken`
  for which serve may be counted. Neither can be forged without the
  server's signing secret, which never leaves the server.
- **Impressions are double-gated** — you must hold a valid, unexpired token
  and satisfy the viewability rule — so a script that fabricates a `getAd`
  loop cannot invent impressions out of nothing.
- **Idempotency everywhere.** Every mutating call carries a key, so a retry,
  a double-click, or a React double-effect cannot inflate your own numbers.
- **No accounting in the client.** The browser cannot report a reward
  amount, a campaign id, an advertiser id, or a publisher id. It reports
  `requestId`, `impressionToken`, `sessionId` and an idempotency key — never
  anything that carries money.
- **Expires.** `expiresAt` bounds how long a serve stays countable, so a
  cached impression cannot be replayed indefinitely.
- **Publishable keys are scoped.** A publisher key can request ads and
  report events. It cannot create publishers, issue or revoke keys, create
  placements, read performance data, or report conversions.

## Gateway endpoints

The SDK uses exactly four endpoints. All are `POST`, and all take the
publisher key in the request body.

| Endpoint | Body | Success | No-fill |
|---|---|---|---|
| `/ads/deliver` | `publisherKey`, `placementKey`, `url`, `referrer`, `requestId` | `200` `{requestId, ad, impressionToken, expiresAt}` | `204` |
| `/ads/impression` | `publisherKey`, `requestId`, `impressionToken`, `idempotencyKey`, `sessionId`, `cliIntegration?` | `200` | — |
| `/ads/click` | `publisherKey`, `requestId`, `impressionToken`, `idempotencyKey` | `200` | — |
| `/ads/conversion` | server-authenticated only | `200` | — |

`placementKey` is required on `/ads/deliver`. An unknown placement is
`400 INVALID_PLACEMENT`; a disabled placement is `403`.
