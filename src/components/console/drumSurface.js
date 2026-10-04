/* =============================================================
   CLIRevenue — the drum's shared surface geometry
   -------------------------------------------------------------
   The constants every painter and every projection of the agent
   drum agrees on, plus the pure math that answers one question:
   where, in frame pixels, does surface 08's reserved ad band sit
   right now?

   The drum's animation loop answers that as a matter of
   PRESENTATION: it owns the authoritative angle and the camera,
   so it positions the ad overlay. Delivery, viewability, clicks
   and cleanup live in `DrumAdSlot` and know nothing about any of
   this — and this module cannot absorb either side, because it
   imports nothing at all (no ogl, no react, no SDK). That makes
   it unit-testable under plain Node, which is exactly how the
   projection conventions below were pinned down.

   Conventions, verified against ogl's Cylinder geometry and
   Vec3.transformMat4:

     - A point at tile x on panel `p` sits at material angle
       phi = (p + x / TILE_W) · 2π / 8: cylinder u runs 0…1
       around the full circle, atlas column p occupies
       u ∈ [p/8, (p+1)/8], and ogl places vertices at
       (R·sinφ, y, R·cosφ) — so φ = 0 faces +Z.
     - Tile y maps linearly onto the cylinder's height:
       y = +H/2 at the tile's top (uv.y = 1 after UNPACK_FLIP_Y),
       −H/2 at its bottom.
     - A panel point's world angle is φ + drum.rotation.y; dead
       front is world angle 0, because the camera rides +Z.
     - Matrices are ogl's column-major arrays. The projection
       divides by w like ogl's Vec3.transformMat4, except the w
       sign is preserved so a point behind the camera is rejected
       instead of folded through w = 0.
   ============================================================= */

/* Geometry: eight surfaces share a circumference of 2πr, so a
   radius of 3 against a height of 2.6 gives each wrapped surface
   a tall, generous card — flatter under perspective, easier to
   read front-on, while the sides still visibly curve away.
   (Imported by OrbitRing so the painters, the mesh and the
   overlay can never drift apart.) */
export const RADIUS = 3.0
export const HEIGHT = 2.6
/* Virtual tile canvas the atlas painters lay out in (real pixels
   are this box, scaled to whatever the GPU's texture limit
   allows). */
export const TILE_W = 512
export const TILE_H = 706
export const DRUM_PANELS = 8

/* The designated delivery surface: SURFACES[7] — LOCAL /
   SELF-HOSTED, the bare shell that reserves a band and opens it
   only once stdout finishes. The rect is in tile space and must
   stay identical to drawShellTile's drawDeferredBand call. */
export const DRUM_AD_PANEL = 7
export const DRUM_AD_BAND = { x: 42, y: 446, w: 428, h: 100 }

/* How far from dead front (degrees) the drum keeps presenting the
   ad. Inside this window the overlay is laid over the reserved
   band and the SDK may count it; outside, the overlay is
   display:none, so viewability — honestly — cannot fire for a   band the drum is not showing. The window also stops the flat   overlay before the curvature mismatch at the panel's flanks   becomes visible. */
export const DRUM_AD_FACE_WINDOW_DEG = 30

/* Edge samples across the band's top and bottom rows. The band is   an arc of the cylinder, so its projected extremes are not
   necessarily at the corners; nine samples per edge keep the
   bounding box tight to the painted band while staying trivial   per frame. */
export const DRUM_AD_SAMPLES = 9

const TAU = Math.PI * 2
const RAD_TO_DEG = 180 / Math.PI

/* Absolute angular distance, in degrees, of a panel's centre from   dead front for the given rendered angle (radians). Returns a   value in [0, 180]. */
export function panelFacingDeg(angle, panel) {
  const centre = ((panel + 0.5) / DRUM_PANELS) * TAU
  const psi = (((centre + angle + Math.PI) % TAU) + TAU) % TAU - Math.PI
  return Math.abs(psi) * RAD_TO_DEG
}

/* Tile-space point → drum object space (before the rig's scale   and the drum's world matrix). */
export function tileToObject(panel, tx, ty) {
  const phi = ((panel + tx / TILE_W) / DRUM_PANELS) * TAU
  const y = (HEIGHT / 2) * (1 - (2 * ty) / TILE_H)
  return [RADIUS * Math.sin(phi), y, RADIUS * Math.cos(phi)]
}

/* Column-major mat4 × point. Returns the homogeneous [x, y, z, w]
   without dividing, so the caller decides what w ≤ 0 means. */
function transform(mat, x, y, z) {
  return [
    mat[0] * x + mat[4] * y + mat[8] * z + mat[12],
    mat[1] * x + mat[5] * y + mat[9] * z + mat[13],
    mat[2] * x + mat[6] * y + mat[10] * z + mat[14],
    mat[3] * x + mat[7] * y + mat[11] * z + mat[15],
  ]
}

/* Object-space point → CSS pixels inside the frame. Returns null   when the frame has no size or the point sits behind the   camera. */
export function projectToScreen(point, drumMatrix, viewMatrix, projectionMatrix, width, height) {
  if (!(width > 0) || !(height > 0)) return null
  const world = transform(drumMatrix, point[0], point[1], point[2])
  const view = transform(viewMatrix, world[0], world[1], world[2])
  const clip = transform(projectionMatrix, view[0], view[1], view[2])
  if (!(clip[3] > 0)) return null
  return [(clip[0] / clip[3]) * 0.5 + 0.5, 0.5 - ((clip[1] / clip[3]) * 0.5 + 0.5)].map(
    (v, i) => v * (i === 0 ? width : height),
  )
}
