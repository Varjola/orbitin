import type { CatalogueOrbitAnalysis } from '../data/catalogueEnrichment.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { OrbitPropagationError } from './propagationError.ts'
import { createSatelliteJsAdapter } from './satelliteJsAdapter.ts'

/** Earth radius used by satellite.js' WGS-72 SGP4 constants. `SatRec.a`,
 *  `alta` and `altp` are in these units. */
export const WGS72_EARTH_RADIUS_KM = 6378.135

/** Catalogue analysis from one initialization of the pinned scalar SGP4 path.
 *
 * Validation and analysis share the initialized record, so the reported
 * period and regime are exactly what the propagator will use: SGP4's recovered
 * (un-Kozai) mean motion, and deep-space precisely when satellite.js selected
 * its deep-space method. Provider-supplied orbit summaries play no part.
 *
 * Throws `OrbitPropagationError` when the record cannot initialize or cannot
 * propagate at its own epoch; such a record is not catalogue-valid. */
export function analyzeSgp4ForCatalogue(elements: Sgp4MeanElements): CatalogueOrbitAnalysis {
  const adapter = createSatelliteJsAdapter(elements)
  adapter.temeStateAt(elements.epoch)
  const { record } = adapter
  const analysis: CatalogueOrbitAnalysis = {
    recoveredPeriodMinutes: (2 * Math.PI) / record.no,
    semimajorAxisKm: record.a * WGS72_EARTH_RADIUS_KM,
    perigeeAltitudeKm: record.altp * WGS72_EARTH_RADIUS_KM,
    apogeeAltitudeKm: record.alta * WGS72_EARTH_RADIUS_KM,
    regime: record.method === 'd' ? 'deep-space' : 'near-earth',
  }
  if (![analysis.recoveredPeriodMinutes, analysis.semimajorAxisKm, analysis.perigeeAltitudeKm, analysis.apogeeAltitudeKm].every(Number.isFinite)) {
    throw new OrbitPropagationError('initialization', 'SGP4 initialization produced a non-finite orbit summary.')
  }
  return analysis
}
