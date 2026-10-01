# FAQ

## What is CLIRevenue?

An advertising slot that lives above a CLI's command line, and shares what
it earns with the developer who runs it. A dedicated region of the
interface reserves the slot, and the host output is untouched.

## What does the SDK do?

It asks the CLIRevenue gateway for an ad, hands you something to render, and
counts the impression once the ad is genuinely viewable. It is a reporting
tool: it reports — it assigns meaning.

## Is the SDK free to install?

Yes. It is an npm package with no runtime dependencies. There is no install
fee; commercial terms are not fixed and this documentation makes none.

## What is a publishable key?

A public identifier, shaped like `pk_test_…` or `pk_live_…`, that
authorises an integration to request delivery and report events. It is not
a credential.

## Is a secret API key required in the browser?

No. A publishable key is safe in the bundle by design. Secrets — the
Supabase service-role key, `AD_TOKEN_SECRET`, `SETTLEMENT_SECRET` — live
server-side only.

## What is a placement?

A named ad surface chosen by the publisher when a placement is created on
the server. You render ads per placement key, which is your own readable
slug.

## Can I resize the ad?

Yes. Use the layout object on `render()` to request a size and an anchor.
The SDK owns the geometry and keeps the ad contained by its host: any size
is clamped to the band, any offset is clamped to ±512 px, and the final
box always stays inside the host container.

## Can I move the ad?

Only through the placement's position configuration. The SDK resolves the
final box against the host and refuses overflow.

## Can the ad leave my terminal container?

No. The resolved box is intersected with the host element's box, so an ad
cannot overflow its container.

## What happens when there are no ads?

`getAd()` returns `null`. That is a normal, successful outcome and is never
retried. Render your own fallback.

## What happens when the network is unavailable?

`getAd()` rejects with `CLIRevenueNetworkError` and you show your fallback.
Ad requests are not queued. Impressions and clicks are queued and replayed,
and the SDK flushes them when it comes back online.

## How are impressions recorded?

Once per served ad, after at least 50% of the element has been on screen
for one second. The browser watches viewability; the server is authoritative.

## How are clicks recorded?

`recordClick(served)` reports the click with the serve's `requestId` and
`impressionToken`. It is fire-and-forget so it cannot block navigation.
