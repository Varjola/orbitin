import { degToRad, TAU, wrapRadians } from '../core/angles.ts'
import { julianCenturiesSinceJ2000 } from '../core/julianDate.ts'
import { multiplyMat3, rotationYMat3, rotationZMat3, transposeMat3 } from '../core/mat3.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'

// Accuracy and omissions: docs/environment-model.md. Frame registration is
// approximately 0.015 deg; Sun/surface approximately 0.03 deg; satellite ground
// position is dominated by the separate two-body propagation model.

/** IAU 1982 GMST, UTC approximates UT1 (DUT1 omitted). */
export function greenwichMeanSiderealTime(instant: SimulationInstant): number {
  const T = julianCenturiesSinceJ2000(instant)
  const seconds = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 0.0000062 * T * T * T
  return wrapRadians((seconds % 86400) * TAU / 86400)
}
/** IAU 1976, Lieske et al. (1977); Meeus 2nd ed., ch.21 eq.21.4.
 * J2000 mean equator/equinox -> mean of date. No nutation or polar motion.
 */
export function earthOrientationAt(instant: SimulationInstant): EarthOrientation {
  const T = julianCenturiesSinceJ2000(instant), T2 = T * T, T3 = T2 * T
  const zeta = degToRad((2306.2181 * T + 0.30188 * T2 + 0.017998 * T3) / 3600)
  const z = degToRad((2306.2181 * T + 1.09468 * T2 + 0.018203 * T3) / 3600)
  const theta = degToRad((2004.3109 * T - 0.42665 * T2 - 0.041833 * T3) / 3600)
  const precessionToMeanOfDate = multiplyMat3(multiplyMat3(rotationZMat3(z), rotationYMat3(-theta)), rotationZMat3(zeta))
  const gmstRad = greenwichMeanSiderealTime(instant)
  const projectInertialToEarthFixed = multiplyMat3(rotationZMat3(-gmstRad), precessionToMeanOfDate)
  return { instant, gmstRad, precessionToMeanOfDate, projectInertialToEarthFixed, earthFixedToProjectInertial: transposeMat3(projectInertialToEarthFixed) }
}
