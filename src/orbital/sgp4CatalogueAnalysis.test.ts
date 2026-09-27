import { describe, expect, it } from 'vitest'
import { meanElementsFromSourceUnits } from '../data/sgp4MeanElements.ts'
import { analyzeSgp4ForCatalogue, WGS72_EARTH_RADIUS_KM } from './sgp4CatalogueAnalysis.ts'
import { createSatelliteJsAdapter } from './satelliteJsAdapter.ts'

const EPOCH = { unixSeconds: Date.UTC(2026, 8, 1, 12) / 1000 }

function elements(meanMotionRevolutionsPerDay: number, eccentricity = 0.001, inclinationDeg = 51.6) {
  return meanElementsFromSourceUnits({
    catalogId: '90001', epoch: EPOCH, meanMotionRevolutionsPerDay,
    meanMotionFirstDerivativeRevolutionsPerDaySquared: 0, meanMotionSecondDerivativeRevolutionsPerDayCubed: 0,
    bstarPerEarthRadius: 0, eccentricity, inclinationDeg, raanDeg: 10, argumentOfPerigeeDeg: 20, meanAnomalyDeg: 30,
  })
}

describe('SGP4 catalogue analysis', () => {
  it('reads semimajor axis, altitudes and recovered period from the initialized record', () => {
    const source = elements(15.5, 0.0004)
    const analysis = analyzeSgp4ForCatalogue(source)
    const { record } = createSatelliteJsAdapter(source)
    expect(analysis).toEqual({
      recoveredPeriodMinutes: (2 * Math.PI) / record.no,
      semimajorAxisKm: record.a * WGS72_EARTH_RADIUS_KM,
      perigeeAltitudeKm: record.altp * WGS72_EARTH_RADIUS_KM,
      apogeeAltitudeKm: record.alta * WGS72_EARTH_RADIUS_KM,
      regime: 'near-earth',
    })
    // Recovered (un-Kozai) mean motion differs from the printed 1440/n period.
    expect(analysis.recoveredPeriodMinutes).not.toBe(1440 / 15.5)
    expect(analysis.recoveredPeriodMinutes).toBeCloseTo(1440 / 15.5, 0)
    expect(analysis.apogeeAltitudeKm).toBeGreaterThan(analysis.perigeeAltitudeKm)
    expect(analyzeSgp4ForCatalogue(elements(1.0027, 0.0002, 0.05)).regime).toBe('deep-space')
  })

  it('straddles the recovered 225-minute deep-space boundary and follows satrec.method', () => {
    // Period falls as mean motion rises; bisect to the boundary in source units.
    let deep = 6.3
    let near = 6.5
    expect(analyzeSgp4ForCatalogue(elements(deep)).recoveredPeriodMinutes).toBeGreaterThan(225)
    expect(analyzeSgp4ForCatalogue(elements(near)).recoveredPeriodMinutes).toBeLessThan(225)
    for (let step = 0; step < 60; step += 1) {
      const middle = (deep + near) / 2
      if (analyzeSgp4ForCatalogue(elements(middle)).recoveredPeriodMinutes >= 225) deep = middle
      else near = middle
    }
    const atOrAbove = analyzeSgp4ForCatalogue(elements(deep))
    const below = analyzeSgp4ForCatalogue(elements(near))
    expect(atOrAbove.recoveredPeriodMinutes).toBeGreaterThanOrEqual(225)
    expect(atOrAbove.recoveredPeriodMinutes - 225).toBeLessThan(1e-9)
    expect(below.recoveredPeriodMinutes).toBeLessThan(225)
    expect([atOrAbove.regime, below.regime]).toEqual(['deep-space', 'near-earth'])
    for (const revolutionsPerDay of [deep, near, 6.0, 6.8]) {
      const source = elements(revolutionsPerDay)
      expect(analyzeSgp4ForCatalogue(source).regime).toBe(createSatelliteJsAdapter(source).record.method === 'd' ? 'deep-space' : 'near-earth')
    }
  })

  it('refuses a record that cannot propagate at its epoch', () => {
    expect(() => analyzeSgp4ForCatalogue(elements(16.5, 0.9))).toThrow()
  })
})
