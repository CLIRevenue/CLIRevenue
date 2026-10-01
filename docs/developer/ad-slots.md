# Ad slots

## Where an advertisement appears

An ad appears in a **reserved region of the interface**, not in the
terminal output. The host application renders that region beside its output,
not inside it. An ad is a UI region, never a line a script can parse from
`stdout`.

The same rule applies to `stdin` and to anything else a script consumes:
the ad region is separate from those channels, so a script reading the
command still receives exactly what the tool emitted.

Visually, the region is a plate with a border, a label and a disclosure —
interface, not output. It is the one region of the terminal that is
deliberately not output.

## The terminal containment contract

This is the load-bearing contract for a terminal ad surface:

1. The ad lives inside a **host element** — the selector you pass to
   `render()` or the element you hand to `watchViewability()`.
2. The ad never overflows the host. The SDK resolves the final box against
   the host and refuses any overflow: `left`/`top` are always inside the
   host, and the size is clamped.
3. The host measures itself. A host smaller than the request shrinks the ad
   rather than letting it clip or overflow. The same placement works in a
   wide terminal pane and a narrow one without your JavaScript.
4. There is no viewport-coordinate language. Placement position is
   anchor-based inside the host, never a fixed position relative to the
   window.

## A slot can be in one of six states

| State | UI says | Developer action |
|---|---|---|
| `loading` | "Requesting placement" | Nothing yet. |
| `ready` | Served ad visible | Nothing to do; impression is watched automatically. |
| `noFill` | "No ad for this slot right now" | Render the fallback. |
| `error` | "Placement request failed" | Offer to retry. |
| `offline` | "Offline" | Nothing yet; events queue and replay. |
| `disabled` | "Placement not configured" | Check the publishable key is present. |

`noFill` is not a failure. It is a normal outcome: the request reached the
server and nobody is currently buying that placement. Show the fallback and
move on. Do not show an error message.

## Rendering into a slot

The cleanest path is `render()`:

```js
const { served, dispose } = await clirevenue.render(
  'console-workbench',
  '#ad-region',
  {
    size: { width: 320, height: 100 },
    position: { anchor: 'bottom-right', offsetX: -16, offsetY: -16 },
  },
)
```

### The terminal containment contract

This is the load-bearing contract for a terminal ad surface:

1. The ad lives inside a **host element** — the selector you pass to
   `render()` or the element you hand to `watchViewability()`.
2. The ad never overflows the host. The SDK resolves the final box against
   the host and refuses any overflow: `left`/`top` are always inside the
   host, and the size is clamped.
3. The host measures itself. A host smaller than the request shrinks the ad
   rather than letting it clip or overflow. The same placement works in a
   wide terminal pane and a narrow one without your JavaScript.
4. There is no viewport-coordinate language. Placement position is
   anchor-based inside the host, never a fixed position relative to the
   window.

Because containment is explicit, the same placement works inside a narrow
terminal pane and a wide one without any publisher JavaScript: the SDK
shrinks the ad to fit the host rather than letting it expand past it.

### ResizeObserver re-containment

When the host changes size, a `ResizeObserver` re-contains the ad, so it can
never overflow its host before the publisher notices. `dispose()` tears down
both the viewability watch and any resize re-containment, and is idempotent.

## A slot can be in one of six states

| State | UI says | Developer action |
|---|---|---|
| `loading` | "Requesting placement" | Nothing yet. |
| `ready` | Served ad visible | Nothing to do; impression is watched automatically. |
| `noFill` | "No ad for this slot right now" | Render the fallback. |
| `error` | "Placement request failed" | Offer to retry. |
| `offline` | "Offline" | Nothing yet; events queue and replay. |
| `disabled` | "Placement not configured" | Check the publishable key is present. |

`noFill` is not a failure. It is a normal outcome: the request reached the
server and nobody is currently buying that placement. Show the fallback and
move on. Do not show an error message.

## Imperative disposal

Every `render()` / `watchViewability()` call returns a disposer. Call it
when the slot unmounts, or an impression can land on an element that is
already gone:

```js
const { dispose } = await clirevenue.render('console-workbench', '#ad-region')
// later, when the slot is removed:
dispose()
```

For a React surface, return the disposer from a `useEffect` cleanup, or
call `destroy()` on the whole client.

## Imperative vs declarative

| | `render()` | custom markup |
|---|---|---|
| Built-in | anchor, click wiring, viewability | none |
| Best for | most surfaces | an existing visual system with its own markup |
