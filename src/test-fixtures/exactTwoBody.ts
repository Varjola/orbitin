import { EARTH_MU_KM3_S2 } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { addVec3, dotVec3, lengthVec3, scaleVec3 } from '../core/vec3.ts'

function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z
  return 0.5 - z / 24
}

function stumpffS(z: number): number {
  if (z > 1e-8) { const root = Math.sqrt(z); return (root - Math.sin(root)) / root ** 3 }
  if (z < -1e-8) { const root = Math.sqrt(-z); return (Math.sinh(root) - root) / root ** 3 }
  return 1 / 6 - z / 120
}

/** Exact two-body motion by universal variables, sharing nothing with the solvers
 *  it checks and with no step error, on any conic and through any perigee. */
export function propagateTwoBody(start: ProjectInertialVec3, velocity: ProjectInertialVec3, seconds: number): { readonly position: ProjectInertialVec3; readonly velocity: ProjectInertialVec3 } {
  const rootMu = Math.sqrt(EARTH_MU_KM3_S2)
  const r0 = lengthVec3(start)
  const alpha = 2 / r0 - dotVec3(velocity, velocity) / EARTH_MU_KM3_S2
  const sigma0 = dotVec3(start, velocity) / rootMu
  const timeAt = (chi: number) => {
    const z = alpha * chi * chi
    return sigma0 * chi * chi * stumpffC(z) + (1 - alpha * r0) * chi ** 3 * stumpffS(z) + r0 * chi
  }
  // The time is monotonic in chi, so a bracket always closes on the answer.
  const target = rootMu * seconds
  let low = 0
  let high = Math.max(1, target / r0)
  while (timeAt(high) < target) high *= 2
  let chi = (low + high) / 2
  for (let step = 0; step < 200; step += 1) {
    chi = (low + high) / 2
    if (timeAt(chi) < target) low = chi; else high = chi
    if (high - low <= 1e-14 * high) break
  }
  const z = alpha * chi * chi
  const f = 1 - (chi * chi * stumpffC(z)) / r0
  const g = seconds - (chi ** 3 * stumpffS(z)) / rootMu
  const position = addVec3(scaleVec3(start, f), scaleVec3(velocity, g))
  const radius = lengthVec3(position)
  const fDot = (rootMu / (radius * r0)) * (alpha * chi ** 3 * stumpffS(z) - chi)
  const gDot = 1 - (chi * chi * stumpffC(z)) / radius
  return { position, velocity: addVec3(scaleVec3(start, fDot), scaleVec3(velocity, gDot)) }
}
