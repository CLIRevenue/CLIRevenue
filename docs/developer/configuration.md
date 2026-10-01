# Configuration

## What configuration means for a browser SDK

In the browser, "configuration" is almost everything the developer cannot or
should not do server-side. The SDK configuration surface is small on purpose:

- a **publishable key** to identify the publisher,
- a **base URL** to point at the gateway,
- optional **timeout and retry** parameters.

Everything that carries money, attribution or inventory state is resolved
server-side and is never something the browser configures.

## Sizing

Ad size is configured with `size` on the layout object passed to
`render()` (or to `getAd()`, via `layout.display`). The SDK clamps any size
to a safe band and normalises the result:

| Setting | Value |
|---|---|
| Minimum width | `120` px |
| Minimum height | `60` px |
| Maximum width | `1280` px |
| Maximum height | `1024` px |
| Default width | `320` px |
| Default height | `100` px |

Below the minimum an ad is unreadable and is refused. Above the maximum an
ad is a page rather than an ad. Non-finite numbers fall back to the default;
real numbers are rounded to whole pixels and clamped to the band.

The defaults are `320 × 100` px. A layout with no `size` specified is
resolved to that default, then intersected with the host box.

## Positioning

Position is configured with `position` on the layout object:

```ts
type AdPosition = {
  anchor: AdAnchor
  offsetX: number
  offsetY: number
}

type AdAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
```

`anchor` chooses one of the nine positions. The offset is a small pixel
nudge along each axis:

- `offsetX` nudges left (negative) or right (positive).
- `offsetY` nudges up (negative) or down (positive).

Offsets are clamped to `±512` px. Both axes share the same clamp, so a
caller cannot smuggle a huge offset past the geometry module. Rounding and
the containment band keep the final pixel box integer and finite.

## Containment

Containment is the defining behaviour of the geometry module and it is
owned by the SDK, not the caller:

1. **Normalise the request** so the numbers are already sane.
2. **Shrink to fit the host** so a container smaller than the request
   cannot overflow — this is the responsive behaviour, and it degrades the
   ad rather than clipping it.
3. **Anchor inside the free space** left by the shrink.
4. **Apply the offset.**
5. **Pull the result back inside the host** so no offset, however large, in
   either direction can push the ad out.

Steps 2 and 5 are what make the SDK, not the caller, responsible for
containment. Step 5 also guarantees `left`/`top` are never negative and
never exceed the host, which keeps the ad out of the surrounding layout.

## ResizeObserver re-containment

When the host changes size, a `ResizeObserver` re-contains the ad so it can
never overflow its host before the publisher notices. `dispose()` is
idempotent: calling it more than once is a no-op, and it tears down both the
viewability watch and the resize re-containment.

## Responsive behaviour

Because the resolved box is intersected with the host box, a single
placement works across a wide terminal pane and a narrow one without any
JavaScript from the publisher. The ad degrades to a smaller, still-contained
box instead of growing out of the surface.
