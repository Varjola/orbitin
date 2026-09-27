import type { SimulationInstant } from '../core/time.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { temeToProjectInertialState } from './teme.ts'
import type { OrbitPropagator, OrbitalState } from './propagator.ts'
import { createSatelliteJsAdapter, type SatelliteJsAdapter } from './satelliteJsAdapter.ts'

export class Sgp4Propagator implements OrbitPropagator {
  readonly kind = 'sgp4' as const
  private readonly adapter: SatelliteJsAdapter
  readonly meanElements: Sgp4MeanElements
  constructor(meanElements: Sgp4MeanElements) { this.meanElements = meanElements; this.adapter = createSatelliteJsAdapter(meanElements) }
  stateAt(instant: SimulationInstant): OrbitalState {
    return temeToProjectInertialState(this.adapter.temeStateAt(instant), instant)
  }
  temeStateAt(instant: SimulationInstant) { return this.adapter.temeStateAt(instant) }
}
