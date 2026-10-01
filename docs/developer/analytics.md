# Analytics

## What the SDK reports

The SDK reports two lifecycle events to the gateway: an **impression** and
a **click**. Both are reported by the SDK, not by the page:

- An impression is recorded once per served ad, after at least 50% of the
  element has been on screen for one second.
- A click is reported when the user follows the served destination.

The gateway is authoritative for delivery counts. The browser cannot
manufacture an impression, cannot inflate a click, and cannot report a
reward amount.

## Delivery

Delivery is one request per placement, cached for 60 seconds. The SDK
single-flights concurrent callers so a React StrictMode double-mount or a
re-render does not double-charge an advertiser and does not double-count an
impression.

## Impression

Recorded only when both of these are true:

1. at least 50% of the slot's area is inside the viewport, and
2. it stays that way for at least 1 second.

After that it fires once, and scrolling back out and in again does not
count it a second time.

## Click

`recordClick(served)` reports the click with the serve's `requestId`,
`impressionToken` and an idempotency key. It is sent with `keepalive` so a
click report is not lost when the document unloads. The click is fire-and-
forget: a lost report must not break navigation.

## Conversions

A conversion is money, and it is reported server-side only. The browser SDK
has `trackConversion(requestId)` for completeness, but a conversion must
never be smuggled in as a click or recorded from a browser that holds no
credentials.

## Idempotency

Every mutating request carries an idempotency key. Replaying one is safe:
the server answers `status: 'duplicate'` rather than double-counting.

## Where counts live

Delivery counts live on the server, in the serve log. The browser SDK ends
at "this ad was shown to a specific browser", and the server decides what
that means. A publisher-facing delivery report is not yet exposed through
the SDK, and this page deliberately does not show a made-up number.
