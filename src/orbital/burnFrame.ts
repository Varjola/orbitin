import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { addVec3, crossVec3, dotVec3, lengthVec3, scaleVec3 } from '../core/vec3.ts'
import type { OrbitalState } from './propagator.ts'

/** The three directions a burn is described in at a point of an orbit. All three
 *  are perpendicular, so the parts of a burn add up to its size.
 *
 *  **Prograde** follows the velocity rather than the local horizontal: it is what
 *  "speed up" means, and the only direction that changes speed most directly.
 *  **Normal** is along the angular momentum and alone tilts the plane. **Outward**
 *  completes the set. On a circle it points straight up, away from the Earth. */
export interface BurnFrame {
  readonly prograde: ProjectInertialVec3
  readonly normal: ProjectInertialVec3
  readonly outward: ProjectInertialVec3
}

export interface BurnComponents {
  readonly progradeKmPerSecond: number
  readonly normalKmPerSecond: number
  readonly outwardKmPerSecond: number
}

export function burnFrame(state: OrbitalState): BurnFrame {
  const velocity = state.velocityProjectInertialKmPerSecond
  const speed = lengthVec3(velocity)
  const angularMomentum = crossVec3(state.positionProjectInertialKm, velocity)
  const angularMomentumSize = lengthVec3(angularMomentum)
  if (!(speed > 0) || !(angularMomentumSize > 0)) throw new Error('A state with no angular momentum has no burn frame')
  const prograde = scaleVec3(velocity, 1 / speed)
  const normal = scaleVec3(angularMomentum, 1 / angularMomentumSize)
  return { prograde, normal, outward: crossVec3(prograde, normal) }
}

export function burnComponents(state: OrbitalState, deltaVKmPerSecond: ProjectInertialVec3): BurnComponents {
  const frame = burnFrame(state)
  return {
    progradeKmPerSecond: dotVec3(deltaVKmPerSecond, frame.prograde),
    normalKmPerSecond: dotVec3(deltaVKmPerSecond, frame.normal),
    outwardKmPerSecond: dotVec3(deltaVKmPerSecond, frame.outward),
  }
}

export function burnFromComponents(state: OrbitalState, components: BurnComponents): ProjectInertialVec3 {
  const frame = burnFrame(state)
  return addVec3(addVec3(scaleVec3(frame.prograde, components.progradeKmPerSecond), scaleVec3(frame.normal, components.normalKmPerSecond)), scaleVec3(frame.outward, components.outwardKmPerSecond))
}
