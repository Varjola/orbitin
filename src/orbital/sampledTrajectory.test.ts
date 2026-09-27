import { describe, expect, it } from 'vitest'
import type { OrbitalState } from './propagator.ts'
import { sampleSgp4Trajectory, sampledTrajectoryNeedsRecenter } from './sampledTrajectory.ts'

const period = 120
const centre = { unixSeconds: 1000 }
const stateAt = (instant: { unixSeconds: number }): OrbitalState => ({
  positionProjectInertialKm: { x: instant.unixSeconds, y: 1, z: 2 },
  velocityProjectInertialKmPerSecond: { x: 0, y: 1, z: 0 },
})

describe('sampled TLE trajectory windows', () => {
  it('injects the current frame state at the exact centre and samples the rest independently', () => {
    const currentState = stateAt(centre)
    const calls: number[] = []
    const window = sampleSgp4Trajectory({
      centreInstant: centre,
      nominalPeriodSeconds: period,
      currentState,
      intervals: 8,
      stateAt: (instant) => { calls.push(instant.unixSeconds); return stateAt(instant) },
    })!
    expect(window.failedSampleCount).toBe(0)
    expect(calls).not.toContain(centre.unixSeconds)
    expect(window.segments.flat().some((point) => point === currentState.positionProjectInertialKm)).toBe(true)
  })

  it('clips failed samples instead of bridging across them', () => {
    const currentState = stateAt(centre)
    const window = sampleSgp4Trajectory({
      centreInstant: centre,
      nominalPeriodSeconds: period,
      currentState,
      intervals: 8,
      stateAt: (instant) => {
        if (instant.unixSeconds === centre.unixSeconds + period / 8) throw new Error('fixture failure')
        return stateAt(instant)
      },
    })!
    expect(window.failedSampleCount).toBe(1)
    expect(window.clipped).toBe(true)
    expect(window.segments.length).toBe(2)
    expect(window.segments.every((segment) => segment.length >= 2)).toBe(true)
  })

  it('uses period/32 hysteresis for rebuilds', () => {
    expect(sampledTrajectoryNeedsRecenter({ unixSeconds: 1000 + period / 32 }, centre, period)).toBe(false)
    expect(sampledTrajectoryNeedsRecenter({ unixSeconds: 1000 + period / 32 + 0.01 }, centre, period)).toBe(true)
  })
})
