# Getting started

## What CLIRevenue is

CLIRevenue is an advertising slot that lives **above** a CLI's command line,
and shares what it earns with the developer who runs it. A dedicated region
of the interface reserves the slot; the host application output is untouched.
A script reading `stdout` still receives exactly what the tool emitted.

The four parties are:

| | |
|---|---|
| **Advertisers** | reach technical users and pay for inventory |
| **Platform** | provides the infrastructure and takes a service fee |
| **Users** | can earn a share from advertising engagement |
| **Developers** | get a new revenue stream without shipping a paid product |

Nothing here is a claim about money, reach or performance. The concept is the
point, and the copy stays conceptual on purpose.

## How the SDK works

The SDK is a single ESM client — `@clirevenue/sdk`. It:

1. asks the CLIRevenue gateway for an ad for a **placement**,
2. renders it into a DOM element you give it,
3. watches that element for **viewability**, and records an **impression**
   only once the ad has genuinely been seen,
4. reports **clicks** when the user follows the served destination.

The SDK is a **reporting** tool. Attribution, campaign selection, ranking,
delivery counts and revenue assignment live on the gateway and are decided
there — the browser never sends a campaign id, a price, a revenue figure or
an advertiser id.

## When to use this documentation

Use this set of pages when you are adding CLIRevenue to your own product:

- you want to know what the SDK is and whether it fits your surface,
- you are installing it,
- you need the public API and its exact shapes,
- you need to understand placements, slots and configuration,
- something is not rendering or reporting as you expect.

## What this documentation deliberately does not do

It does not document every secret server-side detail, and it does not turn
the console into an account dashboard. Content that is already final is
given the full shape here; what remains marked is only the provenance
of a second authoring track, and is tracked in `docs/AI_HANDOFF.md` (see
*SDK dependencies from OpenCode*). No API, no field and no version is
invented in this set of documents.
