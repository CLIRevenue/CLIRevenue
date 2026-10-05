/* The emission field is the only part of this layer with real logic in
   it, and it is deliberately DOM-free so it can be asserted here
   without a browser. The vitest suite runs in the node environment
   (see vitest.config.js), which is exactly what this needs. */

import { describe, expect, test } from 'vitest'

import { createField, readPalette, MAX_PARTICLES } from '../src/lib/emission.js'

/* A recording stand-in for a 2D context. The point is to assert what
   the draw loop *does* — that it clears, that it never strokes, and
   that it changes fillStyle once per colour rather than once per
   particle. */
function recorder() {
  const calls = { clear: 0, fill: 0, stroke: 0, fillStyle: new Set(), alpha: [] }
  return {
    calls,
    canvas: { width: 800, height: 600 },
    clearRect() {
      calls.clear++
    },
    fillRect(x, y, w, h) {
      calls.fill++
      expect(w).toBeGreaterThan(0)
      expect(h).toBeGreaterThan(0)
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
    },
    strokeRect() {
      calls.stroke++
    },
    set fillStyle(v) {
      calls.fillStyle.add(v)
    },
    get fillStyle() {
      return ''
    },
    set globalAlpha(v) {
      calls.alpha.push(v)
    },
    get globalAlpha() {
      return 1
    },
  }
}

describe('emission field', () => {
  test('spawns nothing at zero energy', () => {
    const field = createField()
    expect(field.spawn(0, 100, 100, 40, 20, 0, 20)).toBe(false)
    expect(field.count).toBe(0)
  })

  test('holds a surface to its own cap', () => {
    const field = createField()
    let made = 0
    for (let i = 0; i < 500; i++) {
      if (field.spawn(1, 300, 100, 40, 20, 1, 12)) made++
    }
    expect(made).toBe(12)
    expect(field.heldBy(1)).toBe(12)
  })

  test('caps are per surface, so one busy terminal cannot spend another budget', () => {
    const field = createField()
    for (let i = 0; i < 500; i++) field.spawn(1, 300, 100, 40, 20, 1, 10)
    for (let i = 0; i < 500; i++) field.spawn(2, 300, 900, 40, 20, 1, 10)

    expect(field.heldBy(1)).toBe(10)
    expect(field.heldBy(2)).toBe(10)
    expect(field.count).toBe(20)
  })

  test('never exceeds the whole-field ceiling', () => {
    const field = createField()
    for (let i = 0; i < 40; i++) {
      for (let n = 0; n < 40; n++) field.spawn(i, 100 + i, 100 + i * 20, 30, 15, 1, 30)
    }
    expect(field.count).toBeLessThanOrEqual(MAX_PARTICLES)
  })

  test('a surface recovers its budget after its particles expire', () => {
    const field = createField()
    for (let i = 0; i < 8; i++) field.spawn(1, 100, 100, 30, 15, 1, 8)
    expect(field.spawn(1, 100, 100, 30, 15, 1, 8)).toBe(false)

    for (let step = 0; step < 60 * 3; step++) field.step(1 / 60)

    expect(field.spawn(1, 100, 100, 30, 15, 1, 8)).toBe(true)
  })

  test('a zero delta moves nothing', () => {
    const field = createField()
    for (let i = 0; i < 10; i++) field.spawn(1, 100, 100, 20, 10, 1, 10)
    const before = field.position(0)
    field.step(0)
    const after = field.position(0)
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test('particles rise and spread outward from the top-right corner', () => {
    const field = createField()
    const ox = 400
    const oy = 100

    for (let i = 0; i < 300; i++) field.spawn(1, ox, oy, 40, 20, 1, 300)

    const before = Array.from({ length: field.count }, (_, i) => field.position(i))
    for (let step = 0; step < 60; step++) field.step(1 / 60)
    const after = Array.from({ length: field.count }, (_, i) => field.position(i))

    expect(after.length).toBe(before.length)

    // Every particle spawns inside the band measured inward from the
    // top-right corner — never left of the origin, never below it.
    for (const p of before) {
      expect(p.x).toBeGreaterThanOrEqual(ox - 0.001)
      expect(p.x).toBeLessThanOrEqual(ox + 40.001)
      expect(p.y).toBeGreaterThanOrEqual(oy - 0.001)
      expect(p.y).toBeLessThanOrEqual(oy + 20.001)
    }

    const dy = after.map((p, i) => p.y - before[i].y)
    const dx = after.map((p, i) => p.x - before[i].x)
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

    // Up: every particle rises. This is the "float upward" half.
    expect(dy.every((v) => v < 0)).toBe(true)

    // Outward from a *top-right* corner means up and to the right, away
    // from the surface. A net leftward drift would be emission into the
    // window, which is the opposite of the brief.
    expect(mean(dx)).toBeGreaterThan(0)

    // And it has to genuinely radiate: a real share of particles cross
    // back over the terminal rather than all leaving to one side.
    expect(dx.some((v) => v < 0)).toBe(true)
    expect(dx.some((v) => v > 0)).toBe(true)
    expect(mean(dx.map(Math.abs))).toBeGreaterThan(4)

    // Far enough to read as escape rather than a twitch.
    expect(mean(dy.map(Math.abs))).toBeGreaterThan(8)
  })

  test('a particle decelerates as it fades instead of leaving at speed', () => {
    const field = createField()
    field.spawn(1, 400, 100, 0, 0, 1, 10)

    const start = field.position(0)
    expect(start.vy).toBeLessThan(0)

    for (let step = 0; step < 60; step++) field.step(1 / 60)
    const mid = field.position(0)

    // Still rising — buoyancy carries it after the launch speed decays.
    expect(mid.vy).toBeLessThan(0)
    expect(Math.abs(mid.vy)).toBeLessThan(Math.abs(start.vy))
  })

  test('over a full lifetime the travel reads as escape, not a twitch', () => {
    const field = createField()
    for (let i = 0; i < 200; i++) field.spawn(1, 400, 100, 40, 20, 1, 200)
    const start = Array.from({ length: field.count }, (_, i) => field.position(i))
    for (let step = 0; step < 60 * 3; step++) field.step(1 / 60)
    const end = Array.from({ length: field.count }, (_, i) => field.position(i))

    const dy = end.map((p, i) => p.y - start[i].y)
    const mean = dy.reduce((a, b) => a + b, 0) / dy.length
    expect(mean).toBeLessThan(-30)
    expect(dy.every((v) => v < 0)).toBe(true)
  })

  test('a newborn particle is invisible and fades in', () => {
    const field = createField()
    field.spawn(1, 200, 100, 10, 5, 1, 10)

    const atBirth = recorder()
    field.draw(atBirth, 1)
    expect(atBirth.calls.fill).toBe(0)

    for (let step = 0; step < 10; step++) field.step(1 / 60)
    const shortly = recorder()
    field.draw(shortly, 1)
    expect(shortly.calls.fill).toBe(1)
    expect(shortly.calls.alpha.at(-1)).toBeGreaterThan(0)
  })

  test('a particle expires and the field drains to empty', () => {
    const field = createField()
    for (let i = 0; i < 20; i++) field.spawn(1, 100, 100, 30, 15, 1, 40)

    for (let step = 0; step < 60 * 8; step++) field.step(1 / 60)

    expect(field.count).toBe(0)
  })

  test('occupancy is released on retire, so the field drains cleanly', () => {
    const field = createField()
    for (let i = 0; i < 20; i++) field.spawn(1, 100, 100, 30, 15, 1, 40)
    for (let step = 0; step < 60 * 8; step++) field.step(1 / 60)
    expect(field.count).toBe(0)
    expect(field.heldBy(1)).toBe(0)
  })

  test('draw clears first, strokes never, and sets fillStyle once per colour', () => {
    const field = createField()
    for (let i = 0; i < 120; i++) field.spawn(1, 200, 100, 40, 20, 1, 120)
    // Step first: a particle is born at zero alpha and fades in over
    // the first tenth of its life, so drawing at age 0 correctly emits
    // no dots at all.
    for (let step = 0; step < 20; step++) field.step(1 / 60)

    const ctx = recorder()
    field.draw(ctx, 2)

    expect(ctx.calls.clear).toBe(1)
    expect(ctx.calls.stroke).toBe(0)
    // two colours, so at most two fillStyle assignments regardless of
    // how many particles are alive
    expect(ctx.calls.fillStyle.size).toBeLessThanOrEqual(2)
    expect(ctx.calls.fill).toBeGreaterThan(0)
    expect(ctx.calls.fill).toBeLessThanOrEqual(field.count)
    // alpha never leaves 0..1
    for (const a of ctx.calls.alpha) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
    }
  })

  test('an empty field still clears, so no frame is stranded', () => {
    const field = createField()
    const ctx = recorder()
    field.draw(ctx, 1)
    expect(ctx.calls.clear).toBe(1)
    expect(ctx.calls.fill).toBe(0)
  })

  test('clear() empties the field and all occupancy', () => {
    const field = createField()
    for (let i = 0; i < 30; i++) field.spawn(3, 100, 100, 30, 15, 1, 30)
    field.clear()
    expect(field.count).toBe(0)
    expect(field.heldBy(3)).toBe(0)
  })

  test('palette falls back to brand values when there is no document', () => {
    const palette = readPalette(null)
    expect(palette.paper).toHaveLength(3)
    expect(palette.signal).toHaveLength(3)
    expect(palette.signal).toEqual([255, 31, 45])
  })
})
