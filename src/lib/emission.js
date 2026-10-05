/* =============================================================
   CLIRevenue — terminal emission
   -------------------------------------------------------------
   The particle field that escapes the terminal surfaces. It is a
   plain module with no React in it for the same reason the cinema
   store is plain: the animation is the expensive, stateful part and
   it should be readable — and testable — without a renderer in the
   way.

   The model is deliberately austere, because the brief is austere:
   pixels, not sparks. A particle is a sub-pixel dot that leaves the
   top-right corner of a surface, drifts up and outward, and is gone.
   There is no burst, no trail and no additive blending, because each
   of those turns a low-density signal into noise, and noise is what
   makes an effect read as a toy.

   Everything lives in parallel typed arrays with a hard cap, and the
   live particles are kept in a dense prefix of them. A particle is
   retired by swapping the last live entry into its slot, so the
   update loop walks a contiguous range with no holes and no
   allocation — which is what makes "a few hundred" here cost about
   as much as a dozen CSS transitions, and what makes the cap a real
   bound rather than an aspiration.

   Colours are read from the stylesheet rather than written here, so
   the field cannot drift away from the palette: `--paper` and
   `--signal` are the same two values the type uses, and a theme
   change moves the particles with it.
   ============================================================= */

/* The whole-field ceiling. At most two film terminals are on screen
   at once and each is capped well below this, so the number is a
   backstop against a pathological layout rather than a target. Kept
   small on purpose: the brief asks for low density, and density
   that has to be dialled back later is density that was wrong to
   begin with. */
export const MAX_PARTICLES = 220

/* Per-surface ceilings, in live particles. The hero is a wide, tall
   window the viewer rests on longest, so it earns the larger share;
   the in-chapter windows are supporting surfaces. */
export const HERO_CAP = 30
export const SURFACE_CAP = 18

const TAU = Math.PI * 2

/* --- tuning ---------------------------------------------------
   The numbers that decide whether this reads as digital emissions or
   as confetti. Each comment states the intent, because the intent
   is not recoverable from the value. */

/* Upward drift, px/s at spawn. Slow enough that a particle is still
   legible several frames after it leaves, fast enough that it has
   visibly escaped the surface before it fades. */
const RISE_MIN = 18
const RISE_MAX = 52

/* Outward push from the corner, px/s. This is what separates emission
   from smoke.

   The values are larger than they look for the effect they produce,
   because horizontal drag eats most of them within a second. At this
   setting a particle leaves at up to ~44px/s laterally, loses most of
   that to drag, and still travels roughly 20px sideways against ~65px
   of rise — a fan about 35px wide. That is enough to read as a
   direction and not enough to read as an explosion. */
const SPREAD_MIN = 10
const SPREAD_MAX = 44

/* Lateral wander, px/s². Small, per-particle, and at incommensurate
   frequencies — it is there to break the straight line, not to draw
   one. Anything larger reads as a swoop. */
const WANDER = 4.6

/* Buoyancy, px/s², negative because canvas y grows downward. It is
   what lets a particle keep rising as it slows, so the motion reads
   as floating rather than as something thrown and decelerating to a
   stop. */
const BUOYANCY = -3.2

/* Drag, per second. Terminal rise speed is BUOYANCY / DRAG ≈ 6px/s,
   so a particle decelerates from its launch over about two seconds
   and then coasts — visible travel of roughly 60px, which is enough
   to clear the window chrome and read as escape. Vertical drag is
   gentler than horizontal because a sideways drift that collapses
   immediately looks like a straight ray. */
const DRAG_Y = 0.5
const DRAG_X = 1.15

/* Lifetimes, seconds. Long enough to travel a readable distance,
   short enough that the surface is never trailing a crowd. */
const LIFE_MIN = 2.1
const LIFE_MAX = 4.4

/* Dot size in CSS px. The floor is sub-pixel on purpose: at 1x a
   0.55px dot antialiases down to a faint speck, which is the whole
   point. */
const SIZE_MIN = 0.55
const SIZE_MAX = 1.5

/* Peak opacity. Low, because these are bright signals on black and
   the eye is very good at finding the brightest thing on screen. */
const ALPHA_MIN = 0.14
const ALPHA_MAX = 0.46

/* The share of particles drawn in the signal colour. A minority, so
   the red reads as punctuation inside a white field rather than as
   a second, competing palette. */
const SIGNAL_SHARE = 0.14

/* --- palette --------------------------------------------------- */

const FALLBACK = { paper: [255, 255, 255], signal: [255, 31, 45] }

function parseColor(raw) {
  if (!raw) return null
  const value = raw.trim()

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1]
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ]
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
  )
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]

  return null
}

function readToken(styles, name, fallback) {
  return parseColor(styles.getPropertyValue(name)) || fallback
}

/* The palette is read once, from the document root, and handed back
   as ready-made `rgba()` strings so the draw loop never parses
   anything or builds a template string per particle per frame. */
export function readPalette(root) {
  const target =
    root || (typeof document === 'undefined' ? null : document.documentElement)
  const fallback = { paper: [...FALLBACK.paper], signal: [...FALLBACK.signal] }
  if (!target || typeof getComputedStyle !== 'function') return fallback

  const styles = getComputedStyle(target)
  return {
    paper: readToken(styles, '--paper', fallback.paper),
    signal: readToken(styles, '--signal', fallback.signal),
  }
}

const rgba = (rgb) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`

/* --- the field -------------------------------------------------- */

export function createField() {
  const px = new Float32Array(MAX_PARTICLES)
  const py = new Float32Array(MAX_PARTICLES)
  const vx = new Float32Array(MAX_PARTICLES)
  const vy = new Float32Array(MAX_PARTICLES)
  const age = new Float32Array(MAX_PARTICLES)
  const span = new Float32Array(MAX_PARTICLES)
  const dot = new Float32Array(MAX_PARTICLES)
  const peak = new Float32Array(MAX_PARTICLES)
  const phase = new Float32Array(MAX_PARTICLES)
  const freq = new Float32Array(MAX_PARTICLES)
  const tint = new Uint8Array(MAX_PARTICLES)
  const owner = new Int16Array(MAX_PARTICLES)

  let count = 0
  let palette = FALLBACK

  /* Live particles per surface. A Map rather than a fixed array
     because surfaces are discovered from the DOM and their identity
     is not known until mount. */
  const occupancy = new Map()

  function release(i) {
    const key = owner[i]
    const held = occupancy.get(key)
    if (held !== undefined) {
      if (held <= 1) occupancy.delete(key)
      else occupancy.set(key, held - 1)
    }

    const last = --count
    if (i === last) return
    px[i] = px[last]
    py[i] = py[last]
    vx[i] = vx[last]
    vy[i] = vy[last]
    age[i] = age[last]
    span[i] = span[last]
    dot[i] = dot[last]
    peak[i] = peak[last]
    phase[i] = phase[last]
    freq[i] = freq[last]
    tint[i] = tint[last]
    owner[i] = owner[last]
  }

  /* Paints one particle. A closure rather than a method on the
     returned object so the draw loop can call it without a receiver
     — it is the innermost operation in the frame and should not pay
     for a property lookup or a `this` bind sixty times a second. */
  function paint(ctx, dpr, i) {
    const t = age[i] / span[i]
    /* Fade in over the first tenth — a particle must not appear at
       full strength the instant it is born — then decay for the
       rest of its life. The exponent keeps the early frames bright
       enough to read while the tail goes genuinely quiet. */
    const alpha = peak[i] * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.7)
    if (alpha <= 0.004) return

    /* Snapped to the device grid, so a 1px dot is one crisp pixel
       rather than a 1px smear spread across four. */
    const x = Math.round(px[i] * dpr)
    const y = Math.round(py[i] * dpr)
    const size = Math.max(1, Math.round(dot[i] * dpr))

    ctx.globalAlpha = alpha > 1 ? 1 : alpha
    ctx.fillRect(x, y, size, size)
  }

  return {
    /* `energy` is the surface's current intensity, 0..1, supplied by
       the caller from the playhead. At zero a surface is at rest and
       emits nothing at all.

       The cap is enforced against this surface's own live count, so
       density is bounded per terminal rather than globally: a busy
       hero can never spend the budget of the window below it. */
    spawn(key, ox, oy, spreadX, spreadY, energy, cap) {
      if (energy <= 0 || count >= MAX_PARTICLES) return false

      const held = occupancy.get(key) || 0
      if (held >= cap) return false

      const i = count++

      owner[i] = key
      occupancy.set(key, held + 1)

      /* Biased toward the corner rather than spread evenly across the
         band. The exponents are what turn "an area at the top right"
         into "the top right corner, softly". */
      px[i] = ox + Math.pow(Math.random(), 1.7) * spreadX
      py[i] = oy + Math.pow(Math.random(), 1.9) * spreadY

      const rise = RISE_MIN + Math.random() * (RISE_MAX - RISE_MIN)
      /* A cone around "up", biased toward the outside of the corner.

         The bias is what makes it read as coming *out of* a top-right
         corner rather than as a column rising from a point, and the
         cone is wide enough that a good share of particles travel
         left across the terminal's own face. Those are the ones that
         make it a radiation rather than a jet — a purely rightward
         fan just looks like the window is blowing. */
      const angle = -Math.PI / 2 + (Math.random() - 0.42) * 1.6
      const push = SPREAD_MIN + Math.random() * (SPREAD_MAX - SPREAD_MIN)
      vx[i] = Math.cos(angle) * push
      vy[i] = -rise

      span[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)
      age[i] = 0

      dot[i] = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)
      peak[i] = (ALPHA_MIN + Math.random() * (ALPHA_MAX - ALPHA_MIN)) * energy
      phase[i] = Math.random() * TAU
      /* Incommensurate frequencies: no two particles retrace the same
         lateral path, so the field never shows a pattern. */
      freq[i] = 0.6 + Math.random() * 1.5
      tint[i] = Math.random() < SIGNAL_SHARE ? 1 : 0

      return true
    },

    step(dt) {
      for (let i = 0; i < count; ) {
        age[i] += dt
        if (age[i] >= span[i]) {
          release(i)
          continue
        }

        const drift = Math.sin(age[i] * freq[i] + phase[i]) * WANDER

        vy[i] += (BUOYANCY - vy[i] * DRAG_Y) * dt
        vx[i] += (drift - vx[i] * DRAG_X) * dt

        px[i] += vx[i] * dt
        py[i] += vy[i] * dt
        i++
      }
    },

    /* Drawn in two passes, one per colour. `fillStyle` is the
       expensive per-particle call in a 2D context and `globalAlpha`
       is not, so the loop is organised to change the fill twice per
       frame and the alpha as often as it likes. */
    draw(ctx, dpr) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      if (count === 0) return

      ctx.fillStyle = rgba(palette.paper)
      for (let i = 0; i < count; i++) {
        if (tint[i] === 0) paint(ctx, dpr, i)
      }

      ctx.fillStyle = rgba(palette.signal)
      for (let i = 0; i < count; i++) {
        if (tint[i] === 1) paint(ctx, dpr, i)
      }

      ctx.globalAlpha = 1
    },

    /* Exposed so the layer can skip the step when the field is empty,
       and so a test can assert it actually empties. */
    get count() {
      return count
    },

    heldBy(key) {
      return occupancy.get(key) || 0
    },

    /* A read-only view of one live particle. Exists so the motion can
       be asserted in a test without a browser — the whole point of
       the model being DOM-free — and so a field can be inspected from
       the console when tuning the constants. Returns `null` for an
       index that has already been retired. */
    position(i) {
      if (i < 0 || i >= count) return null
      return {
        x: px[i],
        y: py[i],
        vx: vx[i],
        vy: vy[i],
        travelled: age[i] / span[i],
      }
    },

    setPalette(next) {
      palette = next && next.paper ? next : FALLBACK
    },

    clear() {
      while (count > 0) release(count - 1)
      occupancy.clear()
    },
  }
}
