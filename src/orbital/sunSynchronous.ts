/** The Sun-synchronous condition, solved rather than tabulated.
 *
 * A Sun-synchronous orbit is one whose nodal drift matches the mean Sun's
 * eastward motion, so the orbital plane holds a fixed local *mean* solar time.
 * The target rate is therefore the mean-Sun rate, imported from the module that
 * owns the definition of mean solar time and from nowhere else (INV-4). If the
 * two were defined against different Suns, a perfectly Sun-synchronous orbit
 * would show a drifting local time.
 *
 * Inverting the secular nodal rate of `j2Secular.ts`:
 *
 *     cos i = -targetRate / k,     k = 1.5 n J2 (Re / p)^2
 *
 * cos i is negative, so every solution is retrograde and lands in
 * (90 deg, 180 deg] - inside the existing inclination slider range.
 */
import { EARTH_J2, EARTH_RADIUS_KM, EARTH_MU_KM3_S2 } from '../core/constants.ts'
import { MEAN_SUN_RATE_RAD_PER_SECOND } from '../simulation/meanSun.ts'
import { j2SecularFactor } from './j2Secular.ts'
import type { OrbitGeometry } from './geometry.ts'

/** The nodal rate a Sun-synchronous orbit must hold. */
export const SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND = MEAN_SUN_RATE_RAD_PER_SECOND

export type SunSynchronousSolution =
  | { kind: 'solved'; inclinationRad: number }
  /** No inclination lets the plane keep up with the Sun: above this semi-major
   *  axis the oblateness torque weakens faster than the required rate falls.
   *  Computed for the object's own eccentricity, never quoted from a table. */
  | { kind: 'unattainable'; maximumSemiMajorAxisKm: number }

/** The largest semi-major axis for which a solution exists at this
 *  eccentricity. Solving k(a) = targetRate for a gives
 *  a^3.5 = 1.5 sqrt(mu) J2 Re^2 / (targetRate (1 - e^2)^2). */
export function maximumSunSynchronousSemiMajorAxisKm(eccentricity: number): number {
  const numerator = 1.5 * Math.sqrt(EARTH_MU_KM3_S2) * EARTH_J2 * EARTH_RADIUS_KM ** 2
  return (numerator / (SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND * (1 - eccentricity * eccentricity) ** 2)) ** (1 / 3.5)
}

export function solveSunSynchronousInclination(
  semiMajorAxisKm: number,
  eccentricity: number,
): SunSynchronousSolution {
  const geometry: OrbitGeometry = { semiMajorAxisKm, eccentricity, inclinationRad: 0, raanRad: 0, argOfPeriapsisRad: 0 }
  const cosineInclination = -SUN_SYNCHRONOUS_TARGET_NODAL_RATE_RAD_PER_SECOND / j2SecularFactor(geometry)
  if (!(Math.abs(cosineInclination) <= 1)) {
    return { kind: 'unattainable', maximumSemiMajorAxisKm: maximumSunSynchronousSemiMajorAxisKm(eccentricity) }
  }
  return { kind: 'solved', inclinationRad: Math.acos(cosineInclination) }
}
