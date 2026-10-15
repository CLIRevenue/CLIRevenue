# CLIRevenue SDK

Browser SDK for CLIRevenue: ad delivery, viewability-gated impressions, and click and conversion tracking. Zero runtime dependencies.

## Installation

```bash
npm install @clirevenue/sdk
```

## Setup

The SDK ships no CLI. Setup is done by a separate package, `@clirevenue/cli`, which installs this SDK into your project, verifies your publishable key against the API, and generates the files below.

```bash
npx clirevenue setup
```

That will:

- Detect your project (React, Vue and Svelte are supported)
- Install this SDK
- Verify your publishable key against the API
- Create your integration files

### Configure a slot

Once setup has run, open the CLIRevenue panel in your terminal to place an ad slot by dragging:

```bash
clirevenue overlay
```

The panel shows your name, the number of ads you have served, and what you have earned. Press **Add slot**, then click and drag to draw the slot, and release. The slot is stored as an anchor plus offsets rather than absolute pixels, so it stays where you put it as the browser window resizes.

To move, resize or remove an existing slot, use the visual editor:

```bash
clirevenue editor
```

Run `clirevenue --help` for the full command list (`setup`, `overlay`, `editor`, `integrations`, `add-slot`, `remove-slot`, `keybindings`).

## Usage

After setup, import and use the generated component in your application:

```jsx
import CLIRevenueAd from './components/CLIRevenueAd';

function App() {
  return (
    <div>
      <h1>My App</h1>
      <CLIRevenueAd />
    </div>
  );
}
```

## Project Configuration

After running `npx clirevenue setup`, the following files will be created:

- `.env.local` — your publishable key, read from `VITE_CLIREVENUE_PUBLISHABLE_KEY`
- `src/lib/clirevenue.js` — CLIRevenue library wrapper
- `src/components/CLIRevenueAd.jsx` — ad component (`.vue` and `.svelte` for those frameworks)
- `clirevenue.config.json` — integrations and the ad slots in each of them

## Publisher keys

A publishable key is a capability, not an identity: it is a random string that entitles its holder to serve ads through your placements, and it is stored only as a SHA-256 hash.

Two formats are accepted:

- `clirevenue_ads_` followed by 30 characters (45 total) — current
- `pk_live_…` / `pk_test_…` — issued before the current format, still accepted

Keys issued in the older format keep working indefinitely, because a key is typically deployed to third-party sites that hold the original string until they redeploy. A key pasted with a truncated or mistyped paste is rejected at `init()` with a message that names both formats.

## Features

- **Zero runtime dependencies** — nothing is pulled into your bundle beyond this package
- **Lazy-loaded ad slot components** — a slot that is not on screen costs nothing
- **Viewability-gated impressions** — an impression is recorded only after the ad is genuinely visible, so your served and seen counts agree with what a person actually saw
- **Click and conversion tracking** — conversions are attributed back to the original request
- **Window-relative layouts** — a slot is stored as an anchor plus offsets, so it scales with the browser window instead of drifting
- **Durable delivery queue** — a request that fails is re-queued rather than dropped, keeping the event's original timestamp so it cannot displace healthy events

## SDK Version

Version: 2.1.0

## License

Proprietary — see [LICENSE](./LICENSE).
