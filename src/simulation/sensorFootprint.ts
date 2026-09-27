import {
  EARTH_RADIUS_KM,
  SENSOR_BOUNDARY_INTERVALS,
  SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD,
  SENSOR_DEFAULT_GROUND_ELEVATION_RAD,
  SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD,
  SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD,
  SENSOR_MAX_GROUND_ELEVATION_RAD,
  SENSOR_MAX_OFF_NADIR_STEERING_RAD,
  SENSOR_MIN_GROUND_ELEVATION_RAD,
  SENSOR_MIN_OFF_NADIR_STEERING_RAD,
} from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import { crossVec3, dotVec3, lengthVec3, scaleVec3 } from '../core/vec3.ts'
import type { GroundReachConstraint, IdealizedSensorDefinition } from './OrbitalObject.ts'
import {
  earthSurfaceCoordinatesFromEarthFixed,
  type EarthSurfaceCoordinates,
  type SubSatellitePoint,
} from './groundTrack.ts'

/** Why a cap stopped growing. `sensor` means the authored angle itself bounds
 *  the cap. `elevation` means the ground reach constraint does, and `horizon` is
 *  its zero-elevation case, the geometric limb. The two limited cases are kept
 *  apart so the view can say whether the learner's reach constraint or the
 *  Earth itself is binding. */
export type SensorCapLimitedBy = 'sensor' | 'elevation' | 'horizon'

/** The same hypothetical instrument for every orbit; see the constants for why
 *  these angles. Never derived from the orbit it is attached to. */
export function defaultSensorDefinition(): IdealizedSensorDefinition {
  return { fieldOfViewHalfAngleRad: SENSOR_DEFAULT_FIELD_OF_VIEW_HALF_ANGLE_RAD, maxOffNadirSteeringRad: SENSOR_DEFAULT_OFF_NADIR_STEERING_RAD }
}

/** Geometric visibility: no reach constraint beyond the horizon itself. */
export function defaultGroundReachConstraint(): GroundReachConstraint {
  return { minimumGroundElevationRad: SENSOR_DEFAULT_GROUND_ELEVATION_RAD }
}

export interface SensorSurfacePoint extends EarthSurfaceCoordinates {
  readonly positionEarthFixedKm: EarthFixedVec3
}

export interface SphericalSensorCap {
  readonly angularRadiusRad: number
  readonly surfaceRadiusKm: number
  readonly areaKm2: number
  readonly fractionOfEarth: number
  readonly limitedBy: SensorCapLimitedBy
  /** The off-nadir ray angle the boundary actually sits at. It equals the
   *  authored angle while the cap is sensor-limited and the binding limit once
   *  it is not, so the view never has to recover it from two other numbers. */
  readonly offNadirAngleRad: number
  /** Elevation of the spacecraft above the local horizon, seen from a point on
   *  the boundary. This is the usability measure the cap radius alone hides: a
   *  grazing cap is geometrically valid and operationally worthless. */
  readonly edgeElevationRad: number
  readonly slantRangeKm: number
  /** Highest geocentric latitude the cap reaches at this instant. */
  readonly maxGeocentricLatitudeRad: number
  readonly boundary: readonly SensorSurfacePoint[]
}

export interface InstantaneousSensorGeometry {
  readonly instant: SimulationInstant
  readonly spacecraftPositionEarthFixedKm: EarthFixedVec3
  readonly boresightDirectionEarthFixed: EarthFixedVec3
  readonly centre: SubSatellitePoint
  /** Authored sensor angles, echoed exactly. */
  readonly fieldOfViewHalfAngleRad: number
  readonly maxOffNadirSteeringRad: number
  /** The ground reach constraint this result was built with; zero when none. */
  readonly minimumGroundElevationRad: number
  readonly horizonOffNadirAngleRad: number
  /** Off-nadir ray angle and Earth-central angle at which the reach constraint
   *  becomes binding. At zero elevation they are the horizon values. */
  readonly elevationOffNadirAngleRad: number
  readonly maxCoverageAngleRad: number
  readonly altitudeKm: number
  readonly footprint: SphericalSensorCap
  readonly fieldOfRegard: SphericalSensorCap
}

export type SensorGeometryFailureReason = 'invalidAngles' | 'invalidReachConstraint' | 'invalidPosition' | 'insideEarth' | 'centreMismatch'

export interface SensorGeometryFailure {
  readonly kind: 'invalid'
  readonly reason: SensorGeometryFailureReason
  readonly message: string
}

export type SensorGeometryComputation =
  | { readonly kind: 'valid'; readonly geometry: InstantaneousSensorGeometry }
  | SensorGeometryFailure

export interface SensorGeometryOptions {
  readonly instant: SimulationInstant
  readonly positionEarthFixedKm: EarthFixedVec3
  readonly centre: SubSatellitePoint
  readonly sensor: IdealizedSensorDefinition
  /** Ground reach constraint, deliberately separate from the sensor. Absent
   *  means geometric visibility only, which is exactly a zero elevation. */
  readonly reachConstraint?: GroundReachConstraint
  readonly boundaryIntervals?: number
}

export interface SensorAngularRadius {
  readonly angularRadiusRad: number
  readonly offNadirAngleRad: number
  readonly limitedBy: SensorCapLimitedBy
}

/** The off-nadir ray angle from an exterior spacecraft to the spherical limb. */
export function horizonOffNadirAngleForRadius(radiusKm: number, earthRadiusKm = EARTH_RADIUS_KM): number | null {
  if (!Number.isFinite(radiusKm) || !Number.isFinite(earthRadiusKm) || radiusKm <= earthRadiusKm || earthRadiusKm <= 0) return null
  return Math.asin(clampUnit(earthRadiusKm / radiusKm))
}

/** The widest off-nadir ray that still reaches ground seeing the spacecraft at
 *  or above `minimumGroundElevationRad`. At zero elevation this is exactly the
 *  horizon angle, so the ground reach constraint generalizes the horizon clip
 *  rather than sitting beside it. */
export function offNadirLimitForElevation(
  radiusKm: number,
  minimumGroundElevationRad: number,
  earthRadiusKm = EARTH_RADIUS_KM,
): number | null {
  if (!validElevation(minimumGroundElevationRad)) return null
  if (!Number.isFinite(radiusKm) || !Number.isFinite(earthRadiusKm) || radiusKm <= earthRadiusKm || earthRadiusKm <= 0) return null
  return Math.asin(clampUnit((earthRadiusKm / radiusKm) * Math.cos(minimumGroundElevationRad)))
}

/** The Earth-centred angular radius of the widest cap the ground reach
 *  constraint allows. The angle sliders use it to pace their travel. */
export function maxCoverageAngleForElevation(
  radiusKm: number,
  minimumGroundElevationRad: number,
  earthRadiusKm = EARTH_RADIUS_KM,
): number | null {
  const limit = offNadirLimitForElevation(radiusKm, minimumGroundElevationRad, earthRadiusKm)
  return limit === null ? null : Math.max(0, Math.PI / 2 - minimumGroundElevationRad - limit)
}

/** Inverse of the cap solution: the off-nadir ray angle whose surface cap has
 *  the requested Earth-centred radius. Exact and stable over the whole visible
 *  range, including the limb, where the forward solution's derivative blows up
 *  and a linear off-nadir control loses all resolution. */
export function offNadirForCoverageAngle(
  radiusKm: number,
  coverageAngleRad: number,
  earthRadiusKm = EARTH_RADIUS_KM,
): number | null {
  if (!Number.isFinite(radiusKm) || radiusKm <= earthRadiusKm || earthRadiusKm <= 0) return null
  if (!Number.isFinite(coverageAngleRad) || coverageAngleRad < 0) return null
  const horizonCoverage = Math.acos(clampUnit(earthRadiusKm / radiusKm))
  if (coverageAngleRad >= horizonCoverage) return Math.asin(clampUnit(earthRadiusKm / radiusKm))
  return Math.atan2(earthRadiusKm * Math.sin(coverageAngleRad), radiusKm - earthRadiusKm * Math.cos(coverageAngleRad))
}

/** Convert an axisymmetric ray envelope into the Earth-centred cap radius. */
export function surfaceAngularRadiusForOffNadir(
  radiusKm: number,
  rayLimitRad: number,
  minimumGroundElevationRad = 0,
  earthRadiusKm = EARTH_RADIUS_KM,
): SensorAngularRadius | null {
  if (!Number.isFinite(radiusKm) || radiusKm <= earthRadiusKm || !Number.isFinite(rayLimitRad) || rayLimitRad < 0) return null
  const limit = offNadirLimitForElevation(radiusKm, minimumGroundElevationRad, earthRadiusKm)
  if (limit === null) return null
  if (rayLimitRad >= limit) {
    return {
      angularRadiusRad: Math.max(0, Math.PI / 2 - minimumGroundElevationRad - limit),
      offNadirAngleRad: limit,
      limitedBy: minimumGroundElevationRad > 0 ? 'elevation' : 'horizon',
    }
  }
  const sine = clampUnit((radiusKm / earthRadiusKm) * Math.sin(rayLimitRad))
  return { angularRadiusRad: Math.max(0, Math.asin(sine) - rayLimitRad), offNadirAngleRad: rayLimitRad, limitedBy: 'sensor' }
}

/** Elevation of the spacecraft above the horizon at a point `coverageAngleRad`
 *  from the sub-satellite point, reached by a ray `offNadirAngleRad` off nadir.
 *  The three angles of the Earth-centre/spacecraft/target triangle sum with the
 *  elevation to a right angle, which holds in the clipped case too. */
export function edgeElevationRad(offNadirAngleRad: number, coverageAngleRad: number): number {
  return Math.max(0, Math.PI / 2 - offNadirAngleRad - coverageAngleRad)
}

/** Spacecraft-to-boundary distance across the chord. */
export function slantRangeForCoverageKm(radiusKm: number, coverageAngleRad: number, earthRadiusKm = EARTH_RADIUS_KM): number {
  const squared = radiusKm ** 2 + earthRadiusKm ** 2 - 2 * radiusKm * earthRadiusKm * Math.cos(coverageAngleRad)
  return squared > 0 ? Math.sqrt(squared) : 0
}

/** Stable area of a spherical cap. */
export function sphericalCapAreaKm2(angularRadiusRad: number, earthRadiusKm = EARTH_RADIUS_KM): number {
  if (!Number.isFinite(angularRadiusRad) || !Number.isFinite(earthRadiusKm) || angularRadiusRad < 0 || earthRadiusKm <= 0) return Number.NaN
  const oneMinusCos = 2 * Math.sin(angularRadiusRad / 2) ** 2
  return 2 * Math.PI * earthRadiusKm ** 2 * oneMinusCos
}

export function sphericalCapSurfaceRadiusKm(angularRadiusRad: number, earthRadiusKm = EARTH_RADIUS_KM): number {
  return Number.isFinite(angularRadiusRad) && Number.isFinite(earthRadiusKm) && angularRadiusRad >= 0 && earthRadiusKm > 0
    ? earthRadiusKm * angularRadiusRad
    : Number.NaN
}

/** Build one current nadir footprint and one full-azimuth field of regard. */
export function createInstantaneousSensorGeometry(options: SensorGeometryOptions): SensorGeometryComputation {
  const { sensor, positionEarthFixedKm, centre } = options
  if (!validSensorAngles(sensor) || !Number.isInteger(options.boundaryIntervals ?? SENSOR_BOUNDARY_INTERVALS) || (options.boundaryIntervals ?? SENSOR_BOUNDARY_INTERVALS) < 3) {
    return invalid('invalidAngles', 'The sensor angles or boundary budget are invalid.')
  }
  const radiusKm = lengthVec3(positionEarthFixedKm)
  if (!Number.isFinite(radiusKm) || !finiteVec3(positionEarthFixedKm) || radiusKm === 0) return invalid('invalidPosition', 'The Earth-fixed spacecraft position is not finite.')
  if (radiusKm <= EARTH_RADIUS_KM) return invalid('insideEarth', 'The spacecraft is at or below the spherical Earth surface.')
  const centreDirection = { x: positionEarthFixedKm.x / radiusKm, y: positionEarthFixedKm.y / radiusKm, z: positionEarthFixedKm.z / radiusKm }
  if (dotVec3(centreDirection, centre.directionEarthFixed) < 1 - 1e-8) return invalid('centreMismatch', 'The supplied sub-satellite point does not match the current Earth-fixed position.')
  const horizon = horizonOffNadirAngleForRadius(radiusKm)
  if (horizon === null) return invalid('invalidPosition', 'The Earth-fixed spacecraft radius is invalid.')
  const intervals = options.boundaryIntervals ?? SENSOR_BOUNDARY_INTERVALS
  const mask = options.reachConstraint?.minimumGroundElevationRad ?? 0
  if (!validElevation(mask)) return invalid('invalidReachConstraint', 'The minimum ground elevation is outside its authored range.')
  const fovRayLimit = sensor.fieldOfViewHalfAngleRad
  const forRayLimit = fovRayLimit + sensor.maxOffNadirSteeringRad
  const fovRadius = surfaceAngularRadiusForOffNadir(radiusKm, fovRayLimit, mask)!
  const forRadius = surfaceAngularRadiusForOffNadir(radiusKm, forRayLimit, mask)!
  const footprint = createCap(centre, radiusKm, fovRadius, intervals)
  const fieldOfRegard = fovRadius.angularRadiusRad === forRadius.angularRadiusRad
    ? footprint
    : createCap(centre, radiusKm, forRadius, intervals)
  const geometry: InstantaneousSensorGeometry = {
    instant: { ...options.instant },
    spacecraftPositionEarthFixedKm: { ...positionEarthFixedKm },
    boresightDirectionEarthFixed: scaleVec3(centre.directionEarthFixed, -1),
    centre,
    fieldOfViewHalfAngleRad: sensor.fieldOfViewHalfAngleRad,
    maxOffNadirSteeringRad: sensor.maxOffNadirSteeringRad,
    minimumGroundElevationRad: mask,
    horizonOffNadirAngleRad: horizon,
    elevationOffNadirAngleRad: offNadirLimitForElevation(radiusKm, mask)!,
    maxCoverageAngleRad: maxCoverageAngleForElevation(radiusKm, mask)!,
    altitudeKm: radiusKm - EARTH_RADIUS_KM,
    footprint,
    fieldOfRegard,
  }
  return { kind: 'valid', geometry }
}

/** Convenience form for consumers that only need valid geometry. */
export function computeInstantaneousSensorGeometry(options: SensorGeometryOptions): InstantaneousSensorGeometry | null {
  const result = createInstantaneousSensorGeometry(options)
  return result.kind === 'valid' ? result.geometry : null
}

/** Construct an ordered closed boundary from an Earth-fixed cap centre. */
export function buildSensorBoundary(
  centreDirection: EarthFixedVec3,
  angularRadiusRad: number,
  intervals = SENSOR_BOUNDARY_INTERVALS,
): readonly SensorSurfacePoint[] {
  if (angularRadiusRad <= 0 || !Number.isFinite(angularRadiusRad)) return []
  const { tangentA, tangentB } = tangentBasis(centreDirection)
  const points: SensorSurfacePoint[] = []
  for (let index = 0; index <= intervals; index += 1) {
    const phi = index / intervals * Math.PI * 2
    const unit = {
      x: Math.cos(angularRadiusRad) * centreDirection.x + Math.sin(angularRadiusRad) * (Math.cos(phi) * tangentA.x + Math.sin(phi) * tangentB.x),
      y: Math.cos(angularRadiusRad) * centreDirection.y + Math.sin(angularRadiusRad) * (Math.cos(phi) * tangentA.y + Math.sin(phi) * tangentB.y),
      z: Math.cos(angularRadiusRad) * centreDirection.z + Math.sin(angularRadiusRad) * (Math.cos(phi) * tangentA.z + Math.sin(phi) * tangentB.z),
    }
    const positionEarthFixedKm: EarthFixedVec3 = scaleVec3(unit, EARTH_RADIUS_KM)
    const coordinates = earthSurfaceCoordinatesFromEarthFixed(positionEarthFixedKm)
    if (coordinates) points.push({ positionEarthFixedKm, ...coordinates })
  }
  return points
}

function createCap(centre: SubSatellitePoint, spacecraftRadiusKm: number, radius: SensorAngularRadius, intervals: number): SphericalSensorCap {
  const areaKm2 = sphericalCapAreaKm2(radius.angularRadiusRad)
  return {
    angularRadiusRad: radius.angularRadiusRad,
    surfaceRadiusKm: sphericalCapSurfaceRadiusKm(radius.angularRadiusRad),
    areaKm2,
    fractionOfEarth: areaKm2 / (4 * Math.PI * EARTH_RADIUS_KM ** 2),
    limitedBy: radius.limitedBy,
    offNadirAngleRad: radius.offNadirAngleRad,
    edgeElevationRad: edgeElevationRad(radius.offNadirAngleRad, radius.angularRadiusRad),
    slantRangeKm: slantRangeForCoverageKm(spacecraftRadiusKm, radius.angularRadiusRad),
    maxGeocentricLatitudeRad: Math.min(Math.PI / 2, Math.abs(centre.geocentricLatitudeRad) + radius.angularRadiusRad),
    boundary: buildSensorBoundary(centre.directionEarthFixed, radius.angularRadiusRad, intervals),
  }
}

function tangentBasis(direction: EarthFixedVec3): { tangentA: EarthFixedVec3; tangentB: EarthFixedVec3 } {
  const absolute = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)]
  const axis = absolute[0] <= absolute[1] && absolute[0] <= absolute[2] ? { x: 1, y: 0, z: 0 }
    : absolute[1] <= absolute[2] ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 }
  const crossed = crossVec3(axis, direction)
  const tangentLength = lengthVec3(crossed)
  const tangentA = scaleVec3(crossed, 1 / tangentLength)
  const tangentB = crossVec3(direction, tangentA)
  return { tangentA, tangentB }
}

function validSensorAngles(sensor: IdealizedSensorDefinition): boolean {
  // The state/UI contract keeps FOV above a small floor, but the pure function
  // is total at zero so degenerate caps remain useful to tests and future
  // callers. The ground reach constraint is validated separately: it is not
  // part of the sensor.
  return Number.isFinite(sensor.fieldOfViewHalfAngleRad) && sensor.fieldOfViewHalfAngleRad >= 0 && sensor.fieldOfViewHalfAngleRad <= SENSOR_MAX_FIELD_OF_VIEW_HALF_ANGLE_RAD &&
    Number.isFinite(sensor.maxOffNadirSteeringRad) && sensor.maxOffNadirSteeringRad >= SENSOR_MIN_OFF_NADIR_STEERING_RAD && sensor.maxOffNadirSteeringRad <= SENSOR_MAX_OFF_NADIR_STEERING_RAD
}

function validElevation(value: number): boolean {
  return Number.isFinite(value) && value >= SENSOR_MIN_GROUND_ELEVATION_RAD && value <= SENSOR_MAX_GROUND_ELEVATION_RAD
}

function finiteVec3(vector: EarthFixedVec3): boolean { return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z) }
function clampUnit(value: number): number { return Math.min(1, Math.max(-1, value)) }
function invalid(reason: SensorGeometryFailureReason, message: string): SensorGeometryFailure { return { kind: 'invalid', reason, message } }
