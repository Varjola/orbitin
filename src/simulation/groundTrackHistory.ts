import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { OrbitalState } from '../orbital/propagator.ts'
import {
  groundTrackStepBetween,
  subSatellitePointFromState,
  type GroundTrackSegment,
  type SubSatellitePoint,
} from './groundTrack.ts'

/** Samples per nominal orbital period, matching the window sampler's density so
 *  a recorded trail and a computed window draw the same curve. */
export const GROUND_TRACK_HISTORY_INTERVALS_PER_PERIOD = 256
/** Bounds on the derived step, so a very short or very long period still yields
 *  a sane recording cadence. */
export const GROUND_TRACK_HISTORY_MIN_STEP_SECONDS = 1
export const GROUND_TRACK_HISTORY_MAX_STEP_SECONDS = 600
/** Cadence used when a source exposes no nominal period. */
export const GROUND_TRACK_HISTORY_FALLBACK_STEP_SECONDS = 60
/** Retained points per object. At the default cadence this is roughly seventy
 *  orbits, far beyond any lesson, and caps worst-case memory at eight objects. */
export const GROUND_TRACK_HISTORY_MAX_POINTS = 20000
/** Propagation calls one `advanceTo` may spend. Exceeding it is a skipped
 *  interval, not a reason to block the frame or to invent a bridging line. */
export const GROUND_TRACK_HISTORY_MAX_STEPS_PER_UPDATE = 4096

export interface GroundTrackHistoryAdvanceOptions {
  readonly instant: SimulationInstant
  readonly stateAt: (instant: SimulationInstant) => OrbitalState | null
  readonly earthOrientationAt: (instant: SimulationInstant) => EarthOrientation
}

/** The recording cadence for one object, derived from its nominal period. */
export function groundTrackHistoryStepSeconds(nominalPeriodSeconds: number | null): number {
  if (nominalPeriodSeconds === null || !Number.isFinite(nominalPeriodSeconds) || nominalPeriodSeconds <= 0) {
    return GROUND_TRACK_HISTORY_FALLBACK_STEP_SECONDS
  }
  const step = nominalPeriodSeconds / GROUND_TRACK_HISTORY_INTERVALS_PER_PERIOD
  return Math.min(GROUND_TRACK_HISTORY_MAX_STEP_SECONDS, Math.max(GROUND_TRACK_HISTORY_MIN_STEP_SECONDS, step))
}

/** An accumulated Earth-fixed trail for one object.
 *
 * This is recorded history rather than a computed window, but it is not a
 * per-frame breadcrumb trail. Samples land on a fixed simulation-time grid
 * (`floor(unixSeconds / step)`), so the same object recorded at 30 fps, at
 * 144 fps, or at any playback speed produces the same points at the same
 * instants. The recorder owns no clock and no propagator: the caller supplies
 * `stateAt` and `earthOrientationAt`, exactly as the window sampler does, so
 * ideal two-body, secular-J2 and future SGP4 sources all record unchanged.
 *
 * The recorder is mutable by design. An append-only trail of tens of thousands
 * of points cannot be rebuilt immutably every frame, so the open segment's point
 * array grows in place. Completed segments are never touched again, which lets a
 * view skip re-uploading a segment whose object identity and length are both
 * unchanged.
 */
export class GroundTrackHistoryRecorder {
  readonly stepSeconds: number
  private readonly maxPoints: number
  private readonly maxStepsPerUpdate: number
  private readonly completed: GroundTrackSegment[] = []
  private open: SubSatellitePoint[] = []
  private openSegment: GroundTrackSegment | null = null
  private cachedSegments: readonly GroundTrackSegment[] = []
  private structureDirty = true
  private lastGridIndex: number | null = null
  private points = 0
  private changeRevision = 0

  constructor(
    stepSeconds: number,
    maxPoints: number = GROUND_TRACK_HISTORY_MAX_POINTS,
    maxStepsPerUpdate: number = GROUND_TRACK_HISTORY_MAX_STEPS_PER_UPDATE,
  ) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new Error('Ground-track history step must be positive')
    if (!Number.isInteger(maxPoints) || maxPoints < 2) throw new Error('Ground-track history must retain at least two points')
    if (!Number.isInteger(maxStepsPerUpdate) || maxStepsPerUpdate < 1) throw new Error('Ground-track history step budget must be positive')
    this.stepSeconds = stepSeconds
    this.maxPoints = maxPoints
    this.maxStepsPerUpdate = maxStepsPerUpdate
  }

  /** Drawable segments. Identity is stable for completed segments; the final
   *  open segment keeps one object whose point array grows. */
  get segments(): readonly GroundTrackSegment[] {
    if (this.structureDirty) {
      this.cachedSegments = this.openSegment ? [...this.completed, this.openSegment] : [...this.completed]
      this.structureDirty = false
    }
    return this.cachedSegments
  }

  get pointCount(): number { return this.points }

  /** Bumps whenever a point is appended, dropped, or the trail is cleared, so a
   *  consumer can skip work on the many frames that record nothing. */
  get revision(): number { return this.changeRevision }

  get lastRecordedInstant(): SimulationInstant | null {
    return this.lastGridIndex === null ? null : { unixSeconds: this.lastGridIndex * this.stepSeconds }
  }

  /** Discard the whole trail. Used when the learner jumps the date, reverses
   *  playback, edits the orbit, or turns recording off. */
  clear(): void {
    if (this.points === 0 && this.lastGridIndex === null) return
    this.completed.length = 0
    this.open = []
    this.openSegment = null
    this.lastGridIndex = null
    this.points = 0
    this.structureDirty = true
    this.changeRevision += 1
  }

  /** Record every grid instant from the last recorded one up to `instant`.
   *
   * Time running backwards is the caller's concern rather than a silent reverse
   * recording: it clears and restarts from the new instant, matching the
   * date-jump behaviour. A forward gap wider than the step budget breaks the
   * segment instead of bridging it, so a stalled frame at high playback speed
   * leaves a visible gap rather than a straight line across half the planet.
   */
  advanceTo(options: GroundTrackHistoryAdvanceOptions): void {
    const { instant } = options
    if (!Number.isFinite(instant.unixSeconds)) return
    const targetIndex = Math.floor(instant.unixSeconds / this.stepSeconds)
    if (this.lastGridIndex === null) {
      this.recordGridIndex(targetIndex, options)
      return
    }
    if (targetIndex === this.lastGridIndex) return
    if (targetIndex < this.lastGridIndex) {
      this.clear()
      this.recordGridIndex(targetIndex, options)
      return
    }
    let firstIndex = this.lastGridIndex + 1
    if (targetIndex - this.lastGridIndex > this.maxStepsPerUpdate) {
      this.closeOpenSegment()
      firstIndex = targetIndex - this.maxStepsPerUpdate + 1
    }
    for (let index = firstIndex; index <= targetIndex; index += 1) this.recordGridIndex(index, options)
  }

  private recordGridIndex(gridIndex: number, options: GroundTrackHistoryAdvanceOptions): void {
    this.lastGridIndex = gridIndex
    const instant: SimulationInstant = { unixSeconds: gridIndex * this.stepSeconds }
    let point: SubSatellitePoint | null = null
    try {
      const state = options.stateAt(instant)
      point = state ? subSatellitePointFromState(state, options.earthOrientationAt(instant)) : null
    } catch {
      point = null
    }
    // A failed sample ends the current segment; a later valid one starts a new
    // segment rather than joining across the failure.
    if (!point) { this.closeOpenSegment(); return }
    this.append(point)
  }

  private append(point: SubSatellitePoint): void {
    if (this.open.length === 0) {
      this.open.push(point)
      this.points += 1
      this.changeRevision += 1
      return
    }
    const step = groundTrackStepBetween(this.open[this.open.length - 1], point)
    if (step.kind === 'continue') {
      this.open.push(point)
      this.points += 1
    } else if (step.kind === 'poleSplit') {
      this.open.push(point)
      this.points += 1
      this.closeOpenSegment()
      this.open = [point]
      this.points += 1
    } else {
      this.open.push(step.closing)
      this.points += 1
      this.closeOpenSegment()
      this.open = [step.opening, point]
      this.points += 2
    }
    this.publishOpenSegment()
    this.enforceCap()
    this.changeRevision += 1
  }

  /** A one-point run is not drawable and is dropped rather than kept as a
   *  degenerate segment, matching `segmentGroundTrackSamples`. */
  private closeOpenSegment(): void {
    if (this.open.length >= 2) this.completed.push({ points: this.open })
    else this.points -= this.open.length
    this.open = []
    this.openSegment = null
    this.structureDirty = true
  }

  private publishOpenSegment(): void {
    if (this.open.length >= 2 && !this.openSegment) {
      this.openSegment = { points: this.open }
      this.structureDirty = true
    }
  }

  /** Drop whole completed segments rather than individual points, so the common
   *  case costs one structure change per orbit instead of one per sample. */
  private enforceCap(): void {
    while (this.points > this.maxPoints && this.completed.length > 0) {
      this.points -= this.completed[0].points.length
      this.completed.shift()
      this.structureDirty = true
    }
    if (this.points > this.maxPoints && this.completed.length === 0) {
      const drop = Math.min(this.open.length - 2, Math.ceil(this.maxPoints / 4))
      if (drop > 0) {
        this.open.splice(0, drop)
        this.points -= drop
        this.structureDirty = true
      }
    }
  }
}
