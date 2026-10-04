/* =============================================================
   CLIRevenue — the drum's real ad surface
   -------------------------------------------------------------
   A thin React wrapper around the existing delivery stack:
   - Obtains the drum-ad placement from the registry.
   - Delegates ad lifecycle to `useServedAd` (loading/ready/nofill/
     error/offline/disabled + viewability + cleanup on unmount).
   - Renders the same `ServedAdSlot` presentation the workbench and
     film scenes use, so the drum ad is visually identical to the
     other homepage ads.
   - Owns **only** ad state & markup. It knows nothing about the
     drum's animation, camera, or projection — the drum positions
     this component via CSS `transform`, and the SDK's
     `watchViewability` watches the *same element* for the
     impression.

   Architecture separation:
   - `drumSurface.js` (pure math) → OrbitRing (presentation:
     positions the overlay via CSS, never touches ad state).
   - `DrumAdSlot.jsx` (data: placementId, `useServedAd`,
     `ServedAdSlot`).
   - Neither module imports the other.
   ============================================================= */

import ServedAdSlot from './ServedAdSlot.jsx'

/* The drum's designated delivery key — must match the registry
   entry in `placements.js`. */
const DRUM_AD_PLACEMENT_ID = 'consoleDrum'

export function DrumAdSlot() {
  return (
    <ServedAdSlot
      placementId={DRUM_AD_PLACEMENT_ID}
      hidden={false}
    />
  )
}

export default DrumAdSlot