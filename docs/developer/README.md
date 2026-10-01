# Developer documentation

This directory is the website-side reference for the CLIRevenue SDK. It is
the read-only part of the integration story: install, configure, render and
patch an ad.

---

- [Getting started](getting-started.md) — what CLIRevenue is and how the SDK
  fits together.
- [Installation](installation.md) — npm install, browser / client requirements,
  and the download distribution.
- [SDK](sdk.md) — the public surface, initialize, request, render, events,
  offline and error behaviour.
- [Placements](placements.md) — what a placement is and how developers use
  placement keys.
- [Ad slots](ad-slots.md) — where advertisements appear and the terminal
  containment contract.
- [Configuration](configuration.md) — size configuration concept, bounded
  dimensions, positioning inside the terminal, responsive behaviour.
- [Analytics](analytics.md) — delivery, impression, click; where they are
  recorded.
- [Authorization](authorization.md) — publishable key, what it is, what it is
  not, and what must never live in browser code.
- [Troubleshooting](troubleshooting.md) — ad not appearing, no-fill, invalid
  publishable key, network issues.
- [FAQ](faq.md) — quick answers to the most common questions.

---

> The SDK itself lives in a separate workstream (`packages/sdk`) and is
> implemented and versioned there. This documentation describes the public
> API as it exists today: the complete `render()` layout surface, size
> limits, nine anchors, offset behaviour and containment, all verified
> against the final SDK. Nothing here invents a method, a field or a
> version.

---

## Conventions

- **Publisher** — the account that owns placements and delivery.
- **Advertiser** — the party paying for inventory.
- **Placement** — a named ad surface; the key the browser passes at request
  time.
- **Publishable key** — a public identifier, safe in the bundle.
- **SDK** — `@clirevenue/sdk`, the browser client.
- **Impression** — a served ad that has been viewable.
- **Click** — a served destination followed by the user.
- **Campaign** — advertiser-side inventory; not something the SDK owns.

Everything in this set of documents is conceptual or based on the code that
already exists in the repository. No figure, feature or guarantee is invented
for the sake of a page.
