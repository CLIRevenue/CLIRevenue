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

const STORAGE_KEY = 'clirevenueIntroDone'

// Initialize from sessionStorage if available
let done = false
if (typeof window !== 'undefined') {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored === 'true') {
      done = true
    }
  } catch (e) {
    // Failed to read from sessionStorage, continue with in-memory value
    console.warn('Failed to read intro completion state from sessionStorage:', e)
  }
}

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
  // Persist to sessionStorage
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, 'true')
    } catch (e) {
      console.warn('Failed to write intro completion state to sessionStorage:', e)
    }
  }
  for (const listener of [...listeners]) listener()
  listeners.clear()
}

/* Test / HMR escape hatch. Nothing in the product calls it. */
export function resetIntro() {
  done = false
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.warn('Failed to reset intro completion state in sessionStorage:', e)
    }
  }
}
