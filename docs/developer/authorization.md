# Authorization

## Publishable key

A publishable key is the browser-side identifier an integration uses to
ask the gateway for an ad. It is shaped like `pk_test_…` or `pk_live_…` and
must match `/^pk_(live|test)_[A-Za-z0-9_-]{32,}$/`.

It is **publishable by design**. Putting it in browser code is correct and
expected — that is what "publishable" means. It identifies the publisher
and nothing more.

## What a publishable key is

- Safe to ship in the bundle.
- A capability, not a credential.
- Scoped to one publisher: it can request ads for its own placements and
  report impressions and clicks for them.
- Verified by the server on every request; a revoked key fails on the next
  request.

## What a publishable key is not

- Not a secret.
- Not a way to create a publisher.
- Not a way to issue or revoke keys.
- Not a way to create a placement.
- Not a way to read performance data or balances.
- Not a way to complete a conversion or report a reward.

Those actions require service-role or secret access.

## Never put these in browser code

The following must never appear in a `VITE_*` variable or any browser code:

- The Supabase service-role key — bypasses all RLS and grants full database
  control.
- `AD_TOKEN_SECRET` — the server's impression-token signing secret.
- `SETTLEMENT_SECRET` — the settlement signing secret.
- Any private key, JWT signing key, or client secret.

A `VITE_` variable is public by definition: bundlers inline it into the
client bundle, so putting a secret there publishes it to every visitor.
Anything that grants an action rather than identifies a publisher is a
server-side value.

## How the key is issued

A key is created by an operator and issued to the developer. The server
stores only a SHA-256 hash plus a short display prefix. A key cannot be
recovered from the hash; when a machine changes hands, issue a new key and
revoke the old one.

## Browser pattern

```js
// The key comes from your build environment, never written here.
const key = import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY

const cli = init(key, {
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
```

The `init()` call validates the key locally and throws `CLIRevenueConfigError`
before any network call, so a misconfiguration is loud rather than silent.
