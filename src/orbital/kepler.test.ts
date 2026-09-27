import { describe, expect, it } from 'vitest'
import { TAU, wrapRadians } from '../core/angles.ts'
import { meanFromTrueAnomaly, solveEccentricAnomaly, trueAnomalyAtMean } from './kepler.ts'

describe('Kepler solver', () => {
  it('round-trips mean and true anomaly across eccentricities', () => {
    for (const eccentricity of [0, 0.01, 0.3, 0.7, 0.9]) {
      for (let index = 0; index < 64; index += 1) {
        const mean = (index / 64) * TAU
        const trueAnomaly = trueAnomalyAtMean(mean, eccentricity)
        const roundTrip = meanFromTrueAnomaly(trueAnomaly, eccentricity)
        const wrappedError = Math.abs(wrapRadians(roundTrip - mean))
        expect(Math.min(wrappedError, TAU - wrappedError)).toBeLessThan(1e-10)
      }
    }
  })

  it('solves a high-eccentricity case accurately', () => {
    const eccentric = solveEccentricAnomaly(2.4, 0.9)
    expect(eccentric - 0.9 * Math.sin(eccentric)).toBeCloseTo(2.4, 12)
  })
})
