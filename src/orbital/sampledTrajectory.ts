import type { SimulationInstant } from '../core/time.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import type { OrbitalState } from './propagator.ts'

export const SAMPLED_TRAJECTORY_INTERVALS = 256
export const SAMPLED_TRAJECTORY_REBUILD_DENOMINATOR = 32

export interface SampledTrajectoryWindow {
  readonly centreInstant: SimulationInstant
  readonly nominalPeriodSeconds: number
  readonly segments: readonly (readonly ProjectInertialVec3[])[]
  readonly failedSampleCount: number
  readonly clipped: boolean
}

export interface SampledTrajectoryOptions {
  readonly centreInstant: SimulationInstant
  readonly nominalPeriodSeconds: number
  readonly currentState: OrbitalState
  readonly stateAt: (instant: SimulationInstant) => OrbitalState
  readonly intervals?: number
}

/** Sample one nominal period around the current state. The centre state is
 * injected exactly so the path and body share the same successful evaluation. */
export function sampleSgp4Trajectory(options: SampledTrajectoryOptions): SampledTrajectoryWindow | null {
  const intervals = options.intervals ?? SAMPLED_TRAJECTORY_INTERVALS
  if (!Number.isInteger(intervals) || intervals < 2 || intervals % 2 !== 0 || !Number.isFinite(options.nominalPeriodSeconds) || options.nominalPeriodSeconds <= 0) return null
  const centre = options.centreInstant.unixSeconds
  const samples: Array<ProjectInertialVec3 | null> = []
  let failedSampleCount = 0
  for (let index = 0; index <= intervals; index += 1) {
    const instant = { unixSeconds: centre - options.nominalPeriodSeconds / 2 + options.nominalPeriodSeconds * index / intervals }
    if (index === intervals / 2) {
      samples.push(options.currentState.positionProjectInertialKm)
      continue
    }
    try {
      samples.push(options.stateAt(instant).positionProjectInertialKm)
    } catch {
      samples.push(null)
      failedSampleCount += 1
    }
  }
  const segments: Array<readonly ProjectInertialVec3[]> = []
  let current: ProjectInertialVec3[] = []
  const finish = (): void => { if (current.length >= 2) segments.push(current); current = [] }
  for (const point of samples) {
    if (!point) { finish(); continue }
    current.push(point)
  }
  finish()
  const centreSegment = segments.find((segment) => segment.some((point) => point === options.currentState.positionProjectInertialKm))
  if (!centreSegment) return null
  return { centreInstant: { ...options.centreInstant }, nominalPeriodSeconds: options.nominalPeriodSeconds, segments, failedSampleCount, clipped: failedSampleCount > 0 }
}

export function sampledTrajectoryNeedsRecenter(instant: SimulationInstant, centreInstant: SimulationInstant, nominalPeriodSeconds: number): boolean {
  return !Number.isFinite(nominalPeriodSeconds) || nominalPeriodSeconds <= 0 || Math.abs(instant.unixSeconds - centreInstant.unixSeconds) > nominalPeriodSeconds / SAMPLED_TRAJECTORY_REBUILD_DENOMINATOR
}
