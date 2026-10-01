# Troubleshooting

## Ad not appearing

Start here.

1. Check the **publishable key** is present and parses as `pk_test_…` or
   `pk_live_…`. An invalid key throws `CLIRevenueConfigError` before any
   request; the SDK logs a warning and nothing is requested.
2. Open the **network tab** and look for `/ads/deliver`. If it never fires,
   the key is likely invalid. If it returns 403, the placement is disabled.
3. Confirm the placement **exists and is enabled** on the server. A delivery
   request for a placement that does not exist answers `INVALID_PLACEMENT`.
4. Check that the **selector you passed to `render()` matches an element**.
   A missing selector throws `CLIRevenueConfigError`; a selector that
   matches nothing returns the same error.
5. Look for a console warning about
   `IntersectionObserver unavailable` — without it the SDK records nothing.
6. Confirm the slot is actually in the **viewport**. No viewability, no
   impression; the SDK will not record an impression it cannot see.

## No fill

`getAd()` returns `null` on a successful 204. That is a normal outcome, not
a failure, and it is never retried. Render your own fallback and move on.
No-fill is inventory, not a bug.

A 204 means: nothing eligible, budget exhausted, or the campaign is not
live. That is a business answer, not a network problem.

## Invalid publishable key

If `init()` throws `CLIRevenueConfigError` with a bad key, the browser-side
validation already caught it. The fix is to provide a key shaped like
`pk_test_…` or `pk_live_…`. Check the build environment (for Vite:
`VITE_CLIREVENUE_PUBLISHABLE_KEY`) — the value is inlined into the bundle,
so if you do not see it in the built JavaScript, the key is not being
read.

## CORS / network issues

- `CLIRevenueNetworkError` means the request never reached the gateway.
  Check the base URL. In development, `https://api.clirevenue.com` is the
  default; point `baseUrl` at your own deployment.
- A 5xx answers the request, is retried with backoff, and then throws
  `CLIRevenueHttpError` if it still fails. Do not retry a 5xx again with a
  different strategy — the SDK already does exponential backoff with full
  jitter.
- A 4xx answers the request but is **never retried** (a rejected key or an
  unknown placement fails identically every time). Do not waste a retry on
  it.
- If your page is served from a different origin than the gateway, CORS
  applies to fetch, and the gateway must be configured to reply with the
  right headers. The SDK itself does not set CORS.

## Events not recording

- An impression only counts after 50% viewability for a full second. A slot
  that never reaches that threshold records nothing.
- A click report that fails must not block navigation. If the click report
  fails, the navigation still happens; check the network tab for
  `/ads/click`.
- Impression, click and conversion requests carry an idempotency key. A
  4xx on those is a permanent rejection, not a retryable failure, and a
  `status: 'duplicate'` response is normal for a replay.

## Offline

Ad requests are not queued. If the network is down, `getAd()` rejects with
`CLIRevenueNetworkError` and you show your fallback. Impressions and clicks
are queued and replayed when the browser fires `online`, and `flush()` can
be called manually at any time.

## Ads appearing but never counting

The most common cause is a slot that is never viewable, or a
`IntersectionObserver` the browser does not have. Confirm the element is in
view, then confirm the browser supports IntersectionObserver. The SDK
challenges this behaviour rather than guessing that an impression happened.
