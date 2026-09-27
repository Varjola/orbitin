import { describe, expect, it } from 'vitest'
import { degToRad, wrapRadians } from '../core/angles.ts'
import {
  angleReadoutsFor,
  classifyElements,
  NODE_READOUT_SUPPRESSION_INCLINATION_RAD,
  PERIAPSIS_READOUT_SUPPRESSION_ECCENTRICITY,
} from './elementConditioning.ts'
import { j2SecularRates } from './j2Secular.ts'
import type { OrbitGeometry } from './geometry.ts'

const elements = (inclinationDeg: number, eccentricity: number): OrbitGeometry =>
  ({ semiMajorAxisKm: 7178.137, eccentricity, inclinationRad: degToRad(inclinationDeg), raanRad: 1.1, argOfPeriapsisRad: 2.2 })

describe('element conditioning', () => {
  // Each assertion is named for what it is. An orbit inside
  // the suppression band has a node and a periapsis; only the readout is
  // withheld.
  it('reports a true singularity at i = 0, i = PI and e = 0', () => {
    expect(classifyElements(elements(0, 0.1)).node).toEqual({ kind: 'singular' })
    expect(classifyElements({ ...elements(0, 0.1), inclinationRad: Math.PI }).node).toEqual({ kind: 'singular' })
    expect(classifyElements(elements(51.5, 0)).periapsis).toEqual({ kind: 'singular' })
  })

  it('reports a suppressed readout - not a singularity - at i = 0.2 deg and e = 5e-4', () => {
    expect(classifyElements(elements(0.2, 0.1)).node).toEqual({
      kind: 'illConditioned', inclinationRad: degToRad(0.2), thresholdRad: NODE_READOUT_SUPPRESSION_INCLINATION_RAD,
    })
    expect(classifyElements(elements(179.8, 0.1)).node).toMatchObject({ kind: 'illConditioned' })
    expect(classifyElements(elements(51.5, 5e-4)).periapsis).toEqual({
      kind: 'illConditioned', eccentricity: 5e-4, threshold: PERIAPSIS_READOUT_SUPPRESSION_ECCENTRICITY,
    })
  })

  it('reports both elements defined at i = 51.5 deg and e = 0.01', () => {
    expect(classifyElements(elements(51.5, 0.01))).toEqual({ node: { kind: 'defined' }, periapsis: { kind: 'defined' } })
  })
})

describe('nonsingular angle readouts', () => {
  const meanAnomalyRad = 0.7

  // Every combination is exercised through both the singular
  // and the ill-conditioned route, to prove the substitution does not depend on
  // which one applies.
  const cases = [
    ['both reportable', 51.5, 0.01, ['raan', 'argOfPeriapsis']],
    ['node only, periapsis singular', 51.5, 0, ['raan', 'argOfLatitude']],
    ['node only, periapsis suppressed', 51.5, 5e-4, ['raan', 'argOfLatitude']],
    ['periapsis only, node singular', 0, 0.01, ['longitudeOfPeriapsis']],
    ['periapsis only, node suppressed', 0.2, 0.01, ['longitudeOfPeriapsis']],
    ['neither, both singular', 0, 0, ['meanLongitude']],
    ['neither, both suppressed', 0.2, 5e-4, ['meanLongitude']],
    ['neither, mixed routes', 0, 5e-4, ['meanLongitude']],
  ] as const

  it.each(cases)('selects the documented combination when %s', (_name, inclinationDeg, eccentricity, expectedKinds) => {
    const geometry = elements(inclinationDeg, eccentricity)
    const rates = j2SecularRates(geometry)
    const readouts = angleReadoutsFor(geometry, meanAnomalyRad, rates)
    expect(readouts.map((readout) => readout.kind)).toEqual([...expectedKinds])

    const expectedValue: Record<string, number> = {
      raan: geometry.raanRad,
      argOfPeriapsis: geometry.argOfPeriapsisRad,
      argOfLatitude: wrapRadians(geometry.argOfPeriapsisRad + meanAnomalyRad),
      longitudeOfPeriapsis: wrapRadians(geometry.raanRad + geometry.argOfPeriapsisRad),
      meanLongitude: wrapRadians(geometry.raanRad + geometry.argOfPeriapsisRad + meanAnomalyRad),
    }
    const expectedRate: Record<string, number> = {
      raan: rates.raanRadPerSecond,
      argOfPeriapsis: rates.argOfPeriapsisRadPerSecond,
      argOfLatitude: rates.argOfPeriapsisRadPerSecond + rates.meanAnomalyRadPerSecond,
      longitudeOfPeriapsis: rates.raanRadPerSecond + rates.argOfPeriapsisRadPerSecond,
      meanLongitude: rates.raanRadPerSecond + rates.argOfPeriapsisRadPerSecond + rates.meanAnomalyRadPerSecond,
    }
    for (const readout of readouts) {
      expect(readout.valueRad).toBeCloseTo(expectedValue[readout.kind], 15)
      expect(readout.rateRadPerSecond / expectedRate[readout.kind]).toBeCloseTo(1, 15)
    }
  })
})
