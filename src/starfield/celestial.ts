import type { Vec3 } from '../core/vec3.ts'
// Legacy Eci names in this module mean ProjectInertial (J2000).
import { degToRad } from '../core/angles.ts'

/**
 * Right ascension and declination, in radians, in the J2000 / ICRS frame that
 * star catalogues publish.
 */
export interface EquatorialCoordinates {
  rightAscensionRad: number
  declinationRad: number
}

/**
 * Convert J2000 equatorial coordinates into a unit vector in the project's ECI
 * convention.
 *
 * There is no free rotation parameter here, and there must not be one. The ECI
 * convention puts `+X` at the vernal equinox and
 * `+Z` at the north celestial pole, which is precisely the frame right
 * ascension and declination are measured in. Catalogue coordinates therefore
 * land in the correct place by construction, and `projectInertialToRender` carries them
 * into the Y-up render frame unchanged.
 *
 * Precession (about 0.36 degrees over 25 years), proper motion and annual
 * aberration are knowingly ignored; each sits
 * below the visible threshold for this tool.
 */
export function equatorialToDirectionEci(coordinates: EquatorialCoordinates): Vec3 {
  const cosDeclination = Math.cos(coordinates.declinationRad)
  return {
    x: cosDeclination * Math.cos(coordinates.rightAscensionRad),
    y: cosDeclination * Math.sin(coordinates.rightAscensionRad),
    z: Math.sin(coordinates.declinationRad),
  }
}

/** Catalogues publish right ascension in hours; 24 hours span a full turn. */
export function rightAscensionHoursToRad(hours: number): number {
  return degToRad(hours * 15)
}

/**
 * Sexagesimal right ascension to radians. Used by the tests to state reference
 * stars the way a catalogue prints them rather than as pre-reduced decimals.
 */
export function rightAscensionFromHms(hours: number, minutes: number, seconds: number): number {
  return rightAscensionHoursToRad(hours + minutes / 60 + seconds / 3600)
}

/**
 * Sexagesimal declination to radians. The sign of the whole coordinate lives on
 * `degrees`, including for the -00 xx' case, where `negative` has to carry it
 * because a numeric zero cannot.
 */
export function declinationFromDms(degrees: number, arcminutes: number, arcseconds: number, negative = degrees < 0): number {
  const magnitude = Math.abs(degrees) + arcminutes / 60 + arcseconds / 3600
  return degToRad(negative ? -magnitude : magnitude)
}
