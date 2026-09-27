import { wrapRadiansSigned } from '../core/angles.ts'

/** Geocentric latitude and east-positive longitude, without an ellipsoid.
 * RA and GMST share the mean equinox of date, so their hour angle carries no
 * precession error. This must also match the Sun transformed to EarthFixed.
 */
export function subSolarPoint(sunRightAscensionOfDateRad: number, sunDeclinationOfDateRad: number, gmstRad: number): { latitudeRad: number; longitudeRad: number } {
  return { latitudeRad: sunDeclinationOfDateRad, longitudeRad: wrapRadiansSigned(sunRightAscensionOfDateRad - gmstRad) }
}
