import { wrapRadians } from '../core/angles.ts'
import { EARTH_MU_KM3_S2 } from '../core/constants.ts'
import { crossVec3, dotVec3, lengthVec3, scaleVec3, subtractVec3, type Vec3 } from '../core/vec3.ts'
import { NODE_SINGULAR_SIN_INCLINATION, PERIAPSIS_SINGULAR_ECCENTRICITY } from './elementConditioning.ts'
import type { OrbitGeometry } from './geometry.ts'
import type { OrbitalState } from './propagator.ts'

/** The ellipse through a state: the general inverse of `stateVectorEci`.
 *
 *  Where an angle does not exist, the convention keeps the state exact: without
 *  a line of nodes RAAN is 0 and the angles count from the x axis; without a
 *  periapsis e and ω are 0 and the true anomaly counts from the node. Only the
 *  two singular cases of `elementConditioning.ts` take these conventions. An
 *  ill-conditioned angle is still computed: what a readout may show of it is
 *  that module's decision.
 *
 *  Throws for a state that is not on an ellipse: a burn can reach a parabola or
 *  a hyperbola, and a state with no angular momentum has no plane. */
export function elementsFromState(state: OrbitalState): { readonly geometry: OrbitGeometry; readonly trueAnomalyRad: number } {
  const position = state.positionProjectInertialKm
  const velocity = state.velocityProjectInertialKmPerSecond
  const radiusKm = lengthVec3(position)
  const angularMomentum = crossVec3(position, velocity)
  const angularMomentumSize = lengthVec3(angularMomentum)
  // Relative to r v, so that this reads the same at any orbit size.
  if (!(angularMomentumSize > 1e-12 * radiusKm * lengthVec3(velocity))) throw new Error('A state with no angular momentum has no orbit plane')
  const speedSquared = dotVec3(velocity, velocity)
  const specificEnergy = speedSquared / 2 - EARTH_MU_KM3_S2 / radiusKm
  if (!(specificEnergy < 0)) throw new Error('Only elliptical orbits are supported')
  const eccentricityVector = scaleVec3(
    subtractVec3(scaleVec3(position, speedSquared - EARTH_MU_KM3_S2 / radiusKm), scaleVec3(velocity, dotVec3(position, velocity))),
    1 / EARTH_MU_KM3_S2,
  )
  const eccentricity = lengthVec3(eccentricityVector)
  if (eccentricity >= 1) throw new Error('Only elliptical orbits are supported')

  const normal = scaleVec3(angularMomentum, 1 / angularMomentumSize)
  const sinInclination = Math.hypot(normal.x, normal.y)
  const inclinationRad = Math.atan2(sinInclination, normal.z)
  const hasNode = sinInclination > NODE_SINGULAR_SIN_INCLINATION
  const raanRad = hasNode ? wrapRadians(Math.atan2(normal.x, -normal.y)) : 0
  const node: Vec3 = { x: Math.cos(raanRad), y: Math.sin(raanRad), z: 0 }
  const ahead = crossVec3(normal, node)
  const anglePastNode = (vector: Vec3) => Math.atan2(dotVec3(vector, ahead), dotVec3(vector, node))
  const circular = eccentricity < PERIAPSIS_SINGULAR_ECCENTRICITY
  const argOfPeriapsisRad = circular ? 0 : wrapRadians(anglePastNode(eccentricityVector))
  return {
    geometry: {
      semiMajorAxisKm: -EARTH_MU_KM3_S2 / (2 * specificEnergy),
      eccentricity: circular ? 0 : eccentricity,
      inclinationRad,
      raanRad,
      argOfPeriapsisRad,
    },
    trueAnomalyRad: wrapRadians(anglePastNode(position) - argOfPeriapsisRad),
  }
}
