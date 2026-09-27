import {
  EARTH_MU_KM3_S2,
  MIN_PERIAPSIS_RADIUS_KM,
  SENSOR_ANGLE_SLIDER_STEPS,
  SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD,
  SENSOR_MAX_OFF_NADIR_STEERING_RAD,
  SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD,
} from '../core/constants.ts'
import type { OrbitSource } from './OrbitalObject.ts'
import { offNadirLimitForElevation, surfaceAngularRadiusForOffNadir } from './sensorFootprint.ts'

/** The angle sliders are input devices over the authored
 *  angle, never a second authored quantity.
 *
 *  The learner authors a physical off-nadir angle and always sees and edits it
 *  in degrees. This module decides only where a slider's travel ends and how it
 *  is spent:
 *
 *  - The travel ends at the useful limit for the orbit and the active ground
 *    reach constraint, so none of it is inert. At GEO that is 8.70 deg, not
 *    the 80 deg the authored bound allows.
 *  - The travel is paced half by the angle's fraction of that limit and half by
 *    the Earth-central coverage angle's fraction of the limit's coverage. Pure
 *    angle pacing moves a GEO footprint by percent of Earth per notch near the
 *    limb; pure coverage pacing crowds the first 10 deg at 500 km
 *    into a few dozen notches. Both halves increase with the angle, so the
 *    blend does too and inverts by bisection.
 *
 *  Nothing here is stored. A thumb position is recovered from the authored
 *  angle on every sync, and an authored angle past the useful limit pins the
 *  thumb at the end without being changed. */

/** Weight of the angle fraction in the pacing; coverage takes the remainder. */
export const SENSOR_SLIDER_ANGLE_WEIGHT = 0.5

/** Reference radius for the control mapping only.
 *
 *  Periapsis, not the current radius: the current radius changes every frame
 *  and would slide the control under the learner's finger, and apoapsis would
 *  end an eccentric orbit's control at an angle that is a pinprick near
 *  periapsis. The useful limit is widest at periapsis, so every angle the orbit
 *  can use somewhere stays reachable. Displayed geometry always comes from the
 *  instantaneous result, never from this radius. */
export function sensorControlRadiusKm(source: OrbitSource): number {
  const radius = source.kind === 'keplerian'
    ? source.geometry.semiMajorAxisKm * (1 - source.geometry.eccentricity)
    : sgp4SemiMajorAxisEstimateKm(source.definition.meanElements) * (1 - source.definition.meanElements.eccentricity)
  return Number.isFinite(radius) ? Math.max(MIN_PERIAPSIS_RADIUS_KM, radius) : MIN_PERIAPSIS_RADIUS_KM
}

/** Eccentricity used only to word the useful range: an eccentric orbit's range
 *  is stated at periapsis because that is where the control is scaled. */
export function sensorControlEccentricity(source: OrbitSource): number {
  return source.kind === 'keplerian' ? source.geometry.eccentricity : source.definition.meanElements.eccentricity
}

/** Semi-major axis implied by an SGP4 mean motion. A framing and control-range
 *  estimate only: mean elements are not current osculating elements, and this
 *  value is never shown as a physical readout. */
export function sgp4SemiMajorAxisEstimateKm(elements: { readonly meanMotionRadPerMinute: number }): number {
  const meanMotionRadPerSecond = elements.meanMotionRadPerMinute / 60
  return Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadPerSecond * meanMotionRadPerSecond))
}

/** One slider's travel, expressed as total off-nadir ray angles at the
 *  reference radius. */
export interface SensorAngleSliderScale {
  readonly radiusKm: number
  readonly minimumGroundElevationRad: number
  /** Ray angle at position zero. */
  readonly startAngleRad: number
  /** Ray angle at the last position: the useful limit, unless the authored
   *  bound is tighter. */
  readonly endAngleRad: number
  /** The limit the orbit and reach constraint impose on any ray, whether or
   *  not the authored bound cuts the travel short of it. */
  readonly usefulLimitRad: number
  readonly steps: number
}

/** Field-of-view slider: from the authored floor to the useful limit. */
export function fieldOfViewSliderScale(radiusKm: number, minimumGroundElevationRad: number): SensorAngleSliderScale {
  const usefulLimitRad = offNadirLimitForElevation(radiusKm, minimumGroundElevationRad) ?? 0
  const startAngleRad = SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD
  const endAngleRad = Math.max(startAngleRad, Math.min(usefulLimitRad, SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD))
  return { radiusKm, minimumGroundElevationRad, startAngleRad, endAngleRad, usefulLimitRad, steps: SENSOR_ANGLE_SLIDER_STEPS }
}

/** Steering slider. The field of regard's ray limit is the half-angle plus the
 *  steering, so the travel runs over that total from the current half-angle to
 *  the useful limit, and the steering is the part beyond the half-angle. When
 *  the half-angle already reaches the limit the travel is empty. */
export function steeringSliderScale(radiusKm: number, minimumGroundElevationRad: number, fieldOfViewHalfAngleRad: number): SensorAngleSliderScale {
  const usefulLimitRad = offNadirLimitForElevation(radiusKm, minimumGroundElevationRad) ?? 0
  const startAngleRad = Math.max(0, Number.isFinite(fieldOfViewHalfAngleRad) ? fieldOfViewHalfAngleRad : 0)
  const endAngleRad = Math.max(startAngleRad, Math.min(usefulLimitRad, startAngleRad + SENSOR_MAX_OFF_NADIR_STEERING_RAD))
  return { radiusKm, minimumGroundElevationRad, startAngleRad, endAngleRad, usefulLimitRad, steps: SENSOR_ANGLE_SLIDER_STEPS }
}

/** Thumb position (0..steps) for a ray angle. Angles past the end pin at the
 *  end; the angle itself is not touched. */
export function sliderPositionForAngle(scale: SensorAngleSliderScale, angleRad: number): number {
  if (!(scale.endAngleRad > scale.startAngleRad)) return 0
  const angle = clamp(angleRad, scale.startAngleRad, scale.endAngleRad)
  const low = pacing(scale, scale.startAngleRad)
  const fraction = (pacing(scale, angle) - low) / (pacing(scale, scale.endAngleRad) - low)
  return Math.round(clamp(fraction, 0, 1) * scale.steps)
}

/** Ray angle for a thumb position; the exact inverse of the pacing. */
export function angleForSliderPosition(scale: SensorAngleSliderScale, position: number): number {
  if (!(scale.endAngleRad > scale.startAngleRad)) return scale.startAngleRad
  const clamped = clamp(position, 0, scale.steps)
  if (clamped === 0) return scale.startAngleRad
  if (clamped === scale.steps) return scale.endAngleRad
  const low = pacing(scale, scale.startAngleRad)
  const target = low + (clamped / scale.steps) * (pacing(scale, scale.endAngleRad) - low)
  let lower = scale.startAngleRad
  let upper = scale.endAngleRad
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (lower + upper) / 2
    if (pacing(scale, middle) < target) lower = middle
    else upper = middle
  }
  return (lower + upper) / 2
}

export function fieldOfViewForSliderPosition(scale: SensorAngleSliderScale, position: number): number {
  return clamp(angleForSliderPosition(scale, position), SENSOR_MIN_FIELD_OF_VIEW_HALF_ANGLE_RAD, SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD)
}

export function steeringLimitForSliderPosition(scale: SensorAngleSliderScale, position: number): number {
  return clamp(angleForSliderPosition(scale, position) - scale.startAngleRad, 0, SENSOR_MAX_OFF_NADIR_STEERING_RAD)
}

export function sliderPositionForSteeringLimit(scale: SensorAngleSliderScale, steeringRad: number): number {
  return sliderPositionForAngle(scale, scale.startAngleRad + steeringRad)
}

function pacing(scale: SensorAngleSliderScale, angleRad: number): number {
  const angleFraction = angleRad / scale.endAngleRad
  const endCoverage = coverageAt(scale, scale.endAngleRad)
  const coverageFraction = endCoverage > 0 ? coverageAt(scale, angleRad) / endCoverage : angleFraction
  return SENSOR_SLIDER_ANGLE_WEIGHT * angleFraction + (1 - SENSOR_SLIDER_ANGLE_WEIGHT) * coverageFraction
}

function coverageAt(scale: SensorAngleSliderScale, angleRad: number): number {
  return surfaceAngularRadiusForOffNadir(scale.radiusKm, angleRad, scale.minimumGroundElevationRad)?.angularRadiusRad ?? 0
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low))
}
