import { degToRad, radToDeg, wrapRadians, wrapRadiansSigned } from '../../core/angles.ts'
import { EARTH_RADIUS_KM, MIN_PERIAPSIS_RADIUS_KM } from '../../core/constants.ts'
import type { SimulationInstant } from '../../core/time.ts'
import { crossVec3, dotVec3, normalizeVec3 } from '../../core/vec3.ts'
import { trueAnomalyAtMean } from '../../orbital/kepler.ts'
import { stateVectorEci } from '../../orbital/keplerian.ts'
import { j2SecularElementsAt, j2SecularRates } from '../../orbital/j2Secular.ts'
import { phaseFromTrueAnomaly } from '../../orbital/keplerianPropagator.ts'
import { hohmannTransfer, phaseAngleRad } from '../../orbital/maneuver.ts'
import { ROUTE_MAX_APOGEE_RADIUS_KM, type RouteSatellite } from './routeModel.ts'
import { satelliteState } from './routeState.ts'

const DAY = 86_400

/** The lowest perigee and highest apogee an object can be given: the route model's. */
export const ROUTE_MIN_ALTITUDE_KM = MIN_PERIAPSIS_RADIUS_KM - EARTH_RADIUS_KM
export const ROUTE_MAX_ALTITUDE_KM = ROUTE_MAX_APOGEE_RADIUS_KM - EARTH_RADIUS_KM
/** Planes this close in inclination can be lined up by J2 alone. */
const LINE_UP_INCLINATION_RAD = degToRad(1)
/** A line-up further off than this is not one worth naming. */
const MAX_LINE_UP_SECONDS = 3650 * DAY

/** An object's orbit as the panel shows it, at an instant: heights above the
 *  surface and angles in degrees, each angle in [0, 360) and the inclination in
 *  [0, 180]. */
export interface RouteOrbitValues {
  readonly perigeeAltitudeKm: number
  readonly apogeeAltitudeKm: number
  readonly inclinationDeg: number
  readonly raanDeg: number
  readonly argOfPerigeeDeg: number
  /** Where the object is along its orbit, from the ascending node. */
  readonly argumentOfLatitudeDeg: number
}

/** The orbit an object is on at an instant, J2 having turned it since it was placed. */
export function orbitValuesAt(satellite: RouteSatellite, instant: SimulationInstant): RouteOrbitValues {
  const drifted = j2SecularElementsAt(satellite.geometry, satellite.phase, instant)
  const { semiMajorAxisKm, eccentricity, inclinationRad, raanRad, argOfPeriapsisRad } = drifted.geometry
  const trueAnomaly = trueAnomalyAtMean(drifted.meanAnomalyRad, eccentricity)
  return {
    perigeeAltitudeKm: semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM,
    inclinationDeg: radToDeg(inclinationRad),
    raanDeg: radToDeg(wrapRadians(raanRad)),
    argOfPerigeeDeg: radToDeg(wrapRadians(argOfPeriapsisRad)),
    argumentOfLatitudeDeg: radToDeg(wrapRadians(argOfPeriapsisRad + trueAnomaly)),
  }
}

/** Keeps a perigee and an apogee within the model's limits, the apogee never below
 *  the perigee. */
export function limitedHeights(perigeeAltitudeKm: number, apogeeAltitudeKm: number): { readonly perigeeAltitudeKm: number; readonly apogeeAltitudeKm: number } {
  const clamp = (value: number) => Math.min(ROUTE_MAX_ALTITUDE_KM, Math.max(ROUTE_MIN_ALTITUDE_KM, value))
  const perigee = clamp(perigeeAltitudeKm)
  return { perigeeAltitudeKm: perigee, apogeeAltitudeKm: Math.max(perigee, clamp(apogeeAltitudeKm)) }
}

/** An object on the orbit these values describe, placed at the instant: its mean
 *  elements start there and drift under J2 from then on. Heights are kept within
 *  the model's limits, so the result can always be planned with. */
export function satelliteFromValues(name: string, values: RouteOrbitValues, instant: SimulationInstant): RouteSatellite {
  const { perigeeAltitudeKm, apogeeAltitudeKm } = limitedHeights(values.perigeeAltitudeKm, values.apogeeAltitudeKm)
  const perigee = EARTH_RADIUS_KM + perigeeAltitudeKm
  const apogee = EARTH_RADIUS_KM + apogeeAltitudeKm
  const eccentricity = (apogee - perigee) / (apogee + perigee)
  // A circular orbit has no perigee to measure from: the node stands in for it.
  const argOfPeriapsisRad = eccentricity === 0 ? 0 : wrapRadians(degToRad(values.argOfPerigeeDeg))
  return {
    name,
    geometry: {
      semiMajorAxisKm: (perigee + apogee) / 2,
      eccentricity,
      inclinationRad: degToRad(Math.min(180, Math.max(0, values.inclinationDeg))),
      raanRad: wrapRadians(degToRad(values.raanDeg)),
      argOfPeriapsisRad,
    },
    phase: phaseFromTrueAnomaly(eccentricity, wrapRadians(degToRad(values.argumentOfLatitudeDeg) - argOfPeriapsisRad), instant),
  }
}

/** The same object at the same place, with some of its orbit's values changed at
 *  the instant. */
export function editedSatellite(satellite: RouteSatellite, instant: SimulationInstant, changes: Partial<RouteOrbitValues>): RouteSatellite {
  return satelliteFromValues(satellite.name, { ...orbitValuesAt(satellite, instant), ...changes }, instant)
}

/** How far the target is ahead of your satellite around your orbit, in (-180, 180]. */
export function phaseAheadDeg(own: RouteSatellite, target: RouteSatellite, instant: SimulationInstant): number {
  return radToDeg(phaseAngleRad(satelliteState(own, instant), satelliteState(target, instant).positionProjectInertialKm))
}

/** The target moved along its own orbit until it is this far ahead of your
 *  satellite, measured in your plane. Its direction from Earth's centre depends
 *  only on where it is along its orbit from the node, u: cos u P + sin u Q. Seen in
 *  your plane that direction is at the asked angle where one combination of
 *  cos u and sin u vanishes, which gives u directly. */
export function targetPlacedAhead(own: RouteSatellite, target: RouteSatellite, instant: SimulationInstant, aheadDeg: number): RouteSatellite {
  const plane = { ...j2SecularElementsAt(target.geometry, target.phase, instant).geometry, eccentricity: 0, argOfPeriapsisRad: 0 }
  const node = normalizeVec3(stateVectorEci(plane, 0).positionProjectInertialKm)
  const beyond = normalizeVec3(stateVectorEci(plane, Math.PI / 2).positionProjectInertialKm)
  const you = satelliteState(own, instant)
  const along = normalizeVec3(you.positionProjectInertialKm)
  const across = crossVec3(normalizeVec3(crossVec3(you.positionProjectInertialKm, you.velocityProjectInertialKmPerSecond)), along)
  const [a, b, c, d] = [dotVec3(node, along), dotVec3(beyond, along), dotVec3(node, across), dotVec3(beyond, across)]
  const angle = degToRad(aheadDeg)
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)]
  let u = Math.atan2(c * cos - a * sin, b * sin - d * cos)
  // Of the two places on the line, the one in front of the angle rather than behind it.
  if ((a * Math.cos(u) + b * Math.sin(u)) * cos + (c * Math.cos(u) + d * Math.sin(u)) * sin < 0) u += Math.PI
  return satelliteFromValues(target.name, { ...orbitValuesAt(target, instant), argumentOfLatitudeDeg: radToDeg(wrapRadians(u)) }, instant)
}

/** What the panel says about how far apart the two are. */
export interface RouteSeparation {
  /** The target's mean height less yours. */
  readonly altitudeGapKm: number
  readonly planeAngleRad: number
  /** Target ahead of you around your orbit, in (-π, π]. */
  readonly phaseAheadRad: number
  /** How fast J2 turns the target's node against yours, signed. */
  readonly nodeDriftRadPerDay: number
  /** When J2 alone brings the nodes together, if the inclinations are close enough
   *  for that to line the planes up, and within ten years. */
  readonly lineUpSeconds: number | null
  /** A Hohmann transfer between the two heights: the least a change of height costs. */
  readonly altitudeOnlyKmPerSecond: number
}

/** The angle between two orbit planes: how far the velocity has to turn. */
export function planeAngleBetween(a: Pick<RouteSatellite['geometry'], 'inclinationRad' | 'raanRad'>, b: Pick<RouteSatellite['geometry'], 'inclinationRad' | 'raanRad'>): number {
  const cosine = Math.cos(a.inclinationRad) * Math.cos(b.inclinationRad) + Math.sin(a.inclinationRad) * Math.sin(b.inclinationRad) * Math.cos(a.raanRad - b.raanRad)
  return Math.acos(Math.min(1, Math.max(-1, cosine)))
}

export function routeSeparation(own: RouteSatellite, target: RouteSatellite, instant: SimulationInstant): RouteSeparation {
  const a = j2SecularElementsAt(own.geometry, own.phase, instant).geometry
  const b = j2SecularElementsAt(target.geometry, target.phase, instant).geometry
  const drift = j2SecularRates(b).raanRadPerSecond - j2SecularRates(a).raanRadPerSecond
  // The target's node comes round to yours the short way when it drifts back
  // towards it, and the long way round when it drifts away.
  const gap = wrapRadiansSigned(b.raanRad - a.raanRad)
  const closing = Math.sign(drift) !== Math.sign(gap)
  const sameTilt = Math.abs(a.inclinationRad - b.inclinationRad) <= LINE_UP_INCLINATION_RAD
  const lineUp = gap === 0 ? 0 : drift === 0 ? null : (closing ? Math.abs(gap) : 2 * Math.PI - Math.abs(gap)) / Math.abs(drift)
  return {
    altitudeGapKm: b.semiMajorAxisKm - a.semiMajorAxisKm,
    planeAngleRad: planeAngleBetween(a, b),
    phaseAheadRad: phaseAngleRad(satelliteState(own, instant), satelliteState(target, instant).positionProjectInertialKm),
    nodeDriftRadPerDay: drift * DAY,
    lineUpSeconds: sameTilt && lineUp !== null && lineUp <= MAX_LINE_UP_SECONDS ? lineUp : null,
    altitudeOnlyKmPerSecond: hohmannTransfer(a.semiMajorAxisKm, b.semiMajorAxisKm).totalKmPerSecond,
  }
}
