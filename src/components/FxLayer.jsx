import { useEffect } from 'react'
import { mountFx } from '../lib/fx.js'

/* One global render layer, mounted once against the document and never
   re-created per route — the same contract spotlightTracker follows, and
   for the same reason: it does not know which route is mounted, so it
   does not have to be.

   It renders nothing. Everything it does is a custom property, an
   attribute or a class written straight onto the DOM inside the rAF and
   observer callbacks in fx.js; there is no state here to re-render with,
   which is also why there is no reason for this to be a component at all
   beyond having somewhere legal to hang the teardown. */
export default function FxLayer() {
  useEffect(() => mountFx(), [])
  return null
}