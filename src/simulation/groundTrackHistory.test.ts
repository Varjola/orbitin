import { describe, expect, it } from 'vitest'
import { identityMat3 } from '../core/mat3.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { OrbitalState } from '../orbital/propagator.ts'
import {
  GroundTrackHistoryRecorder,
  groundTrackHistoryStepSeconds,
  GROUND_TRACK_HISTORY_FALLBACK_STEP_SECONDS,
  GROUND_TRACK_HISTORY_MAX_STEP_SECONDS,
  GROUND_TRACK_HISTORY_MIN_STEP_SECONDS,
} from './groundTrackHistory.ts'

const RADIUS_KM = 7000

/** A circular equatorial orbit in the inertial frame, so the recorded longitude
 *  advances smoothly and crosses the antimeridian at a predictable instant. */
function stateAt(instant: SimulationInstant): OrbitalState {
  const angle = instant.unixSeconds / 1000
  return {
    positionProjectInertialKm: { x: RADIUS_KM * Math.cos(angle), y: RADIUS_KM * Math.sin(angle), z: 0 },
    velocityProjectInertialKmPerSecond: { x: -Math.sin(angle), y: Math.cos(angle), z: 0 },
  }
}

/** A non-rotating Earth, so Earth-fixed longitude follows the orbit directly. */
function earthOrientationAt(instant: SimulationInstant): EarthOrientation {
  return {
    instant: { ...instant },
    gmstRad: 0,
    precessionToMeanOfDate: identityMat3(),
    projectInertialToEarthFixed: identityMat3(),
    earthFixedToProjectInertial: identityMat3(),
  }
}

function advanceOptions(unixSeconds: number) {
  return { instant: { unixSeconds }, stateAt, earthOrientationAt }
}

function allPoints(recorder: GroundTrackHistoryRecorder) {
  return recorder.segments.flatMap((segment) => segment.points)
}

describe('groundTrackHistoryStepSeconds', () => {
  it('derives a per-period cadence and falls back without a period', () => {
    expect(groundTrackHistoryStepSeconds(5120)).toBe(20)
    expect(groundTrackHistoryStepSeconds(null)).toBe(GROUND_TRACK_HISTORY_FALLBACK_STEP_SECONDS)
    expect(groundTrackHistoryStepSeconds(Number.NaN)).toBe(GROUND_TRACK_HISTORY_FALLBACK_STEP_SECONDS)
  })

  it('clamps pathological periods rather than recording every millisecond or once an hour', () => {
    expect(groundTrackHistoryStepSeconds(10)).toBe(GROUND_TRACK_HISTORY_MIN_STEP_SECONDS)
    expect(groundTrackHistoryStepSeconds(1e9)).toBe(GROUND_TRACK_HISTORY_MAX_STEP_SECONDS)
  })
})

describe('GroundTrackHistoryRecorder', () => {
  it('records on a fixed grid, so frame rate and playback speed do not change the trail', () => {
    const smooth = new GroundTrackHistoryRecorder(10)
    for (let seconds = 0; seconds <= 600; seconds += 10) smooth.advanceTo(advanceOptions(seconds))
    const coarse = new GroundTrackHistoryRecorder(10)
    coarse.advanceTo(advanceOptions(0))
    coarse.advanceTo(advanceOptions(313))
    coarse.advanceTo(advanceOptions(600))
    const irregular = new GroundTrackHistoryRecorder(10)
    for (const seconds of [0, 7, 8, 55, 56, 57, 240, 599, 600]) irregular.advanceTo(advanceOptions(seconds))

    const expected = allPoints(smooth).map((point) => point.instant.unixSeconds)
    expect(expected).toHaveLength(61)
    expect(allPoints(coarse).map((point) => point.instant.unixSeconds)).toEqual(expected)
    expect(allPoints(irregular).map((point) => point.instant.unixSeconds)).toEqual(expected)
  })

  it('quantises to the grid rather than to the instant recording started', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    recorder.advanceTo(advanceOptions(103))
    recorder.advanceTo(advanceOptions(126))
    expect(allPoints(recorder).map((point) => point.instant.unixSeconds)).toEqual([100, 110, 120])
  })

  it('records nothing and does not change revision within one grid step', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    recorder.advanceTo(advanceOptions(100))
    const revision = recorder.revision
    recorder.advanceTo(advanceOptions(101))
    recorder.advanceTo(advanceOptions(109))
    expect(recorder.revision).toBe(revision)
    expect(recorder.pointCount).toBe(1)
  })

  it('splits at the antimeridian and keeps paired seam points', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    for (let seconds = 3000; seconds <= 3300; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    expect(recorder.segments.length).toBeGreaterThan(1)
    const closing = recorder.segments[0].points.at(-1)!
    const opening = recorder.segments[1].points[0]
    expect(Math.abs(closing.longitudeRad!)).toBeCloseTo(Math.PI, 9)
    expect(Math.abs(opening.longitudeRad!)).toBeCloseTo(Math.PI, 9)
    expect(closing.longitudeRad).toBeCloseTo(-opening.longitudeRad!, 9)
    expect(closing.instant.unixSeconds).toBeCloseTo(opening.instant.unixSeconds, 9)
  })

  it('keeps completed segments identical across appends so a view can skip them', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    for (let seconds = 3000; seconds <= 3300; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    const completed = recorder.segments[0]
    const openLength = recorder.segments.at(-1)!.points.length
    recorder.advanceTo(advanceOptions(3400))
    expect(recorder.segments[0]).toBe(completed)
    expect(recorder.segments.at(-1)!.points.length).toBeGreaterThan(openLength)
  })

  it('clears and restarts when simulation time runs backwards', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    for (let seconds = 0; seconds <= 200; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    expect(recorder.pointCount).toBe(21)
    recorder.advanceTo(advanceOptions(150))
    expect(recorder.pointCount).toBe(1)
    // One point is not a drawable run, so the restarted trail shows nothing yet.
    expect(recorder.segments).toHaveLength(0)
    expect(recorder.lastRecordedInstant).toEqual({ unixSeconds: 150 })
    recorder.advanceTo(advanceOptions(170))
    expect(allPoints(recorder).map((point) => point.instant.unixSeconds)).toEqual([150, 160, 170])
  })

  it('breaks the segment instead of bridging a forward gap wider than the step budget', () => {
    const recorder = new GroundTrackHistoryRecorder(10, 20000, 4)
    for (let seconds = 0; seconds <= 100; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    const before = recorder.segments.length
    recorder.advanceTo(advanceOptions(100000))
    expect(recorder.segments.length).toBe(before + 1)
    const resumed = recorder.segments.at(-1)!.points
    expect(resumed).toHaveLength(4)
    expect(resumed.at(-1)!.instant.unixSeconds).toBe(100000)
    // The skipped interval is a gap, not a straight line across the planet.
    expect(resumed[0].instant.unixSeconds).toBe(99970)
  })

  it('ends the segment on a failed sample and starts a new one when propagation recovers', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    const failing = (instant: SimulationInstant): OrbitalState | null =>
      instant.unixSeconds === 50 ? null : stateAt(instant)
    for (let seconds = 0; seconds <= 100; seconds += 10) {
      recorder.advanceTo({ instant: { unixSeconds: seconds }, stateAt: failing, earthOrientationAt })
    }
    expect(recorder.segments).toHaveLength(2)
    expect(recorder.segments[0].points.at(-1)!.instant.unixSeconds).toBe(40)
    expect(recorder.segments[1].points[0].instant.unixSeconds).toBe(60)
  })

  it('treats a throwing propagator as a failed sample rather than a frame error', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    const throwing = (instant: SimulationInstant): OrbitalState => {
      if (instant.unixSeconds === 50) throw new Error('propagation failed')
      return stateAt(instant)
    }
    for (let seconds = 0; seconds <= 100; seconds += 10) {
      expect(() => recorder.advanceTo({ instant: { unixSeconds: seconds }, stateAt: throwing, earthOrientationAt })).not.toThrow()
    }
    expect(recorder.segments).toHaveLength(2)
  })

  it('bounds retained points by dropping the oldest completed segments', () => {
    const recorder = new GroundTrackHistoryRecorder(10, 400)
    const oldest = () => recorder.segments[0].points[0].instant.unixSeconds
    for (let seconds = 0; seconds <= 10000; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    expect(recorder.pointCount).toBeLessThanOrEqual(400)
    expect(oldest()).toBeGreaterThan(0)
    expect(allPoints(recorder).at(-1)!.instant.unixSeconds).toBe(10000)
  })

  it('clears everything, including the grid anchor', () => {
    const recorder = new GroundTrackHistoryRecorder(10)
    for (let seconds = 0; seconds <= 200; seconds += 10) recorder.advanceTo(advanceOptions(seconds))
    const revision = recorder.revision
    recorder.clear()
    expect(recorder.revision).toBeGreaterThan(revision)
    expect(recorder.segments).toHaveLength(0)
    expect(recorder.pointCount).toBe(0)
    expect(recorder.lastRecordedInstant).toBeNull()
  })

  it('rejects a construction that could never produce a drawable trail', () => {
    expect(() => new GroundTrackHistoryRecorder(0)).toThrow()
    expect(() => new GroundTrackHistoryRecorder(10, 1)).toThrow()
    expect(() => new GroundTrackHistoryRecorder(10, 100, 0)).toThrow()
  })
})
