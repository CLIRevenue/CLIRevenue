/* =============================================================
   CLIRevenue — intro state
   -------------------------------------------------------------
   The intro runs once per page load and the rest of the film needs
   to know when it is over: the cinema hook starts Lenis, measures
   and subscribes while the document is still locked, and has to
   re-measure the moment the lock comes off.

   A store rather than a callback prop because the two ends are not
   in the same tree — the overlay is a sibling of the stage, and the
   hook runs inside it. A module singleton also survives the
   `StrictMode` double-invoke without being reset: whatever happens,
   "the intro has finished" stays true.
   ============================================================= */

let done = false
const listeners = new Set()

export function isIntroDone() {
  return done
}

export function subscribeIntro(listener) {
  if (done) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function markIntroComplete() {
  if (done) return
  done = true
  for (const listener of [...listeners]) listener()
  listeners.clear()
}

/* Test / HMR escape hatch. Nothing in the product calls it. */
export function resetIntro() {
  done = false
}
