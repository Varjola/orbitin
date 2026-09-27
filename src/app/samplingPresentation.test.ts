import { describe, expect, it } from 'vitest'
import { degToRad, TAU } from '../core/angles.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { createTrajectoryEvaluator } from '../simulation/OrbitalObject.ts'
import { advanceSamplingState, initialSamplingState, resetSamplingMeasurement, type SamplingState } from './samplingPresentation.ts'

/** Drive the state to a steady band at a constant per-frame advance. The
 *  smoothing is an exponential moving average, so a few frames settle it. */
const settle = (advanceRad: number, frames = 60, from: SamplingState = initialSamplingState()): SamplingState => {
  let state = from
  // Continue from wherever the incoming state left off; restarting the
  // unwrapped anomaly would manufacture one enormous fake interval.
  let unwrapped = from.previousUnwrappedTrueAnomalyRad ?? 0
  for (let frame = 0; frame < frames; frame += 1) {
    unwrapped += advanceRad
    state = advanceSamplingState(state, unwrapped)
  }
  return state
}

describe('sampling bands', () => {
  it.each([
    ['well inside tracking', 1, 'tracking'],
    ['just below the sampled edge', 4, 'tracking'],
    ['just above the sampled edge', 8, 'sampled'],
    ['well inside sampled', 30, 'sampled'],
    ['just above the planeOnly edge', 70, 'planeOnly'],
    ['far above the planeOnly edge', 200, 'planeOnly'],
  ])('classifies %s as %s', (_name, advanceDeg, expected) => {
    expect(settle(degToRad(advanceDeg)).band).toBe(expected)
  })

  it('holds the previous band inside the hysteresis overlaps, in both directions', () => {
    // 5.5 deg/frame is inside the 5-to-6 overlap.
    const risingFromTracking = settle(degToRad(5.5))
    expect(risingFromTracking.band).toBe('tracking')
    const fallingFromSampled = settle(degToRad(5.5), 60, settle(degToRad(30)))
    expect(fallingFromSampled.band).toBe('sampled')
    // 55 deg/frame is inside the 50-to-60 overlap.
    expect(settle(degToRad(55), 60, settle(degToRad(30))).band).toBe('sampled')
    expect(settle(degToRad(55), 60, settle(degToRad(200))).band).toBe('planeOnly')
  })

  it('treats reversed time exactly like forward time', () => {
    let forward = initialSamplingState()
    let backward = initialSamplingState()
    let up = 0
    let down = 0
    for (let frame = 0; frame < 60; frame += 1) {
      up += degToRad(30)
      down -= degToRad(30)
      forward = advanceSamplingState(forward, up)
      backward = advanceSamplingState(backward, down)
    }
    expect(backward.band).toBe(forward.band)
    expect(backward.smoothedAdvanceRad).toBeCloseTo(forward.smoothedAdvanceRad, 12)
  })

  it('discards one frame after a reset instead of reporting a spurious advance', () => {
    const running = settle(degToRad(30))
    expect(running.band).toBe('sampled')
    // The runtime resets the entry's measurement, then the origin of the
    // unwrapped anomaly jumps because the epoch moved.
    const firstAfterReset = advanceSamplingState(resetSamplingMeasurement(running), 12345.678)
    // The band is unchanged from the frame before the reset, and the enormous
    // apparent interval is not measured at all.
    expect(firstAfterReset.band).toBe(running.band)
    expect(firstAfterReset.smoothedAdvanceRad).toBe(running.smoothedAdvanceRad)
    // Only the following frame classifies, and it does so from a real interval.
    const second = advanceSamplingState(firstAfterReset, 12345.678 + degToRad(30))
    expect(second.previousUnwrappedTrueAnomalyRad).toBe(12345.678 + degToRad(30))
    expect(second.band).toBe('sampled')
    // A brand-new object, by contrast, starts in tracking with nothing measured.
    expect(advanceSamplingState(initialSamplingState(), 5)).toMatchObject({ band: 'tracking', smoothedAdvanceRad: 0 })
  })
})

describe('the metric is conic-aware', () => {
  const ellipticalEvaluator = (referenceAnomalyRad: number) => createTrajectoryEvaluator({
    kind: 'driftingConic',
    meanElements: { semiMajorAxisKm: 26600, eccentricity: 0.74, inclinationRad: degToRad(63.5), raanRad: 0, argOfPeriapsisRad: 0 },
    phase: { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: referenceAnomalyRad },
  })

  const advanceOver = (referenceAnomalyRad: number, intervalSeconds: number) => {
    const evaluator = ellipticalEvaluator(referenceAnomalyRad)
    const before = evaluator.sampleAt(SIMULATION_START_INSTANT).unwrappedTrueAnomalyRad
    const after = evaluator.sampleAt({ unixSeconds: SIMULATION_START_INSTANT.unixSeconds + intervalSeconds }).unwrappedTrueAnomalyRad
    return Math.abs(after - before)
  }

  // A metric derived from mean motion alone would return the
  // same value at both ends of the orbit and fail this.
  it('separates periapsis from apoapsis by (1 + e)^2 / (1 - e)^2 = 44.8', () => {
    const shortInterval = 1
    const nearPeriapsis = advanceOver(0, shortInterval)
    const nearApoapsis = advanceOver(Math.PI, shortInterval)
    const e = 0.74
    expect(nearPeriapsis / nearApoapsis).toBeCloseTo((1 + e) ** 2 / (1 - e) ** 2, 1)
    expect(nearPeriapsis / nearApoapsis / 44.8).toBeCloseTo(1, 1)
  })

  it('changes band within one orbit at a 200,000x-equivalent interval', () => {
    // 200,000x at 60 fps is 200000 / 60 s of simulated time per rendered frame.
    const interval = 200000 / 60
    expect(settle(advanceOver(0, interval)).band).toBe('planeOnly')
    expect(['tracking', 'sampled']).toContain(settle(advanceOver(Math.PI, interval)).band)
  })

  // An implementation that subtracted wrapped endpoint
  // angles would return at most PI and must fail this.
  it('does not alias across whole revolutions', () => {
    const evaluator = ellipticalEvaluator(0)
    const periodSeconds = TAU / evaluator.sampleAt(SIMULATION_START_INSTANT).angleRates.meanAnomalyRadPerSecond
    const advance = advanceOver(0, 3.5 * periodSeconds)
    expect(advance).toBeCloseTo(3.5 * TAU, 1)
    expect(advance).toBeGreaterThan(20)
  })

  // At e = 0 true and mean anomaly advance together, so the circular table
  // applies directly.
  it('reproduces the circular table: LEO reaches planeOnly where GEO stays sampled', () => {
    const interval = 200000 / 60
    const circular = (a: number) => {
      const evaluator = createTrajectoryEvaluator({
        kind: 'driftingConic',
        meanElements: { semiMajorAxisKm: a, eccentricity: 0, inclinationRad: degToRad(51.5), raanRad: 0, argOfPeriapsisRad: 0 },
        phase: { referenceInstant: { ...SIMULATION_START_INSTANT }, meanAnomalyAtReferenceRad: 0 },
      })
      const before = evaluator.sampleAt(SIMULATION_START_INSTANT).unwrappedTrueAnomalyRad
      const after = evaluator.sampleAt({ unixSeconds: SIMULATION_START_INSTANT.unixSeconds + interval }).unwrappedTrueAnomalyRad
      return Math.abs(after - before)
    }
    expect(settle(circular(7178.137)).band).toBe('planeOnly')
    expect(settle(circular(42164.17)).band).toBe('sampled')
  })
})
