import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { solveSunSynchronousInclination } from '../orbital/sunSynchronous.ts'
import { applySnap, buttonStep, CRITICAL_INCLINATION_DEG, dragValue, normalizeRulerValue, rulerSpec, snapAt, stepBy, stepRulerValue, wrapDegrees, type RulerOrbit } from './shapeRulerModel.ts'

const leo: RulerOrbit = { semiMajorAxisKm: EARTH_RADIUS_KM + 800, eccentricity: 0, j2Drift: false }

describe('the Shape ruler', () => {
  it('uses the existing Orbit Lab ranges and steps', () => {
    const expected = { size: [6678, 50000, 1, false], shape: [0, 0.8, 0.001, false], tilt: [0, 180, 0.5, false], node: [0, 360, 0.5, true], periapsis: [0, 360, 0.5, true], position: [0, 360, 0.5, true] } as const
    for (const [parameter, [min, max, step, wraps]] of Object.entries(expected)) {
      const spec = rulerSpec(parameter as keyof typeof expected, leo)
      expect([spec.min, spec.max, spec.step, spec.wraps], parameter).toEqual([min, max, step, wraps])
    }
  })

  it('gives Size a logarithmic altitude scale with room for LEO and GEO', () => {
    const size = rulerSpec('size', leo)
    const at = (altitude: number) => size.valueToPosition(altitude + EARTH_RADIUS_KM)
    expect(at(800) - at(400)).toBeGreaterThanOrEqual(40)
    const span = size.valueToPosition(size.max) - size.valueToPosition(size.min)
    expect(span).toBeGreaterThanOrEqual(900)
    expect(span).toBeLessThanOrEqual(1400)
    // Equal altitude ratios are equal distances.
    expect(at(800) - at(400)).toBeCloseTo(at(20000) - at(10000), 6)
    for (const value of [6678, 7000, 26578, 42164, 50000]) expect(size.positionToValue(size.valueToPosition(value))).toBeCloseTo(value, 6)
    expect(size.snaps.map((snap) => [Math.round(snap.value - EARTH_RADIUS_KM), snap.label])).toEqual([[400, 'spaceStation'], [800, 'earthObservation'], [20200, 'gps'], [35786, 'geostationary']])
  })

  it('snaps within 8 px of a snap point and releases beyond it', () => {
    const tilt = rulerSpec('tilt', leo)
    const polar = tilt.valueToPosition(90)
    expect(applySnap(tilt, polar + 7.9)).toEqual({ value: 90, label: 'polar' })
    expect(applySnap(tilt, polar - 8)).toEqual({ value: 90, label: 'polar' })
    expect(applySnap(tilt, polar + 8.1)).toBeNull()
    // A drag from 51.5° holds at 90° across the threshold, then releases.
    const start = 51.5
    const travel = tilt.valueToPosition(90) - tilt.valueToPosition(start)
    expect(dragValue(tilt, start, -(travel - 8))).toEqual({ value: 90, snap: { value: 90, label: 'polar' } })
    expect(dragValue(tilt, start, -(travel + 8))).toEqual({ value: 90, snap: { value: 90, label: 'polar' } })
    expect(dragValue(tilt, start, -(travel + 12))).toEqual({ value: 92, snap: null })
    // Plain ticks hold too.
    expect(applySnap(rulerSpec('node', leo), rulerSpec('node', leo).valueToPosition(270) + 3)).toEqual({ value: 270, label: null })
  })

  it('adds the critical and Sun-synchronous snaps only with J2 drift on', () => {
    expect(rulerSpec('tilt', leo).snaps.map((snap) => snap.label)).toEqual(['equatorial', 'polar', 'retrograde'])
    const drifting = rulerSpec('tilt', { ...leo, j2Drift: true })
    const solution = solveSunSynchronousInclination(leo.semiMajorAxisKm, 0)
    expect(solution.kind).toBe('solved')
    const sso = solution.kind === 'solved' ? solution.inclinationRad * 180 / Math.PI : NaN
    expect(drifting.snaps.map((snap) => snap.label)).toEqual(['equatorial', 'critical', 'polar', 'sunSynchronous', 'retrograde'])
    expect(drifting.snaps.find((snap) => snap.label === 'critical')!.value).toBeCloseTo(63.435, 3)
    expect(CRITICAL_INCLINATION_DEG).toBeCloseTo(63.4349, 4)
    expect(drifting.snaps.find((snap) => snap.label === 'sunSynchronous')!.value).toBeCloseTo(sso, 10)
    expect(sso).toBeCloseTo(98.6, 1)
    // No Sun-synchronous inclination exists this high.
    expect(rulerSpec('tilt', { semiMajorAxisKm: 20000, eccentricity: 0, j2Drift: true }).snaps.map((snap) => snap.label)).not.toContain('sunSynchronous')
  })

  it('wraps angles into [0°, 360°) and snaps across the seam', () => {
    expect(wrapDegrees(360)).toBe(0)
    expect(wrapDegrees(-0.5)).toBe(359.5)
    expect(wrapDegrees(725)).toBe(5)
    expect(Object.is(wrapDegrees(-0), 0)).toBe(true)
    const node = rulerSpec('node', leo)
    expect(stepBy(node, 0, -1)).toBe(355)
    expect(stepBy(node, 359.5, 1)).toBe(0)
    expect(stepBy(node, 357, 1, 2)).toBe(5)
    expect(normalizeRulerValue(node, -90)).toBe(270)
    // 2 px before 0° from above (at 359.33°) is on the 0° tick.
    expect(applySnap(node, node.valueToPosition(360) - 2)).toEqual({ value: 0, label: null })
    expect(dragValue(node, 1, 6)).toEqual({ value: 0, snap: { value: 0, label: null } })
    expect(dragValue(node, 10, 60)).toEqual({ value: 350, snap: null })
  })

  it('steps by a visible amount onto the button grid, and stops at the limits', () => {
    const shape = rulerSpec('shape', leo)
    expect(stepBy(shape, 0.1, 1)).toBe(0.11)
    expect(stepBy(shape, 0.1, -1, 5)).toBe(0.05)
    expect(stepBy(shape, 0.1234, 1)).toBe(0.13)
    expect(stepBy(shape, 0.0004, -1)).toBe(0)
    expect(stepBy(shape, 0.8, 1)).toBe(0.8)
    expect(stepBy(rulerSpec('tilt', leo), 51.5, 1)).toBe(52)
    expect(stepBy(rulerSpec('position', leo), 42, -1)).toBe(40)
    const size = rulerSpec('size', leo)
    expect([500, 2000, 20000, 36000].map((km) => buttonStep(size, km + EARTH_RADIUS_KM))).toEqual([10, 50, 500, 1000])
    expect(stepBy(size, 6878.137, 1)).toBe(6880)
    expect(stepBy(size, 6880, 1)).toBe(6890)
    expect(stepBy(size, 10000, 1)).toBe(10100)
    expect(stepBy(size, 10000, -1)).toBe(9900)
    expect(stepBy(size, size.min, -1)).toBe(size.min)
    expect(stepBy(size, size.max, 1)).toBe(size.max)
    expect(stepRulerValue(rulerSpec('size', leo), 7000.4)).toBe(7000)
    expect(stepRulerValue(rulerSpec('tilt', leo), 51.26)).toBe(51.5)
    expect(normalizeRulerValue(rulerSpec('tilt', leo), 200)).toBe(180)
    expect(normalizeRulerValue(rulerSpec('tilt', leo), Number.NaN)).toBe(0)
  })

  it('stops a step at a labelled snap point on the way', () => {
    const size = rulerSpec('size', leo)
    expect(stepBy(size, 42000, 1)).toBeCloseTo(EARTH_RADIUS_KM + 35786, 6)
    expect(stepBy(size, EARTH_RADIUS_KM + 35786, 1)).toBe(43000)
    const tilt = rulerSpec('tilt', { ...leo, j2Drift: true })
    const sso = tilt.snaps.find((snap) => snap.label === 'sunSynchronous')!.value
    expect(stepBy(tilt, 98, 1)).toBeCloseTo(sso, 10)
    expect(stepBy(tilt, sso, 1)).toBe(99)
    expect(stepBy(tilt, 99, -1, 3)).toBe(97)
  })

  it('finds the snap a value sits on for its label and value text', () => {
    const position = rulerSpec('position', leo)
    expect(snapAt(position, 180)?.label).toBe('apoapsis')
    expect(snapAt(position, 181)).toBeNull()
    expect(snapAt(rulerSpec('shape', leo), 0)?.label).toBe('circular')
    expect(snapAt(rulerSpec('size', leo), EARTH_RADIUS_KM + 35786)?.label).toBe('geostationary')
  })
})
