import { expect, it } from 'vitest'
import { groupOrbitFacts } from './groupOrbitFacts.ts'

it('summarizes members from their mean elements: median inclination and period, altitude range', () => {
  const facts = groupOrbitFacts([
    { MEAN_MOTION: 2.00565, ECCENTRICITY: 0.01, INCLINATION: 55 },
    { MEAN_MOTION: 2.00561, ECCENTRICITY: 0.002, INCLINATION: 56 },
    { MEAN_MOTION: 2.0057, ECCENTRICITY: 0.005, INCLINATION: 54 },
  ])!
  expect(facts.memberCount).toBe(3)
  expect((facts.medianInclinationRad * 180) / Math.PI).toBeCloseTo(55, 10)
  // Half a sidereal day: about 11 h 58 min.
  expect(facts.medianPeriodSeconds / 60).toBeCloseTo(717.97, 1)
  expect(facts.lowestPerigeeKm).toBeGreaterThan(19_800)
  expect(facts.highestApogeeKm).toBeLessThan(20_500)
  expect(facts.lowestPerigeeKm).toBeLessThan(facts.highestApogeeKm)
})

it('gives an even count the mean of its two middle values, and nothing for no usable member', () => {
  expect((groupOrbitFacts([{ MEAN_MOTION: 1, ECCENTRICITY: 0, INCLINATION: 0 }, { MEAN_MOTION: 1, ECCENTRICITY: 0, INCLINATION: 10 }])!.medianInclinationRad * 180) / Math.PI).toBeCloseTo(5, 10)
  expect(groupOrbitFacts([])).toBeNull()
  expect(groupOrbitFacts([{ MEAN_MOTION: 0, ECCENTRICITY: 0, INCLINATION: 0 }])).toBeNull()
})
