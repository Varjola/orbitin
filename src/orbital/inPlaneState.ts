import { wrapRadians } from '../core/angles.ts'
import { EARTH_MU_KM3_S2 } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { dotVec3 } from '../core/vec3.ts'
import { PERIAPSIS_SINGULAR_ECCENTRICITY } from './elementConditioning.ts'
import type { OrbitGeometry } from './geometry.ts'
import type { OrbitalState } from './propagator.ts'
import { rotatePerifocalToEci } from './rotation.ts'

/** An orbital plane and its sense of motion: an orbit in it moves
 *  anticlockwise as seen from `normal`. */
export interface OrbitPlane {
  readonly inclinationRad: number
  readonly raanRad: number
}

export interface OrbitPlaneBasis {
  /** Towards the ascending node. */
  readonly node: ProjectInertialVec3
  /** In the plane, 90° past the node in the direction of motion. */
  readonly ahead: ProjectInertialVec3
  /** Along the angular momentum of an orbit in this plane. */
  readonly normal: ProjectInertialVec3
}

export function orbitPlaneBasis(plane: OrbitPlane): OrbitPlaneBasis {
  const atNode = { ...plane, semiMajorAxisKm: 1, eccentricity: 0, argOfPeriapsisRad: 0 }
  return {
    node: rotatePerifocalToEci({ x: 1, y: 0, z: 0 }, atNode),
    ahead: rotatePerifocalToEci({ x: 0, y: 1, z: 0 }, atNode),
    normal: rotatePerifocalToEci({ x: 0, y: 0, z: 1 }, atNode),
  }
}

/** The orbit through a state that lies in a known plane. Inclination and RAAN
 *  are taken from the plane exactly, so a burn along the velocity never moves
 *  the plane and no node singularity arises; only a, e, ω and the true anomaly
 *  are computed. Out-of-plane components of the state are ignored. Below
 *  `PERIAPSIS_SINGULAR_ECCENTRICITY` the orbit is treated as a circle: e and
 *  ω are 0 and the true anomaly is the argument of latitude. */
export function inPlaneElementsFromState(
  plane: OrbitPlane,
  state: OrbitalState,
): { readonly geometry: OrbitGeometry; readonly trueAnomalyRad: number } {
  const basis = orbitPlaneBasis(plane)
  const position = state.positionProjectInertialKm
  const velocity = state.velocityProjectInertialKmPerSecond
  const x = dotVec3(position, basis.node)
  const y = dotVec3(position, basis.ahead)
  const vx = dotVec3(velocity, basis.node)
  const vy = dotVec3(velocity, basis.ahead)
  if (x * vy - y * vx <= 0) throw new Error('The state does not move in the plane\'s direction of motion')
  const radiusKm = Math.hypot(x, y)
  const speedSquared = vx * vx + vy * vy
  const specificEnergy = speedSquared / 2 - EARTH_MU_KM3_S2 / radiusKm
  if (!(specificEnergy < 0)) throw new Error('Only elliptical orbits are supported')
  const semiMajorAxisKm = -EARTH_MU_KM3_S2 / (2 * specificEnergy)
  const radialSpeedTerm = x * vx + y * vy
  const ex = ((speedSquared - EARTH_MU_KM3_S2 / radiusKm) * x - radialSpeedTerm * vx) / EARTH_MU_KM3_S2
  const ey = ((speedSquared - EARTH_MU_KM3_S2 / radiusKm) * y - radialSpeedTerm * vy) / EARTH_MU_KM3_S2
  const eccentricity = Math.hypot(ex, ey)
  if (eccentricity >= 1) throw new Error('Only elliptical orbits are supported')
  const argumentOfLatitudeRad = Math.atan2(y, x)
  const circular = eccentricity < PERIAPSIS_SINGULAR_ECCENTRICITY
  const argOfPeriapsisRad = circular ? 0 : wrapRadians(Math.atan2(ey, ex))
  return {
    geometry: {
      semiMajorAxisKm,
      eccentricity: circular ? 0 : eccentricity,
      inclinationRad: plane.inclinationRad,
      raanRad: plane.raanRad,
      argOfPeriapsisRad,
    },
    trueAnomalyRad: wrapRadians(argumentOfLatitudeRad - argOfPeriapsisRad),
  }
}
