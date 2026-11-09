import { wrapRadians } from '../../core/angles.ts'
import type { SimulationInstant } from '../../core/time.ts'
import type { Sgp4MeanElements } from '../../data/sgp4MeanElements.ts'
import { elementsFromState } from '../../orbital/elementsFromState.ts'
import { phaseFromTrueAnomaly } from '../../orbital/keplerianPropagator.ts'
import { createSatelliteJsAdapter } from '../../orbital/satelliteJsAdapter.ts'
import { WGS72_EARTH_RADIUS_KM } from '../../orbital/sgp4CatalogueAnalysis.ts'
import { temeToProjectInertialState } from '../../orbital/teme.ts'
import { ROUTE_MAX_APOGEE_RADIUS_KM, ROUTE_MIN_PERIGEE_RADIUS_KM, type RouteSatellite } from './routeModel.ts'
import type { RouteExampleId } from './routeSetup.ts'

/** Why a satellite cannot be planned with. */
export type RouteRefusal = 'noElements' | 'tooLow' | 'tooHigh'

export type RouteSatelliteResult =
  | { readonly ok: true; readonly satellite: RouteSatellite }
  | { readonly ok: false; readonly refusal: RouteRefusal }

/** Every leg of a route keeps within these, so a satellite must start within them. */
export function routeSatelliteRefusal(satellite: RouteSatellite): RouteRefusal | null {
  const { semiMajorAxisKm, eccentricity } = satellite.geometry
  if (semiMajorAxisKm * (1 - eccentricity) < ROUTE_MIN_PERIGEE_RADIUS_KM) return 'tooLow'
  if (semiMajorAxisKm * (1 + eccentricity) > ROUTE_MAX_APOGEE_RADIUS_KM) return 'tooHigh'
  return null
}

function checked(satellite: RouteSatellite): RouteSatelliteResult {
  const refusal = routeSatelliteRefusal(satellite)
  return refusal === null ? { ok: true, satellite } : { ok: false, refusal }
}

/** A catalogue object as the route model sees it at an instant.
 *
 *  Size and shape are SGP4's averaged elements there: an osculating state read as
 *  a Keplerian orbit puts `a` up to about 10 km off, which is about 100 km of drift
 *  an orbit against what SGP4 shows. The plane and the place along the orbit are
 *  SGP4's own state, so the satellite starts where Real Objects shows it. */
export function catalogueSatellite(name: string, elements: Sgp4MeanElements, instant: SimulationInstant): RouteSatelliteResult {
  let satellite: RouteSatellite
  try {
    const { state, averaged } = createSatelliteJsAdapter(elements).propagateAt(instant)
    const shown = elementsFromState(temeToProjectInertialState(state, instant))
    // Measured from the node in the plane, so the same in either frame.
    const argumentOfLatitudeRad = shown.geometry.argOfPeriapsisRad + shown.trueAnomalyRad
    const eccentricity = averaged.eccentricity
    const argOfPeriapsisRad = wrapRadians(averaged.argOfPerigeeRad)
    satellite = {
      name,
      geometry: {
        semiMajorAxisKm: averaged.semiMajorAxisEarthRadii * WGS72_EARTH_RADIUS_KM,
        eccentricity,
        inclinationRad: shown.geometry.inclinationRad,
        raanRad: shown.geometry.raanRad,
        argOfPeriapsisRad,
      },
      phase: phaseFromTrueAnomaly(eccentricity, wrapRadians(argumentOfLatitudeRad - argOfPeriapsisRad), instant),
    }
  } catch {
    // Decayed, or SGP4 cannot propagate it to this instant.
    return { ok: false, refusal: 'noElements' }
  }
  if (!(satellite.geometry.eccentricity < 1) || !Number.isFinite(satellite.geometry.semiMajorAxisKm)) return { ok: false, refusal: 'noElements' }
  return checked(satellite)
}

export type RouteRealPairId = 'hubbleToIss' | 'issToTiangong'

/** A pair of real satellites from the catalogue, showing one lesson. Their routes
 *  change with the catalogue's elements and the instant. */
export interface RouteRealPair {
  readonly id: RouteRealPairId
  readonly ownCatalogId: string
  readonly targetCatalogId: string
}

/** The ids are the featured picks' (ISS, Tiangong, Hubble); a test holds them equal. */
export const ROUTE_REAL_PAIRS: readonly RouteRealPair[] = [
  { id: 'hubbleToIss', ownCatalogId: '20580', targetCatalogId: '25544' },
  { id: 'issToTiangong', ownCatalogId: '25544', targetCatalogId: '48274' },
]

export function routeRealPair(id: RouteRealPairId): RouteRealPair {
  const pair = ROUTE_REAL_PAIRS.find((candidate) => candidate.id === id)
  if (pair === undefined) throw new Error(`Unknown real pair: ${id}`)
  return pair
}

/** A Try these card: a built-in example, or a real pair. */
export type RouteTryId = RouteExampleId | RouteRealPairId

export const ROUTE_TRY_THESE: readonly RouteTryId[] = ['lowAndMedium', 'altitude', 'oneShell', 'driftPlanes', 'waitForPlanes', 'hubbleToIss', 'issToTiangong', 'lowToGeo', 'retrograde']

export function isRealPairId(id: RouteTryId): id is RouteRealPairId {
  return ROUTE_REAL_PAIRS.some((pair) => pair.id === id)
}
