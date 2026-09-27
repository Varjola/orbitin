/** Sizing and face choice for the Lab grid box. Pure;
 *  every length is in Earth radii (render units). */

const NICE_HALF_SIZES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20] as const
const GRID_SPACINGS = [0.5, 1, 2, 5] as const

/** The largest half-size; bigger orbits extend beyond the box. */
export const LAB_BOX_MAX_HALF_SIZE = NICE_HALF_SIZES[NICE_HALF_SIZES.length - 1]
/** Lines per face at most. */
const MAX_DIVISIONS = 10

/** Smallest nice half-size with room around the largest orbit. */
export function labBoxHalfSize(largestOrbitRadius: number): number {
  const needed = Number.isFinite(largestOrbitRadius) ? largestOrbitRadius * 1.15 : 0
  return NICE_HALF_SIZES.find((size) => size >= needed) ?? LAB_BOX_MAX_HALF_SIZE
}

/** Finest spacing that keeps a face to at most ten divisions. */
export function labGridSpacing(halfSize: number): number {
  return GRID_SPACINGS.find((spacing) => (2 * halfSize) / spacing <= MAX_DIVISIONS) ?? GRID_SPACINGS[GRID_SPACINGS.length - 1]
}

/** For each axis, the sign of the face behind Earth from this camera: the one
 *  on the opposite side. A camera exactly on a plane picks the negative face,
 *  so a camera level with the equator still sees the floor. */
export function backFaces(camera: { readonly x: number; readonly y: number; readonly z: number }): { readonly x: 1 | -1; readonly y: 1 | -1; readonly z: 1 | -1 } {
  return { x: camera.x < 0 ? 1 : -1, y: camera.y < 0 ? 1 : -1, z: camera.z < 0 ? 1 : -1 }
}
