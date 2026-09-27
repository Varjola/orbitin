import { wrapRadians } from '../core/angles.ts'
import type { SimulationInstant } from '../core/time.ts'
import { secondsBetween } from '../core/time.ts'
import type { OrbitGeometry } from './geometry.ts'
import { meanMotion } from './geometry.ts'
import { meanFromTrueAnomaly, solveEccentricAnomaly, trueFromEccentricAnomaly } from './kepler.ts'
import { stateVectorEci } from './keplerian.ts'
import type { OrbitPropagator, OrbitalState } from './propagator.ts'

export interface OrbitPhase {
  referenceInstant: SimulationInstant
  meanAnomalyAtReferenceRad: number
}

export class KeplerianPropagator implements OrbitPropagator {
  readonly kind = 'keplerian' as const
  readonly geometry: OrbitGeometry
  readonly phase: OrbitPhase

  constructor(geometry: OrbitGeometry, phase: OrbitPhase) {
    this.geometry = geometry
    this.phase = phase
  }

  meanAnomalyAt(instant: SimulationInstant): number {
    return wrapRadians(
      this.phase.meanAnomalyAtReferenceRad + meanMotion(this.geometry) * secondsBetween(instant, this.phase.referenceInstant),
    )
  }

  trueAnomalyAt(instant: SimulationInstant): number {
    return trueFromEccentricAnomaly(solveEccentricAnomaly(this.meanAnomalyAt(instant), this.geometry.eccentricity), this.geometry.eccentricity)
  }

  stateAt(instant: SimulationInstant): OrbitalState {
    return stateVectorEci(this.geometry, this.trueAnomalyAt(instant))
  }
}

export function reanchorPhase(
  geometry: OrbitGeometry,
  phase: OrbitPhase,
  atInstant: SimulationInstant,
): OrbitPhase {
  const propagator = new KeplerianPropagator(geometry, phase)
  return { referenceInstant: { ...atInstant }, meanAnomalyAtReferenceRad: propagator.meanAnomalyAt(atInstant) }
}

export function phaseFromTrueAnomaly(
  eccentricity: number,
  trueAnomalyRad: number,
  atInstant: SimulationInstant,
): OrbitPhase {
  return { referenceInstant: { ...atInstant }, meanAnomalyAtReferenceRad: meanFromTrueAnomaly(trueAnomalyRad, eccentricity) }
}

export function currentTrueAnomaly(geometry: OrbitGeometry, phase: OrbitPhase, instant: SimulationInstant): number {
  return new KeplerianPropagator(geometry, phase).trueAnomalyAt(instant)
}
