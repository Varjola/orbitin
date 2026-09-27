import type { EarthFixedVec3, ProjectInertialVec3, RenderVec3 } from './referenceFrames.ts'
import { multiplyMat3, transposeMat3, type Mat3 } from './mat3.ts'

/** Convert an Earth-centered inertial vector into the Y-up render frame. */
export function projectInertialToRender(v: ProjectInertialVec3): RenderVec3 {
  return { x: v.x, y: v.z || 0, z: v.y === 0 ? 0 : -v.y }
}

/** Convert a local Earth-fixed vector into the Y-up render axes.
 *
 * The component permutation is intentionally separate from
 * `projectInertialToRender`: a value that has already crossed the Earth-fixed
 * frame boundary must not be relabelled as inertial merely because both
 * render in the same local axis convention.
 */
export function earthFixedToRenderLocal(v: EarthFixedVec3): RenderVec3 {
  return { x: v.x, y: v.z || 0, z: v.y === 0 ? 0 : -v.y }
}

/** Convert a Y-up render-frame vector back to the ECI convention. */
export function renderToProjectInertial(vRender: RenderVec3): ProjectInertialVec3 {
  return { x: vRender.x, y: vRender.z === 0 ? 0 : -vRender.z, z: vRender.y || 0 }
}

/** Takes project-inertial axes to the Y-up render axes; the matrix form of
 *  `projectInertialToRender`, for geometry oriented by a world matrix rather
 *  than by transforming every vertex. */
export const AXIS_SWAP_PROJECT_INERTIAL_TO_RENDER: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0]
const AXIS_SWAP = AXIS_SWAP_PROJECT_INERTIAL_TO_RENDER
/** World orientation of geometry authored in render axes: S * transpose(M) * transpose(S). */
export function earthFixedOrientationToRender(m: Mat3): Mat3 {
  return multiplyMat3(multiplyMat3(AXIS_SWAP, transposeMat3(m)), transposeMat3(AXIS_SWAP))
}
