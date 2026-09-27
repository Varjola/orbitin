import type { Vec3 } from './vec3.ts'

/** Row-major 3x3: m[row * 3 + column]. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]
export function identityMat3(): Mat3 { return [1, 0, 0, 0, 1, 0, 0, 0, 1] }
/** Right-handed vector rotations, not rotations of coordinate axes. */
export function rotationYMat3(rad: number): Mat3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}
/** Maps +Y to (0, cos(rad), sin(rad)). */
export function rotationXMat3(rad: number): Mat3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
/** Maps +X to (cos(rad), sin(rad), 0). */
export function rotationZMat3(rad: number): Mat3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return out as unknown as Mat3
}
/** For orthonormal rotations, transpose is the inverse. */
export function transposeMat3(m: Mat3): Mat3 { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]] }
export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z }
}
