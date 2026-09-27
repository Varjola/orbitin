import { TAU } from '../core/angles.ts'
import type { Vec3 } from '../core/vec3.ts'
import type { OrbitGeometry } from './geometry.ts'
import { stateVectorEci } from './keplerian.ts'

export function sampleKeplerianPathEciKm(geometry: OrbitGeometry, sampleCount: number): Vec3[] {
  if (!Number.isInteger(sampleCount) || sampleCount < 3) throw new Error('sampleCount must be at least 3')
  const positions: Vec3[] = []
  for (let index = 0; index <= sampleCount; index += 1) {
    if (index === sampleCount) {
      positions.push({ ...positions[0] })
      continue
    }
    const trueAnomalyRad = (index / sampleCount) * TAU
    positions.push(stateVectorEci(geometry, trueAnomalyRad).positionProjectInertialKm)
  }
  return positions
}

/** The same conic sampled in **perifocal** coordinates, where it depends only
 *  on a and e. Under both propagation models those are constant, so this sample
 *  set never changes and a drifting orbit is drawn by writing an orientation
 *  rather than by resampling. */
export function samplePerifocalPathKm(
  shape: { semiMajorAxisKm: number; eccentricity: number },
  sampleCount: number,
): Vec3[] {
  if (!Number.isInteger(sampleCount) || sampleCount < 3) throw new Error('sampleCount must be at least 3')
  const { semiMajorAxisKm: a, eccentricity: e } = shape
  const semiLatusRectumKm = a * (1 - e * e)
  const positions: Vec3[] = []
  for (let index = 0; index <= sampleCount; index += 1) {
    if (index === sampleCount) {
      positions.push({ ...positions[0] })
      continue
    }
    const trueAnomalyRad = (index / sampleCount) * TAU
    const radiusKm = semiLatusRectumKm / (1 + e * Math.cos(trueAnomalyRad))
    positions.push({ x: radiusKm * Math.cos(trueAnomalyRad), y: radiusKm * Math.sin(trueAnomalyRad), z: 0 })
  }
  return positions
}
