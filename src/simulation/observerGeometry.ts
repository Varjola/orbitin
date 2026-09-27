import { EARTH_ECCENTRICITY_SQUARED, EARTH_RADIUS_KM } from '../core/constants.ts'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'

/** My place: where the learner is on the
 *  rendered Earth, and how high an object stands above their horizon.
 *
 *  The globe and the ground tracks draw a spherical Earth of the WGS-84
 *  equatorial radius with geocentric latitudes, so the observer is placed on
 *  that same sphere: the device's geodetic latitude is converted to the
 *  geocentric latitude of the same surface point. Pure: nothing here stores,
 *  logs or sends the location. */

export interface ObserverLocation {
  /** Geodetic latitude, as a device reports it (and as the 2D map draws). */
  readonly geodeticLatitudeRad: number
  readonly longitudeRad: number
}

/** The geocentric latitude of a surface point given its geodetic latitude (WGS-84). */
export function geocentricLatitudeFromGeodetic(geodeticLatitudeRad: number): number {
  return Math.atan((1 - EARTH_ECCENTRICITY_SQUARED) * Math.tan(geodeticLatitudeRad))
}

/** The observer's position on the rendered spherical Earth, Earth-fixed km. */
export function observerPositionEarthFixedKm(observer: ObserverLocation): EarthFixedVec3 {
  const latitude = geocentricLatitudeFromGeodetic(observer.geodeticLatitudeRad)
  const cosLatitude = Math.cos(latitude)
  return {
    x: EARTH_RADIUS_KM * cosLatitude * Math.cos(observer.longitudeRad),
    y: EARTH_RADIUS_KM * cosLatitude * Math.sin(observer.longitudeRad),
    z: EARTH_RADIUS_KM * Math.sin(latitude),
  }
}

/** The elevation angle of `objectEarthFixedKm` above the horizon of an
 *  observer on the spherical Earth: the angle between the line of sight and
 *  the plane tangent to the sphere at the observer. Positive above the
 *  horizon, zero on it, negative below. Null for a degenerate line of sight. */
export function elevationAngleRad(observer: ObserverLocation, objectEarthFixedKm: EarthFixedVec3): number | null {
  const position = observerPositionEarthFixedKm(observer)
  const dx = objectEarthFixedKm.x - position.x
  const dy = objectEarthFixedKm.y - position.y
  const dz = objectEarthFixedKm.z - position.z
  const range = Math.hypot(dx, dy, dz)
  if (!(range > 0) || !Number.isFinite(range)) return null
  const sine = (dx * position.x + dy * position.y + dz * position.z) / (range * EARTH_RADIUS_KM)
  return Math.asin(Math.min(1, Math.max(-1, sine)))
}
