# Conversion integration

Conversions are the one part of CLIRevenue that **must not** happen in a browser.

This document explains why, where a conversion belongs, and what a working
server-side integration looks like. It is written against the endpoints that
actually exist. Nothing here is hypothetical.

---

## Why conversions are server-side

A conversion is a claim that money changed hands. Three things follow from that.

**1. It needs a credential the browser cannot hold.** A conversion endpoint that
accepts a publishable key is an endpoint anyone on the internet can call. That is a
public "mark this as converted" button.

**2. It needs to be attributable to something real.** An impression can be reported
by a browser because the browser genuinely observed it. A conversion is a business
event — a signup, a purchase, a subscription — and it happens in *your* systems.
Your server is the only place that knows it occurred.

**3. It must not be forgeable by a third party.** If a browser can be made to report
a conversion, an attacker who loads your page in a hidden iframe gets free money.
That is why conversions are authenticated and why the browser SDK is not the path.

### The shape of the flow

```text
  visitor's browser                    your server                    CLIRevenue
        │                                  │                             │
        │  serves an ad                    │                             │
        │  (impression + click) ──────────▶│                             │
        │  ── publishable key in body ─────┼──── POST /ads/deliver ──────▶│
        │                                  │                             │
        │                                  │  user signs up / buys        │
        │                                  │  your systems decide it is   │
        │                                  │  a conversion                 │
        │                                  │                             │
        │                                  │──── POST /ads/conversion ──▶│
        │                                  │     (server credentials)     │
        │                                  │◀─── 200 {status:'recorded'} ─│
        │                                  │                             │
        │◀── "thanks" (no detail leaked) ──│                             │
```

The browser never learns the outcome, never holds a secret, and never gets to say
what a conversion is worth.

---

## What the browser may and may not do

| | Browser | Server |
| --- | --- | --- |
| Request an ad | ✅ `getAd` | ✅ |
| Record an impression | ✅ via viewability | ✅ |
| Report a click | ✅ `recordClick` | ✅ |
| Report a conversion | ❌ | ✅ |
| Decide a reward amount | ❌ | ✅ |
| Know a campaign id | ❌ | ✅ |

The browser reports **what it saw**. Your server reports **what happened**, and
CLIRevenue decides **what it is worth**. No three of those are the same question.

### A conversion cannot be smuggled in as a click

`POST /ads/click` does not accept a `kind` field. If you send one, it is ignored and
the event is recorded as a click. There is no client-side path that upgrades a click
into a conversion.

---

## Server-side example

A conversion webhook handler. Note what it does **not** do: it does not trust the
payload's amounts, ids, or campaign references, and it does not accept them at all.

```js
// server/conversions.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // server only — never a VITE_ variable
)

/**
 * POST /ads/conversion
 *
 * Body we require: exactly two things.
 *   serveRequestId — the requestId from the ad we served this user
 *   externalRef    — your own id for the business event (order id, signup id)
 *
 * Everything else is resolved server-side from the serve record.
 */
export async function recordConversion({ serveRequestId, externalRef }) {
  // 1. Verify the caller is us. This handler must not be publicly callable.
  //    (Check a signature on the webhook, a session, an allow-listed origin.)
  const authorized = await verifyInternalCaller()
  if (!authorized) return { status: 403, body: { error: 'FORBIDDEN' } }

  // 2. Derive the publisher from the serve, not from the request.
  //    A caller must never be able to name the publisher it credits.
  const serve = await loadServe(serveRequestId)
  if (!serve) return { status: 404, body: { error: 'SERVE_NOT_FOUND' } }

  if (serve.expiresAt && new Date(serve.expiresAt) < new Date()) {
    return { status: 400, body: { error: 'SERVE_EXPIRED' } }
  }

  // 3. One idempotency key per business event, so a retried webhook
  //    cannot record two conversions.
  const idempotencyKey = `conv:${serve.publisherId}:${externalRef}`

  const response = await fetch(`${CLIREVENUE_BASE_URL}/ads/conversion`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-clirevenue-sdk-version': '1.0.0',
    },
    body: JSON.stringify({
      publisherKey: process.env.CLIREVENUE_PUBLISHABLE_KEY,
      requestId: serveRequestId,
      impressionToken: serve.impressionToken,
      idempotencyKey,
      externalRef,
    }),
  })

  if (response.status === 200) {
    const result = await response.json()
    return { status: 200, body: { status: result.status } } // 'recorded' | 'duplicate'
  }

  const error = await response.json().catch(() => ({}))
  return { status: response.status, body: { error: error.error } }
}
```

The things worth copying from this:

- **The caller is verified first.** An unauthenticated conversion endpoint is worse
  than no endpoint.
- **The publisher comes from the serve record**, never from the request body. A
  caller must not be able to choose who gets credited.
- **The idempotency key is derived from your own business event id**, so a webhook
  that fires twice records once.
- **`externalRef` is stored, not interpreted.** It is your id, for reconciliation.
  CLIRevenue does not price it — your pricing configuration does.

---

## What to send, what not to send

| Send | Do not send |
| --- | --- |
| The `requestId` from the serve | A campaign id you looked up yourself |
| Your own business event id | A reward or payout amount |
| A deterministic idempotency key | A developer JWT or session token |
| The server's own credentials | Anything from the request the browser sent, unverified |

The last row is the important one. **Do not forward browser-supplied fields into a
conversion.** The browser is untrusted input; a conversion is a financial claim.
Re-derive everything from your own database.

---

## Common mistakes

**Calling `trackConversion` from the browser.** It needs a `requestId` that was
served in that page session, and the endpoint requires server credentials. It will
fail, and if it ever appeared to succeed it would mean the endpoint was
misconfigured.

**Trusting a campaign id from the client.** The client cannot know which campaign
won, and if it can tell you, it can lie to you. Resolve it server-side from the
serve record.

**Generating an idempotency key per attempt.** That defeats idempotency entirely —
every retry becomes a new conversion. Derive it from the business event.

**Recomputing the reward in the browser.** The client's number is decoration. The
server's number is the one that settles.

---

## Verifying the integration

1. Serve an ad and confirm a `requestId` exists.
2. Trigger your business event (test mode).
3. Call your handler with that `requestId`.
4. Confirm `status: 'recorded'` on the first call.
5. Call it again with the same `externalRef` — confirm `status: 'duplicate'`.
6. Confirm the browser bundle contains no conversion credentials and no
   `SUPABASE_SERVICE_ROLE_KEY`.

If step 5 reports `'recorded'` instead of `'duplicate'`, the idempotency key is not
stable and you are double-counting.

---

## Current limitations

Two gaps in the gateway today, both backend-owned:

- **Publisher-facing reporting is not exposed.** `ad_serve_log` holds the delivery,
  impression, click and conversion records, but there is no publisher-readable
  endpoint over it yet. A conversion handler can record successfully and still have
  nowhere to read the result back from. Until that exists, verify through the server
  log, not the browser.
- **Conversion uses the publishable key.** `POST /ads/conversion` authenticates with
  the publisher key, which is designed to be public. That is acceptable only because
  the endpoint is not reachable from the browser — it is called from your server
  with server-side verification in front of it. A distinct server-scoped credential
  would be stronger. Recorded as a backend blocker, not worked around here.
