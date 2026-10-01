# Installation

## npm

```sh
npm install @clirevenue/sdk
```

The package is ESM-only, ships its own type declarations, and has **no
runtime dependencies**. Nothing is pulled into your bundle except the SDK.

You import the public surface:

```js
import { init } from '@clirevenue/sdk'
```

or, in TypeScript:

```ts
import { init, type ServedAd, type CLIRevenueOptions } from '@clirevenue/sdk'
```

## Client requirements

| Requirement | Notes |
|---|---|
| A browser with a working `fetch` | The SDK uses `fetch` for deliver, impression and click. |
| An IntersectionObserver | Required for the SDK to record an impression automatically. Without it the SDK logs a warning and records nothing. |
| A publishable key | `pk_test_…` or `pk_live_…`, matching `/^pk_(live|test)_[A-Za-z0-9_-]{32,}$/`. |

The SDK is deliberately small and has no polyfill requirements. It also
degrades cleanly where a capability is missing: no IntersectionObserver,
no `navigator.sendBeacon`, no `sessionStorage`.

## Distribution and download

- **Install with npm** — the canonical distribution source. It is ESM-only and
  ships its own type declarations.
- **Download SDK** — this repository does not yet ship a release asset or a
  packed tarball in a publicly reachable location, so the "Download SDK"
  action links to this documentation rather than a made-up URL.
- **Documentation** — the pages in this directory, which you are reading.

The one authoritative source for the distributed version is the published
package's own `package.json` / `SDK_VERSION` in `packages/sdk/src/index.ts`.
Any version shown on the website is derived from that package; the website
does not maintain its own copy. Until the SDK is published to a registry or
release server, that source is not yet reachable from a public URL — see
`docs/AI_HANDOFF.md` for the missing artifact.

## Upgrade behaviour

The install card over time should present a single source of truth for the
package name and version. Until a registry artefact exists, the website page
duplicates the command and version from `packages/sdk/package.json` and
`packages/sdk/src/index.ts`; keep them in sync there, and do not hand-edit
the website copy independently.
