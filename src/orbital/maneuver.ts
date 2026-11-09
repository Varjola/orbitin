import { TAU } from '../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM, STANDARD_GRAVITY_KM_S2 } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { addSeconds, type SimulationInstant } from '../core/time.ts'
import { addVec3, crossVec3, dotVec3, lengthVec3, scaleVec3 } from '../core/vec3.ts'
import { meanMotion, type OrbitGeometry } from './geometry.ts'
import { meanFromTrueAnomaly } from './kepler.ts'
import { stateVectorEci } from './keplerian.ts'
import { KeplerianPropagator, type OrbitPhase } from './keplerianPropagator.ts'
import type { OrbitalState } from './propagator.ts'

/** The state after an instantaneous speed change along the velocity:
 *  positive is prograde, negative retrograde. */
export function applyTangentialKick(state: OrbitalState, deltaVKmPerSecond: number): OrbitalState {
  const velocity = state.velocityProjectInertialKmPerSecond
  const speed = lengthVec3(velocity)
  if (speed === 0) throw new Error('A tangential kick needs a non-zero velocity')
  return {
    positionProjectInertialKm: { ...state.positionProjectInertialKm },
    velocityProjectInertialKmPerSecond: addVec3(velocity, scaleVec3(velocity, deltaVKmPerSecond / speed)),
  }
}

/** Positions along the orbit from a true anomaly through `sweepRad` in the
 *  direction of motion, no further apart than `maxStepRad` of true anomaly.
 *  Both ends are included. */
export function sampleArc(geometry: OrbitGeometry, fromTrueAnomalyRad: number, sweepRad: number, maxStepRad: number): ProjectInertialVec3[] {
  if (!(sweepRad >= 0) || !(maxStepRad > 0)) throw new Error('Arc sweep must be non-negative and its step positive')
  const steps = Math.max(1, Math.ceil(sweepRad / maxStepRad))
  const points: ProjectInertialVec3[] = []
  for (let index = 0; index <= steps; index += 1) points.push(stateVectorEci(geometry, fromTrueAnomalyRad + (sweepRad * index) / steps).positionProjectInertialKm)
  return points
}

/** The first instant at or after `after` at which the altitude above the
 *  spherical Earth is at or below `altitudeKm`, or null if the orbit never
 *  gets that low. Analytic, so a long simulation step cannot skip it. */
export function nextInstantAtOrBelowAltitude(geometry: OrbitGeometry, phase: OrbitPhase, altitudeKm: number, after: SimulationInstant): SimulationInstant | null {
  const radiusKm = EARTH_RADIUS_KM + altitudeKm
  const { semiMajorAxisKm: a, eccentricity: e } = geometry
  if (a * (1 - e) > radiusKm) return null
  if (a * (1 + e) <= radiusKm) return { ...after }
  // r <= radiusKm for true anomalies within ±crossing of periapsis.
  // Rounding can carry the cosine just past ±1 when an apsis touches the radius.
  const crossingTrueAnomalyRad = Math.acos(Math.min(1, Math.max(-1, (a * (1 - e * e) / radiusKm - 1) / e)))
  const crossingMeanAnomalyRad = meanFromTrueAnomaly(crossingTrueAnomalyRad, e)
  const meanAnomalyRad = new KeplerianPropagator(geometry, phase).meanAnomalyAt(after)
  if (meanAnomalyRad <= crossingMeanAnomalyRad || meanAnomalyRad >= TAU - crossingMeanAnomalyRad) return { ...after }
  return addSeconds(after, (TAU - crossingMeanAnomalyRad - meanAnomalyRad) / meanMotion(geometry))
}

export interface HohmannTransfer {
  readonly firstKmPerSecond: number
  readonly secondKmPerSecond: number
  readonly totalKmPerSecond: number
  readonly transferSeconds: number
}

/** The two-burn transfer between coplanar circular orbits, in either
 *  direction. Burn sizes are magnitudes. */
export function hohmannTransfer(fromRadiusKm: number, toRadiusKm: number): HohmannTransfer {
  if (!(fromRadiusKm > 0) || !(toRadiusKm > 0)) throw new Error('Orbit radii must be positive')
  const transferSemiMajorAxisKm = (fromRadiusKm + toRadiusKm) / 2
  const speedOnTransfer = (radiusKm: number) => Math.sqrt(EARTH_MU_KM3_S2 * (2 / radiusKm - 1 / transferSemiMajorAxisKm))
  const firstKmPerSecond = Math.abs(speedOnTransfer(fromRadiusKm) - circularSpeed(fromRadiusKm))
  const secondKmPerSecond = Math.abs(circularSpeed(toRadiusKm) - speedOnTransfer(toRadiusKm))
  return {
    firstKmPerSecond,
    secondKmPerSecond,
    totalKmPerSecond: firstKmPerSecond + secondKmPerSecond,
    transferSeconds: Math.PI * Math.sqrt(transferSemiMajorAxisKm ** 3 / EARTH_MU_KM3_S2),
  }
}

export function circularSpeed(radiusKm: number): number {
  return Math.sqrt(EARTH_MU_KM3_S2 / radiusKm)
}

/** The speed change that turns an orbit's plane by `deltaInclinationRad`
 *  without changing its speed, made at a point where it moves at
 *  `speedKmPerSecond`. */
export function planeChangeDeltaV(speedKmPerSecond: number, deltaInclinationRad: number): number {
  return 2 * speedKmPerSecond * Math.sin(Math.abs(deltaInclinationRad) / 2)
}

/** The share of a spacecraft's starting mass that must be propellant to
 *  change its speed by `deltaVKmPerSecond`, from the rocket equation. */
export function propellantFraction(deltaVKmPerSecond: number, specificImpulseSeconds: number): number {
  if (!(specificImpulseSeconds > 0)) throw new Error('Specific impulse must be positive')
  return 1 - Math.exp(-Math.abs(deltaVKmPerSecond) / (specificImpulseSeconds * STANDARD_GRAVITY_KM_S2))
}

/** How far the target is ahead of the observer around the observer's orbit,
 *  in (-π, π]: positive ahead in the direction of motion, negative behind. */
export function phaseAngleRad(observer: OrbitalState, targetPositionKm: ProjectInertialVec3): number {
  const position = observer.positionProjectInertialKm
  const normal = crossVec3(position, observer.velocityProjectInertialKmPerSecond)
  const angle = Math.atan2(dotVec3(normal, crossVec3(position, targetPositionKm)) / lengthVec3(normal), dotVec3(position, targetPositionKm))
  return angle === -Math.PI ? Math.PI : angle
}
