import { multiplyMat3, rotationXMat3, rotationZMat3, transposeMat3, type Mat3 } from '../core/mat3.ts'
import type { ProjectInertialVec3, TemeVec3 } from '../core/referenceFrames.ts'
import { earthOrientationAt } from '../simulation/earthOrientation.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { OrbitalState } from './propagator.ts'
import type { TemeState } from './satelliteJsAdapter.ts'
import { iau1980NutationAt } from './nutation1980.ts'

/**
 * TEME -> TOD -> MOD -> ProjectInertial, using active column-vector rotations.
 * `precessionToMeanOfDate` is ProjectInertial -> MOD, so its transpose is the
 * final MOD -> ProjectInertial step. The equation of the equinoxes here is
 * geometric-only, as required by Vallado's TEME reduction; EOP corrections and
 * complementary terms are intentionally zero.
 */
export function temeToProjectInertialMatrix(instant: SimulationInstant): Mat3 {
  // The matrix is a pure function of the instant. Every object in a frame is
  // evaluated at the same instant, and the IAU-1980 series is about 97 % of an
  // SGP4 state's cost, so the last result is reused when the
  // instant is identical. The returned tuple is readonly and shared.
  if (lastMatrix !== null && instant.unixSeconds === lastMatrixInstantSeconds) return lastMatrix
  lastMatrix = computeTemeToProjectInertialMatrix(instant)
  lastMatrixInstantSeconds = instant.unixSeconds
  return lastMatrix
}

let lastMatrix: Mat3 | null = null
let lastMatrixInstantSeconds = Number.NaN

function computeTemeToProjectInertialMatrix(instant: SimulationInstant): Mat3 {
  const orientation = earthOrientationAt(instant)
  const nutation = iau1980NutationAt(instant)
  const equationOfEquinoxesRad = nutation.deltaPsiRad * Math.cos(nutation.meanObliquityRad)
  const todToMod = multiplyMat3(
    multiplyMat3(rotationXMat3(nutation.meanObliquityRad), rotationZMat3(-nutation.deltaPsiRad)),
    rotationXMat3(-nutation.trueObliquityRad),
  )
  return multiplyMat3(
    transposeMat3(orientation.precessionToMeanOfDate),
    multiplyMat3(todToMod, rotationZMat3(equationOfEquinoxesRad)),
  )
}

export function projectInertialToTemeMatrix(instant: SimulationInstant): Mat3 {
  return transposeMat3(temeToProjectInertialMatrix(instant))
}

export function temeToProjectInertialState(state: TemeState, instant: SimulationInstant): OrbitalState {
  const matrix = temeToProjectInertialMatrix(instant)
  const apply = (v: TemeVec3): ProjectInertialVec3 => {
    const x = matrix[0] * v.x + matrix[1] * v.y + matrix[2] * v.z
    const y = matrix[3] * v.x + matrix[4] * v.y + matrix[5] * v.z
    const z = matrix[6] * v.x + matrix[7] * v.y + matrix[8] * v.z
    return { x, y, z }
  }
  return { positionProjectInertialKm: apply(state.positionTemeKm), velocityProjectInertialKmPerSecond: apply(state.velocityTemeKmPerSecond) }
}
