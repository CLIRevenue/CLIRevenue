import { useReducedMotion } from 'motion/react'

/* Shared, dependency-free helpers for the conversion layer.
   Nothing here touches storage, the network, or the economy store. */

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim())
}

/* The only scroll reveal the conversion layer uses: opacity and a short
   lift, once, when a section first enters the viewport. Under reduced
   motion it spreads no props at all, so nothing is ever gated behind an
   animation. The stylesheet carries a matching safety net (see
   .conv .block) for the case where the preference flips after first
   paint and this hook has already been read as false. */
export function useReveal() {
  const reduced = useReducedMotion()
  if (reduced) return {}
  return {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.12 },
    transition: { duration: 0.7, ease: [0.19, 1, 0.22, 1] },
  }
}
