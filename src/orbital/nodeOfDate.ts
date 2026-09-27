/** The ascending node in the mean equator of date.
 *
 * The ascending node is defined relative to a reference equatorial plane. The
 * stored RAAN is defined against the J2000 mean equator; local mean solar time
 * must be evaluated against the mean equator *of date*, because that is the
 * plane the mean Sun's right ascension is measured in (INV-5).
 *
 * Rotating the J2000 node *vector* into mean-of-date and reading its right
 * ascension is not the fix, and is wrong rather than approximate: the rotated
 * node vector does not generally lie in the mean-of-date equator, so its right
 * ascension is not the right ascension of the node of the transformed plane.
 * The error reaches 0.77 deg - 3.1 minutes of local time - inside the supported
 * epoch range. The construction below goes through the plane's normal instead.
 */
import { applyMat3, type Mat3 } from '../core/mat3.ts'
import type { MeanOfDateVec3, ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { wrapRadians, wrapRadiansSigned } from '../core/angles.ts'
import type { OrbitGeometry } from './geometry.ts'
import { NODE_SINGULAR_SIN_INCLINATION } from './elementConditioning.ts'

/** Orbit-plane normal, h / |h|, in project-inertial (J2000).
 *  Equal to `rotatePerifocalToEci({ x: 0, y: 0, z: 1 }, elements)`. */
export function orbitNormalProjectInertial(elements: OrbitGeometry): ProjectInertialVec3 {
  const sine = Math.sin(elements.inclinationRad)
  return {
    x: sine * Math.sin(elements.raanRad),
    y: -sine * Math.cos(elements.raanRad),
    z: Math.cos(elements.inclinationRad),
  }
}

/** `singular` means the transformed orbit plane coincides with the mean-of-date
 *  equator, so no line of nodes exists. It is decided on the transformed
 *  normal's equatorial projection, not on the stored inclination, and it is
 *  **not** the display-suppression threshold. */
export type NodeOfDate =
  | { kind: 'defined'; rightAscensionRad: number; inclinationOfDateRad: number }
  | { kind: 'singular' }

export function nodeOfDate(elements: OrbitGeometry, precessionToMeanOfDate: Mat3): NodeOfDate {
  const normalMeanOfDate: MeanOfDateVec3 = applyMat3(precessionToMeanOfDate, orbitNormalProjectInertial(elements))
  // The line of nodes in mean-of-date is z_mod x h_mod = (-h.y, h.x, 0); its
  // length is sin of the inclination of date.
  const equatorialProjection = Math.hypot(normalMeanOfDate.x, normalMeanOfDate.y)
  if (equatorialProjection <= NODE_SINGULAR_SIN_INCLINATION) return { kind: 'singular' }
  return {
    kind: 'defined',
    rightAscensionRad: wrapRadians(Math.atan2(normalMeanOfDate.x, -normalMeanOfDate.y)),
    inclinationOfDateRad: Math.atan2(equatorialProjection, normalMeanOfDate.z),
  }
}

/** Inverse: the project-inertial RAAN whose mean-of-date node right ascension is
 *  `targetRightAscensionOfDateRad`. Fixed-point iteration on the same
 *  `nodeOfDate` the readout uses, so preset creation and readout cannot
 *  silently disagree. */
export function raanForNodeRightAscensionOfDate(
  inclinationRad: number,
  targetRightAscensionOfDateRad: number,
  precessionToMeanOfDate: Mat3,
): number {
  let raanRad = wrapRadians(targetRightAscensionOfDateRad)
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const node = nodeOfDate({ semiMajorAxisKm: 1, eccentricity: 0, inclinationRad, raanRad, argOfPeriapsisRad: 0 }, precessionToMeanOfDate)
    if (node.kind === 'singular') throw new Error('Cannot solve RAAN for an orbit whose plane is the mean-of-date equator')
    const residual = wrapRadiansSigned(targetRightAscensionOfDateRad - node.rightAscensionRad)
    raanRad = wrapRadians(raanRad + residual)
    if (Math.abs(residual) < 1e-12) return raanRad
  }
  throw new Error('RAAN solution for a mean-of-date node right ascension did not converge')
}
