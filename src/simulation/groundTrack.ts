import { TAU } from '../core/angles.ts'
import { EARTH_ECCENTRICITY_SQUARED, EARTH_POLAR_RADIUS_KM, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { EarthFixedVec3, EarthOrientation, ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { projectInertialToEarthFixed } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import { deriveOrbitValues, type OrbitGeometry } from '../orbital/geometry.ts'
import type { OrbitalState } from '../orbital/propagator.ts'
import { isSgp4Source, type OrbitSource } from './OrbitalObject.ts'

/** Presentation density for one nominal-period side of a ground-track window. */
export const GROUND_TRACK_SAMPLE_INTERVALS = 256
/** A conditioning threshold for deciding that longitude is undefined at a pole. */
export const GROUND_TRACK_POLE_HORIZONTAL_THRESHOLD = 1e-10
/** Surface lift used only by the 3D adapter to avoid z-fighting. */
export const GROUND_TRACK_SURFACE_LIFT_RENDER_UNITS = 0.003

export interface SubSatellitePoint {
  readonly instant: SimulationInstant
  readonly directionEarthFixed: EarthFixedVec3
  readonly geocentricLatitudeRad: number
  /** WGS-84 geodetic latitude of the same Earth-fixed position.
   *
   * Additive: it does not replace `geocentricLatitudeRad`, which continues to
   * drive the spherical 3D projection and the Earth-relative readout. This
   * value exists because the 2D map is drawn against geographic coastline
   * data, where the two definitions differ by up to about 0.19 deg at
   * mid-latitudes. */
  readonly geodeticLatitudeRad: number
  readonly longitudeRad: number | null
}

/** Shared Earth-fixed surface coordinates used by both ground tracks and the
 *  instantaneous sensor boundary. The Cartesian direction is spherical; the
 *  geodetic latitude is an additive WGS-84 display coordinate for the map. */
export interface EarthSurfaceCoordinates {
  readonly directionEarthFixed: EarthFixedVec3
  readonly geocentricLatitudeRad: number
  readonly geodeticLatitudeRad: number
  readonly longitudeRad: number | null
}

export interface GroundTrackSegment {
  readonly points: readonly SubSatellitePoint[]
}

export interface GroundTrackWindow {
  readonly centreInstant: SimulationInstant
  readonly nominalPeriodSeconds: number
  readonly current: SubSatellitePoint
  readonly trailing: readonly GroundTrackSegment[]
  readonly leading: readonly GroundTrackSegment[]
  readonly failedSampleCount: number
}

export interface GroundTrackSamplingOptions {
  readonly centreInstant: SimulationInstant
  readonly nominalPeriodSeconds: number
  readonly currentState: OrbitalState
  readonly currentOrientation: EarthOrientation
  readonly stateAt: (instant: SimulationInstant) => OrbitalState | null
  readonly earthOrientationAt: (instant: SimulationInstant) => EarthOrientation
  readonly intervalsPerPeriod?: number
}

/** The source-independent nominal window period.
 *
 * This function owns the source dispatch so the sampler itself stays unaware
 * of Keplerian geometry and TLE metadata. TLE sources use their validated
 * printed mean-motion period for the same source-agnostic window contract.
 */
export function nominalOrbitalPeriodSeconds(source: OrbitSource): number | null {
  if (isSgp4Source(source)) return Number.isFinite(source.definition.meanElements.nominalPeriodSeconds) && source.definition.meanElements.nominalPeriodSeconds > 0 ? source.definition.meanElements.nominalPeriodSeconds : null
  return nominalOrbitalPeriodForGeometry(source.geometry)
}

export const nominalOrbitalPeriodForObject = nominalOrbitalPeriodSeconds

export function nominalOrbitalPeriodForGeometry(geometry: OrbitGeometry): number | null {
  try {
    const period = deriveOrbitValues(geometry).periodSeconds
    return Number.isFinite(period) && period > 0 ? period : null
  } catch {
    return null
  }
}

/** Project a nonzero Earth-fixed Cartesian position onto the rendered sphere. */
export function subSatellitePointFromEarthFixed(
  positionEarthFixedKm: EarthFixedVec3,
  instant: SimulationInstant,
): SubSatellitePoint | null {
  const surface = earthSurfaceCoordinatesFromEarthFixed(positionEarthFixedKm)
  if (!surface) return null
  return {
    instant: { ...instant },
    ...surface,
  }
}

/** Convert one finite nonzero Earth-fixed Cartesian point into the shared
 *  surface coordinate contract. Unlike the unit direction, geodetic latitude
 *  intentionally sees the original radius. */
export function earthSurfaceCoordinatesFromEarthFixed(positionEarthFixedKm: EarthFixedVec3): EarthSurfaceCoordinates | null {
  const { x, y, z } = positionEarthFixedKm
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || length === 0 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  const directionEarthFixed: EarthFixedVec3 = { x: x / length, y: y / length, z: z / length }
  const horizontalRadius = Math.hypot(directionEarthFixed.x, directionEarthFixed.y)
  const atPole = horizontalRadius <= GROUND_TRACK_POLE_HORIZONTAL_THRESHOLD
  return {
    directionEarthFixed,
    geocentricLatitudeRad: Math.atan2(directionEarthFixed.z, horizontalRadius),
    // The same pole test decides both, so a point whose longitude is undefined
    // is also exactly +/-90 deg geodetic rather than a near-pole approximation.
    geodeticLatitudeRad: atPole ? (z >= 0 ? Math.PI / 2 : -Math.PI / 2) : geodeticLatitudeFromEarthFixed(positionEarthFixedKm),
    longitudeRad: atPole ? null : wrapLongitude(Math.atan2(directionEarthFixed.y, directionEarthFixed.x)),
  }
}

export const surfaceCoordinatesFromEarthFixed = earthSurfaceCoordinatesFromEarthFixed

/** WGS-84 geodetic latitude of an Earth-fixed position, in radians.
 *
 * Bowring's closed-form solution, evaluated on the **unnormalized** position:
 * geodetic latitude is not scale invariant, so the conversion must see the real
 * radius rather than the unit direction the 3D view uses. Over the supported
 * orbital range - a periapsis radius of at least 6,578 km up to a 60,000 km
 * apoapsis - it recovers the generating latitude to better than 1e-6 deg,
 * which is about five centimetres at Earth's surface and far below every other
 * error in the pipeline.
 *
 * Positions inside the reference ellipsoid are outside the supported domain:
 * geodetic latitude there is not unique, so the result is clamped to the
 * physical +/-90 deg interval rather than allowed to leave it.
 */
export function geodeticLatitudeFromEarthFixed(positionEarthFixedKm: EarthFixedVec3): number {
  const { x, y, z } = positionEarthFixedKm
  const horizontal = Math.hypot(x, y)
  if (!Number.isFinite(horizontal) || !Number.isFinite(z)) return Number.NaN
  if (horizontal === 0) return z >= 0 ? Math.PI / 2 : -Math.PI / 2
  // An exactly equatorial position is exactly zero in both definitions; the
  // general branch would only reach zero through two arctangents.
  if (z === 0) return 0
  const parametric = Math.atan2(z * EARTH_RADIUS_KM, horizontal * EARTH_POLAR_RADIUS_KM)
  const latitude = Math.atan2(
    z + EARTH_SECOND_ECCENTRICITY_SQUARED * EARTH_POLAR_RADIUS_KM * Math.sin(parametric) ** 3,
    horizontal - EARTH_ECCENTRICITY_SQUARED * EARTH_RADIUS_KM * Math.cos(parametric) ** 3,
  )
  return Math.min(Math.PI / 2, Math.max(-Math.PI / 2, latitude))
}

/** e'^2 = e^2 / (1 - e^2), the WGS-84 second eccentricity squared. */
const EARTH_SECOND_ECCENTRICITY_SQUARED = EARTH_ECCENTRICITY_SQUARED / (1 - EARTH_ECCENTRICITY_SQUARED)

export const projectEarthFixedPositionToSubSatellitePoint = subSatellitePointFromEarthFixed

/** Convert a ProjectInertial position at its own timestamp to a surface point. */
export function subSatellitePointFromProjectInertial(
  positionProjectInertialKm: ProjectInertialVec3,
  orientation: EarthOrientation,
): SubSatellitePoint | null {
  return subSatellitePointFromEarthFixed(projectInertialToEarthFixed(positionProjectInertialKm, orientation), orientation.instant)
}

/** Alias kept explicit for call sites that start from a full state vector. */
export function subSatellitePointFromState(state: OrbitalState, orientation: EarthOrientation): SubSatellitePoint | null {
  return subSatellitePointFromProjectInertial(state.positionProjectInertialKm, orientation)
}

/** Sample a deterministic, source-agnostic previous/next nominal-period window. */
export function sampleGroundTrack(options: GroundTrackSamplingOptions): GroundTrackWindow | null {
  const intervals = options.intervalsPerPeriod ?? GROUND_TRACK_SAMPLE_INTERVALS
  if (!Number.isInteger(intervals) || intervals < 1 || !Number.isFinite(options.nominalPeriodSeconds) || options.nominalPeriodSeconds <= 0) return null
  const current = subSatellitePointFromEarthFixed(
    projectInertialToEarthFixed(options.currentState.positionProjectInertialKm, options.currentOrientation),
    options.centreInstant,
  )
  if (!current) return null

  let failedSampleCount = 0
  const centreSeconds = options.centreInstant.unixSeconds
  const pointAt = (unixSeconds: number): SubSatellitePoint | null => {
    if (unixSeconds === centreSeconds) return current
    const instant = { unixSeconds }
    try {
      const state = options.stateAt(instant)
      if (!state) { failedSampleCount += 1; return null }
      const orientation = options.earthOrientationAt(instant)
      const point = subSatellitePointFromState(state, orientation)
      if (!point) failedSampleCount += 1
      return point
    } catch {
      failedSampleCount += 1
      return null
    }
  }

  const trailing: Array<SubSatellitePoint | null> = []
  for (let index = 0; index <= intervals; index += 1) {
    const seconds = index === intervals
      ? centreSeconds
      : centreSeconds - options.nominalPeriodSeconds + options.nominalPeriodSeconds * index / intervals
    trailing.push(pointAt(seconds))
  }
  const leading: Array<SubSatellitePoint | null> = []
  for (let index = 0; index <= intervals; index += 1) {
    const seconds = index === 0 ? centreSeconds : centreSeconds + options.nominalPeriodSeconds * index / intervals
    leading.push(pointAt(seconds))
  }
  return {
    centreInstant: { ...options.centreInstant },
    nominalPeriodSeconds: options.nominalPeriodSeconds,
    current,
    trailing: segmentGroundTrackSamples(trailing),
    leading: segmentGroundTrackSamples(leading),
    failedSampleCount,
  }
}

/** Alias matching the product terminology used by consumers. */
export const sampleGroundTrackWindow = sampleGroundTrack

/** The segmentation decision for one step between consecutive valid samples.
 *
 * Extracted so the window sampler (which folds a whole array) and the recorded
 * history (which appends one sample at a time) share one seam truth rather than
 * growing two implementations that can disagree about where a line breaks.
 */
export type GroundTrackStep =
  | { readonly kind: 'continue' }
  | { readonly kind: 'poleSplit' }
  | { readonly kind: 'seamSplit'; readonly closing: SubSatellitePoint; readonly opening: SubSatellitePoint }

const CONTINUE_STEP: GroundTrackStep = { kind: 'continue' }
const POLE_SPLIT_STEP: GroundTrackStep = { kind: 'poleSplit' }

export function groundTrackStepBetween(previous: SubSatellitePoint, next: SubSatellitePoint): GroundTrackStep {
  // The incoming segment already ends at the shared physical pole, so the
  // outgoing one continues from it rather than starting one sample later.
  if (previous.longitudeRad === null) return CONTINUE_STEP
  // A polar sample ends the segment and begins the next at the same Cartesian
  // point, so no invented longitude picks a side of a future flat map.
  if (next.longitudeRad === null) return POLE_SPLIT_STEP
  if (Math.abs(next.longitudeRad - previous.longitudeRad) <= Math.PI) return CONTINUE_STEP
  const nextUnwrapped = unwrapNextLongitude(previous.longitudeRad, next.longitudeRad)
  const seamLongitude = nextUnwrapped > previous.longitudeRad ? Math.PI : -Math.PI
  const fraction = (seamLongitude - previous.longitudeRad) / (nextUnwrapped - previous.longitudeRad)
  const seamInstant = {
    unixSeconds: previous.instant.unixSeconds + (next.instant.unixSeconds - previous.instant.unixSeconds) * fraction,
  }
  const seamLatitude = previous.geocentricLatitudeRad + (next.geocentricLatitudeRad - previous.geocentricLatitudeRad) * fraction
  // Both latitudes are interpolated at the same already-computed crossing
  // fraction rather than converted from one another, so the two map segments
  // terminate at the same displayed latitude. This is display-coordinate
  // interpolation between propagated samples, not a new propagated state.
  const seamGeodeticLatitude = previous.geodeticLatitudeRad + (next.geodeticLatitudeRad - previous.geodeticLatitudeRad) * fraction
  return {
    kind: 'seamSplit',
    closing: seamPoint(seamInstant, seamLatitude, seamGeodeticLatitude, seamLongitude),
    opening: seamPoint(seamInstant, seamLatitude, seamGeodeticLatitude, seamLongitude > 0 ? -Math.PI : Math.PI),
  }
}

/** Split a sequence at antimeridian crossings and preserve paired seam points. */
export function segmentGroundTrackSamples(samples: readonly (SubSatellitePoint | null)[]): GroundTrackSegment[] {
  const output: GroundTrackSegment[] = []
  let current: SubSatellitePoint[] = []
  const finish = (): void => {
    if (current.length >= 2) output.push({ points: current })
    current = []
  }
  for (const sample of samples) {
    if (!sample) { finish(); continue }
    if (current.length === 0) { current.push(sample); continue }
    const step = groundTrackStepBetween(current[current.length - 1], sample)
    if (step.kind === 'continue') { current.push(sample); continue }
    if (step.kind === 'poleSplit') {
      current.push(sample)
      finish()
      current = [sample]
      continue
    }
    current.push(step.closing)
    finish()
    current.push(step.opening, sample)
  }
  finish()
  return output
}

function seamPoint(instant: SimulationInstant, latitude: number, geodeticLatitude: number, longitude: number): SubSatellitePoint {
  const cosLatitude = Math.cos(latitude)
  return {
    instant: { ...instant },
    // The unit direction is reconstructed from the geocentric value only, so
    // the 3D sphere sees exactly the geocentric point.
    directionEarthFixed: {
      x: cosLatitude * Math.cos(longitude),
      y: cosLatitude * Math.sin(longitude),
      z: Math.sin(latitude),
    },
    geocentricLatitudeRad: latitude,
    geodeticLatitudeRad: geodeticLatitude,
    longitudeRad: longitude === Math.PI ? Math.PI : longitude,
  }
}

function unwrapNextLongitude(previous: number, next: number): number {
  let unwrapped = next
  while (unwrapped - previous > Math.PI) unwrapped -= TAU
  while (unwrapped - previous < -Math.PI) unwrapped += TAU
  return unwrapped
}

/** Product interval is [-PI, +PI); seam endpoints may additionally use +PI. */
function wrapLongitude(rad: number): number {
  return ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI
}

/** Radius of the physical render sphere, kept as a named domain convention. */
export const GROUND_TRACK_SURFACE_RADIUS_KM = EARTH_RADIUS_KM
