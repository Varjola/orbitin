import { format, text } from '../i18n/index.ts'
import type { OrbitSource } from '../simulation/OrbitalObject.ts'
import type { SensorCapLimitedBy } from '../simulation/sensorFootprint.ts'

export function sensorNoteForSource(source: OrbitSource): string {
  return source.kind === 'keplerian' ? text().sensor.keplerianNote : text().sensor.realObjectNote
}

/** What bounds a cap, in the learner's terms. */
export function sensorLimitLabel(limitedBy: SensorCapLimitedBy): string {
  return text().sensor.limitLabels[limitedBy]
}

export interface SensorRangeNoteInput {
  readonly authoredRad: number
  /** Widest useful ray angle at the control's reference radius. */
  readonly usefulLimitRad: number
  readonly minimumGroundElevationRad: number
  /** Eccentric orbits are scaled at periapsis, where the range is widest. */
  readonly eccentric: boolean
}

/** Beneath the half-angle control: the useful range in degrees, and what an
 *  authored angle past it means. The authored angle is reported, never changed. */
export function sensorFieldOfViewRangeNote(input: SensorRangeNoteInput): string {
  const t = text().sensor
  const range = t.usefulRange(where(input), degrees(input.usefulLimitRad))
  if (input.authoredRad <= input.usefulLimitRad) return range
  return `${range} ${t.pastLimit(degrees(input.authoredRad), limitName(input))}`
}

/** Beneath the steering control. Useful steering is what remains between the
 *  half-angle and the limit, because the field of regard's ray limit is their sum. */
export function sensorSteeringRangeNote(input: SensorRangeNoteInput & { readonly fieldOfViewHalfAngleRad: number }): string {
  const t = text().sensor
  const useful = input.usefulLimitRad - input.fieldOfViewHalfAngleRad
  if (!(useful > 0)) return t.steeringBlocked(limitName(input), where(input))
  const range = t.usefulSteering(where(input), degrees(useful))
  if (input.authoredRad <= useful) return range
  return `${range} ${t.steeringPastLimit(degrees(input.authoredRad), limitName(input))}`
}

function where(input: SensorRangeNoteInput): string { return input.eccentric ? text().sensor.nearPeriapsis : text().sensor.atThisOrbit }
function limitName(input: SensorRangeNoteInput): string { return input.minimumGroundElevationRad > 0 ? text().sensor.minimumElevationLimit : text().sensor.theHorizon }
function degrees(rad: number): string { return format().degrees(rad, 2) }
