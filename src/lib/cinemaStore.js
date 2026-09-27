/* =============================================================
   CLIRevenue — the cinema store
   -------------------------------------------------------------
   The master timeline lives in one place and runs in a GSAP
   context; React scenes live all over the tree and need to know how
   far through their own chapter the film currently is.

   This module is the seam between the two. The timeline writes; the
   scenes subscribe. Nothing here imports React, and nothing here
   knows that a timeline exists — it is a plain object of numbers
   with a listener set, which is all `useSyncExternalStore` needs.

   Two properties matter for smoothness:

   1. The snapshot object is replaced, never mutated. React compares
      snapshots by identity, so a new object means "something moved",
      and the same object means "nothing moved" — which is what lets
      a scene re-render only while its own chapter is actually in
      flight.

   2. A value that has not moved is never published. Scrubbing a
      timeline emits updates at display refresh rate whether or not
      the number changed, and the overwhelming majority of frames
      change nothing at all.
   ============================================================= */

import { SCENES } from './sequence.js'

let snapshot = Object.freeze(
  Object.fromEntries(SCENES.map((id) => [id, 0])),
)

const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

export function getSceneProgress(id) {
  return snapshot[id] ?? 0
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishSceneProgress(id, value) {
  if (snapshot[id] === value) return
  snapshot = { ...snapshot, [id]: value }
  notify()
}

export function publishAll(value) {
  const next = Object.fromEntries(SCENES.map((id) => [id, value]))
  if (SCENES.every((id) => snapshot[id] === value)) return
  snapshot = next
  notify()
}

export function resetCinema() {
  if (SCENES.every((id) => snapshot[id] === 0)) return
  snapshot = Object.fromEntries(SCENES.map((id) => [id, 0]))
  notify()
}
