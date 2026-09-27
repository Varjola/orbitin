/** The perifocal-to-render rotation, as one matrix.
 *
 * Under both propagation models a, e and i are constant, so the conic's shape
 * in the perifocal plane never changes and neither does its in-plane sample
 * set. Only this rotation changes as the plane drifts. Sampling once in
 * perifocal coordinates and writing an orientation per frame is what lets a
 * drifting orbit path follow its plane without resampling or reallocating a GPU
 * buffer.
 *
 *     orientation = AXIS_SWAP * Rz(RAAN) * Rx(i) * Rz(ArgP)
 *
 * This represents the same rotation as
 * `projectInertialToRender(rotatePerifocalToEci(v, geometry))`, but not the
 * same arithmetic: composing the matrices reassociates the same products, and
 * `projectInertialToRender` additionally normalises signed zeros. The
 * equivalence is therefore numerical, to about 1e-12 render units, not
 * bit-exact.
 */
import { multiplyMat3, rotationXMat3, rotationZMat3, type Mat3 } from '../core/mat3.ts'
import { AXIS_SWAP_PROJECT_INERTIAL_TO_RENDER } from '../core/renderFrame.ts'
import type { OrbitGeometry } from './geometry.ts'

/** Only the three angles enter; a and e do not affect orientation. */
export type OrbitOrientationAngles = Pick<OrbitGeometry, 'inclinationRad' | 'raanRad' | 'argOfPeriapsisRad'>

export function perifocalToRenderOrientation(elements: OrbitOrientationAngles): Mat3 {
  const perifocalToProjectInertial = multiplyMat3(
    multiplyMat3(rotationZMat3(elements.raanRad), rotationXMat3(elements.inclinationRad)),
    rotationZMat3(elements.argOfPeriapsisRad),
  )
  return multiplyMat3(AXIS_SWAP_PROJECT_INERTIAL_TO_RENDER, perifocalToProjectInertial)
}

export function sameOrientationAngles(a: OrbitOrientationAngles, b: OrbitOrientationAngles): boolean {
  return a.inclinationRad === b.inclinationRad && a.raanRad === b.raanRad && a.argOfPeriapsisRad === b.argOfPeriapsisRad
}

export function sameConicShape(
  a: { semiMajorAxisKm: number; eccentricity: number },
  b: { semiMajorAxisKm: number; eccentricity: number },
): boolean {
  return a.semiMajorAxisKm === b.semiMajorAxisKm && a.eccentricity === b.eccentricity
}
