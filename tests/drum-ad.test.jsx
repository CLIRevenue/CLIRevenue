/* =============================================================
   CLIRevenue — drum surface geometry tests
   -------------------------------------------------------------
   Unit tests for the pure math in drumSurface.js. These run in
   plain Node (no DOM, no ogl, no React) and verify the
   projection conventions against the Cylinder geometry and the
   drum's camera rig.
   ============================================================= */

import { describe, it, expect } from 'vitest'
import {
  RADIUS,
  HEIGHT,
  TILE_W,
  TILE_H,
  DRUM_PANELS,
  DRUM_AD_PANEL,
  DRUM_AD_BAND,
  DRUM_AD_FACE_WINDOW_DEG,
  DRUM_AD_SAMPLES,
  panelFacingDeg,
  tileToObject,
  projectToScreen,
} from '../src/components/console/drumSurface.js'

const TAU = Math.PI * 2

describe('drum surface geometry', () => {
  it('exports the expected constants', () => {
    expect(RADIUS).toBe(3.0)
    expect(HEIGHT).toBe(2.6)
    expect(TILE_W).toBe(512)
    expect(TILE_H).toBe(706)
    expect(DRUM_PANELS).toBe(8)
    expect(DRUM_AD_PANEL).toBe(7)
    expect(DRUM_AD_BAND).toEqual({ x: 42, y: 446, w: 428, h: 100 })
    expect(DRUM_AD_FACE_WINDOW_DEG).toBe(30)
    expect(DRUM_AD_SAMPLES).toBe(9)
  })

  it('panelFacingDeg returns 0 at dead front and 180 at the back', () => {
    // Panel 0 centre is at 0 rad (phi = 2π * 0.5/8 = π/8 from panel edge, but centre is panel 0 + 0.5)
    // At angle = -centre, the panel is dead front
    const centre0 = ((0 + 0.5) / DRUM_PANELS) * TAU
    expect(panelFacingDeg(-centre0, 0)).toBeCloseTo(0, 5)
    expect(panelFacingDeg(-centre0 + Math.PI, 0)).toBeCloseTo(180, 5)
  })

  it('panelFacingDeg is symmetric around dead front', () => {
    const angle = 0.5
    const facing = panelFacingDeg(angle, 3)
    expect(facing).toBeGreaterThanOrEqual(0)
    expect(facing).toBeLessThanOrEqual(180)
  })

  it('tileToObject maps tile coordinates to cylinder object space', () => {
    // Panel 0, tile centre: u=0.5, v=0.5
    // phi = (0 + 0.5) * TAU / 8 = TAU/16
    // y = HEIGHT/2 * (1 - 2*0.5) = 0
    const p = tileToObject(0, TILE_W / 2, TILE_H / 2)
    const expectedPhi = TAU / 16
    expect(p[0]).toBeCloseTo(RADIUS * Math.sin(expectedPhi), 5)
    expect(p[1]).toBeCloseTo(0, 5)
    expect(p[2]).toBeCloseTo(RADIUS * Math.cos(expectedPhi), 5)
  })

  it('tileToObject top-left of panel 0 maps to +Z, +Y', () => {
    const p = tileToObject(0, 0, 0)
    const phi = 0
    expect(p[0]).toBeCloseTo(RADIUS * Math.sin(phi), 5)
    expect(p[1]).toBeCloseTo(HEIGHT / 2, 5)
    expect(p[2]).toBeCloseTo(RADIUS * Math.cos(phi), 5)
  })

  it('tileToObject bottom-right of panel 0 maps to +Z, -Y', () => {
    const p = tileToObject(0, TILE_W, TILE_H)
    const phi = TAU / 8
    expect(p[0]).toBeCloseTo(RADIUS * Math.sin(phi), 5)
    expect(p[1]).toBeCloseTo(-HEIGHT / 2, 5)
    expect(p[2]).toBeCloseTo(RADIUS * Math.cos(phi), 5)
  })

  it('projectToScreen returns null for zero-size frame', () => {
    const res = projectToScreen([0, 0, 0], new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0), 0, 0)
    expect(res).toBeNull()
  })

  it('projectToScreen returns coordinates for a point in front of the camera', () => {
    // Identity matrices, point at z = 5 (in front of camera looking +Z)
    // w will be positive, so projection succeeds
    const ident = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    const res = projectToScreen([0, 0, 5], ident, ident, ident, 100, 100)
    expect(res).not.toBeNull()
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(2)
    expect(typeof res[0]).toBe('number')
    expect(typeof res[1]).toBe('number')
  })
})