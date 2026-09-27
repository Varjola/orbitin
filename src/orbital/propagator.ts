import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'

export type OrbitSourceKind = 'keplerian' | 'sgp4'

export interface OrbitalState {
  positionProjectInertialKm: ProjectInertialVec3
  velocityProjectInertialKmPerSecond: ProjectInertialVec3
}

export interface OrbitPropagator {
  readonly kind: OrbitSourceKind
  stateAt(instant: SimulationInstant): OrbitalState
}
