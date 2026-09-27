import { applyMat3, transposeMat3 } from '../core/mat3.ts'
import type { EarthOrientation, ProjectInertialVec3 } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import { earthOrientationAt } from './earthOrientation.ts'
import { meanSunAt } from './meanSun.ts'
import { subSolarPoint } from './subSolarPoint.ts'
import { apparentSunFromMeanSun } from './sun.ts'

export interface EnvironmentState {
  readonly instant: SimulationInstant
  readonly orientation: EarthOrientation
  readonly sunDirectionProjectInertial: ProjectInertialVec3
  readonly sunEquatorialOfDate: { readonly rightAscensionRad: number; readonly declinationRad: number }
  readonly subSolarPoint: { readonly latitudeRad: number; readonly longitudeRad: number }
  /** Right ascension of the fictitious mean Sun, mean equator and equinox of
   *  date. Local *mean* solar time is defined against this, never against the
   *  apparent Sun above (INV-4). */
  readonly meanSunRightAscensionOfDateRad: number
}
/** Scene-wide derivation, once per frame, including paused frames. The mean Sun
 *  is evaluated once here and fed to the apparent Sun (INV-11). */
export function environmentAt(instant: SimulationInstant): EnvironmentState {
  const orientation = earthOrientationAt(instant)
  const meanSun = meanSunAt(instant)
  const sun = apparentSunFromMeanSun(instant, meanSun)
  return { instant, orientation,
    sunDirectionProjectInertial: applyMat3(transposeMat3(orientation.precessionToMeanOfDate), sun.directionMeanOfDate),
    sunEquatorialOfDate: { rightAscensionRad: sun.rightAscensionRad, declinationRad: sun.declinationRad },
    subSolarPoint: subSolarPoint(sun.rightAscensionRad, sun.declinationRad, orientation.gmstRad),
    meanSunRightAscensionOfDateRad: meanSun.rightAscensionMeanOfDateRad }
}
