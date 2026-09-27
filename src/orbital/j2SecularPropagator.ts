import type { SimulationInstant } from '../core/time.ts'
import type { OrbitGeometry } from './geometry.ts'
import { j2SecularElementsAt, j2SecularRates, type AngleRates, type DriftedElements } from './j2Secular.ts'
import { solveEccentricAnomaly, trueFromEccentricAnomaly } from './kepler.ts'
import { stateVectorEci } from './keplerian.ts'
import type { OrbitPhase } from './keplerianPropagator.ts'
import type { OrbitPropagator, OrbitalState } from './propagator.ts'

/** Secular-J2 propagation of a mean element set.
 *
 * `KeplerianPropagator` is deliberately not modified, subclassed or generalised.
 * Duplicating four lines of mean-anomaly arithmetic is preferable to a
 * rate-parameterised base class whose zero case would then have to be proven
 * identical to today's behaviour; `j2SecularPropagator.test.ts` pins that
 * identity directly instead.
 */
export class J2SecularPropagator implements OrbitPropagator {
  readonly kind = 'keplerian' as const
  readonly geometry: OrbitGeometry
  readonly phase: OrbitPhase
  /** Constant for the life of the propagator: a, e and i never change here. */
  readonly rates: AngleRates

  constructor(geometry: OrbitGeometry, phase: OrbitPhase) {
    this.geometry = geometry
    this.phase = phase
    this.rates = j2SecularRates(geometry)
  }

  elementsAt(instant: SimulationInstant): DriftedElements {
    return j2SecularElementsAt(this.geometry, this.phase, instant, this.rates)
  }

  meanAnomalyAt(instant: SimulationInstant): number {
    return this.elementsAt(instant).meanAnomalyRad
  }

  trueAnomalyAt(instant: SimulationInstant): number {
    const drifted = this.elementsAt(instant)
    return trueFromEccentricAnomaly(
      solveEccentricAnomaly(drifted.meanAnomalyRad, this.geometry.eccentricity),
      this.geometry.eccentricity,
    )
  }

  stateAt(instant: SimulationInstant): OrbitalState {
    const drifted = this.elementsAt(instant)
    const eccentricity = this.geometry.eccentricity
    const trueAnomalyRad = trueFromEccentricAnomaly(solveEccentricAnomaly(drifted.meanAnomalyRad, eccentricity), eccentricity)
    return stateVectorEci(drifted.geometry, trueAnomalyRad)
  }
}
