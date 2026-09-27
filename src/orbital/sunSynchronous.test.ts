import { describe, expect, it } from 'vitest'
// Read as text through Vite's ?raw loader, so the architectural tests below need
// no Node type definitions.
import sunSynchronousSource from './sunSynchronous.ts?raw'
import orbitPresetsSource from '../simulation/orbitPresets.ts?raw'
import { radToDeg } from '../core/angles.ts'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { MEAN_SUN_RATE_RAD_PER_SECOND } from '../simulation/meanSun.ts'
import { j2SecularRates } from './j2Secular.ts'
import {
  maximumSunSynchronousSemiMajorAxisKm,
  solveSunSynchronousInclination,
  SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND,
} from './sunSynchronous.ts'

const solvedDeg = (a: number, e = 0) => {
  const solution = solveSunSynchronousInclination(a, e)
  if (solution.kind !== 'solved') throw new Error('expected a solution')
  return radToDeg(solution.inclinationRad)
}

describe('Sun-synchronous solver', () => {
  // The 0.02 deg tolerance is set by the agreement this
  // model can claim against published mission values: Sentinel-2 flies a 786 km
  // Sun-synchronous orbit at 98.62 deg against the 800 km solution below.
  it.each([
    [400, 6778.137, 97.0300],
    [500, 6878.137, 97.4018],
    [600, 6978.137, 97.7877],
    [800, 7178.137, 98.6031],
    [1000, 7378.137, 99.4793],
    [1500, 7878.137, 101.9570],
  ])('solves %i km altitude', (_altitude, a, expectedDeg) => {
    expect(solvedDeg(a)).toBeCloseTo(expectedDeg, 2)
    // Every solution is retrograde, because cos i must be negative.
    expect(solvedDeg(a)).toBeGreaterThan(90)
    expect(solvedDeg(a)).toBeLessThanOrEqual(180)
  })

  it('round-trips: the solved inclination reproduces the target nodal rate', () => {
    for (const a of [6778.137, 6878.137, 7178.137, 7878.137, 10000]) {
      for (const e of [0, 0.001, 0.01]) {
        const solution = solveSunSynchronousInclination(a, e)
        expect(solution.kind).toBe('solved')
        if (solution.kind !== 'solved') continue
        const rates = j2SecularRates({ semiMajorAxisKm: a, eccentricity: e, inclinationRad: solution.inclinationRad, raanRad: 0, argOfPeriapsisRad: 0 })
        expect(Math.abs(rates.raanRadPerSecond - SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND)).toBeLessThan(1e-15)
      }
    }
  })

  // This proves the two agree today. It proves nothing about
  // where the number came from: a primitive number carries no module identity at
  // runtime. The next test is what actually establishes provenance.
  it('uses the mean-Sun rate as its target', () => {
    expect(SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND).toBe(MEAN_SUN_RATE_RAD_PER_SECOND)
  })

  // The architectural ownership invariant, encoded
  // as a test in the style of referenceFrames.types.test.ts. A code-review note
  // could not enforce this, because nothing would fail.
  it('imports its target rate from meanSun.ts and redeclares no literal', () => {
    const source = sunSynchronousSource
    expect(source).toMatch(/import\s*\{[^}]*MEAN_SUN_RATE_RAD_PER_SECOND[^}]*\}\s*from\s*'\.\.\/simulation\/meanSun\.ts'/)
    expect(source).not.toContain('0.98564736')
    expect(source).not.toContain('1.9910639')
  })

  it('reports the attainability bound instead of clamping', () => {
    const bound = maximumSunSynchronousSemiMajorAxisKm(0)
    expect(bound).toBeCloseTo(12352.50, 1)
    expect(bound - EARTH_RADIUS_KM).toBeCloseTo(5974.36, 1)

    expect(solveSunSynchronousInclination(bound - 1, 0).kind).toBe('solved')
    const above = solveSunSynchronousInclination(bound + 1, 0)
    expect(above.kind).toBe('unattainable')
    if (above.kind === 'unattainable') expect(above.maximumSemiMajorAxisKm).toBeCloseTo(bound, 9)

    // The bound itself solves to 180 deg: the last orbit whose plane can keep up
    // does so only by being exactly retrograde-equatorial.
    expect(solvedDeg(bound)).toBeCloseTo(180, 4)

    // The bound is eccentricity dependent through the semi-latus rectum, and
    // *rises* as e grows: p = a(1 - e^2) shrinks, so k = 1.5 n J2 (Re / p)^2
    // grows, and a larger orbit can still keep up.
    const eccentricBound = maximumSunSynchronousSemiMajorAxisKm(0.2)
    expect(eccentricBound).toBeGreaterThan(bound)
    expect(solveSunSynchronousInclination(bound, 0.2).kind).toBe('solved')
    expect(solveSunSynchronousInclination(eccentricBound + 1, 0.2).kind).toBe('unattainable')
    expect(solveSunSynchronousInclination(eccentricBound - 1, 0.2).kind).toBe('solved')
    expect(solvedDeg(eccentricBound, 0.2)).toBeCloseTo(180, 4)
  })

  // No Sun-synchronous inclination literal exists in the product (completion
  // criterion 4): the preset solves it, and the values above are independently
  // published comparison figures carried only by this test.
  it('never needs an inclination literal to build a Sun-synchronous orbit', () => {
    const presets = orbitPresetsSource
    expect(presets).not.toContain('98.60')
    expect(presets).not.toContain('98.6')
  })
})
