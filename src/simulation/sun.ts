/** USNO, Approximate Solar Coordinates, https://aa.usno.navy.mil/faq/sun_approx
 * Retrieved 2026-09-08. Current USNO formulation, about 1 arcminute within
 * two centuries of 2000; product support remains 1950–2050. UTC used directly.
 * Longitude includes the source's aberration adjustment; no separate nutation
 * or parallax model. Mean obliquity supplies an approximate mean-of-date vector.
 *
 * The apparent Sun is the mean Sun plus an equation of centre, so the algorithm
 * now *receives* the mean longitude from `meanSun.ts` instead of owning it. The
 * arithmetic is otherwise untouched, and `sun.test.ts` pins the output
 * bit-identical to the pre-refactor implementation.
 */
import { degToRad, wrapDegrees } from '../core/angles.ts'
import { daysSinceJ2000 } from '../core/julianDate.ts'
import type { MeanOfDateVec3 } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import { normalizeVec3 } from '../core/vec3.ts'
import { meanSunAt, type MeanSunPosition } from './meanSun.ts'

export interface SunPositionOfDate {
  readonly directionMeanOfDate: MeanOfDateVec3
  readonly rightAscensionRad: number
  readonly declinationRad: number
}

/** The apparent Sun, given a mean Sun already evaluated for the same instant.
 *  This is the entry point `environmentAt` uses, so the mean Sun is evaluated
 *  exactly once per instant (INV-11). */
export function apparentSunFromMeanSun(instant: SimulationInstant, meanSun: MeanSunPosition): SunPositionOfDate {
  const n = daysSinceJ2000(instant)
  const L = meanSun.longitudeDeg
  const g = degToRad(wrapDegrees(357.529 + 0.98560028 * n))
  const lambda = degToRad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g))
  const epsilon = degToRad(23.439 - 0.00000036 * n)
  const directionMeanOfDate = normalizeVec3({ x: Math.cos(lambda), y: Math.cos(epsilon) * Math.sin(lambda), z: Math.sin(epsilon) * Math.sin(lambda) })
  return { directionMeanOfDate, rightAscensionRad: Math.atan2(directionMeanOfDate.y, directionMeanOfDate.x), declinationRad: Math.asin(directionMeanOfDate.z) }
}

/** Convenience for callers that do not already hold a mean Sun. Exactly
 *  `apparentSunFromMeanSun(instant, meanSunAt(instant))`; it must not be called
 *  from `environmentAt`, which holds one already (INV-11). */
export function sunPositionOfDate(instant: SimulationInstant): SunPositionOfDate {
  return apparentSunFromMeanSun(instant, meanSunAt(instant))
}
