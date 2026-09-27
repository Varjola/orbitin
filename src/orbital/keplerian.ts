import { EARTH_MU_KM3_S2 } from '../core/constants.ts'
import { rotatePerifocalToEci } from './rotation.ts'
// Legacy Eci names in this module mean ProjectInertial (J2000).
import type { OrbitGeometry } from './geometry.ts'
import type { OrbitalState } from './propagator.ts'

export function stateVectorEci(geometry: OrbitGeometry, trueAnomalyRad: number): OrbitalState {
  const { semiMajorAxisKm: a, eccentricity: e } = geometry
  const p = a * (1 - e * e)
  const radiusKm = p / (1 + e * Math.cos(trueAnomalyRad))
  const positionPerifocalKm = {
    x: radiusKm * Math.cos(trueAnomalyRad),
    y: radiusKm * Math.sin(trueAnomalyRad),
    z: 0,
  }
  const velocityScaleKmPerSecond = Math.sqrt(EARTH_MU_KM3_S2 / p)
  const velocityPerifocalKmPerSecond = {
    x: -velocityScaleKmPerSecond * Math.sin(trueAnomalyRad),
    y: velocityScaleKmPerSecond * (e + Math.cos(trueAnomalyRad)),
    z: 0,
  }
  return {
    positionProjectInertialKm: rotatePerifocalToEci(positionPerifocalKm, geometry),
    velocityProjectInertialKmPerSecond: rotatePerifocalToEci(velocityPerifocalKmPerSecond, geometry),
  }
}
