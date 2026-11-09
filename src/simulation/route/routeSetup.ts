import { degToRad } from '../../core/angles.ts'
import { EARTH_RADIUS_KM, MAX_SIMULATION_INSTANT } from '../../core/constants.ts'
import { secondsBetween, type SimulationInstant } from '../../core/time.ts'
import type { RouteRequest } from './routeFamilies.ts'
import type { RouteSatellite } from './routeModel.ts'

const HOUR = 3600
const DAY = 86_400

/** Every search looks this far ahead, and the time limit goes up to it. */
export const ROUTE_MAX_HORIZON_SECONDS = 365 * DAY
export const ROUTE_MIN_LIMIT_SECONDS = HOUR
/** The limits' values when first turned on. */
export const ROUTE_DEFAULT_LIMIT_SECONDS = 7 * DAY
export const ROUTE_MIN_BUDGET_KM_S = 0.01
export const ROUTE_MAX_BUDGET_KM_S = 20
/** The upper end of the Interception game's tank. */
export const ROUTE_DEFAULT_BUDGET_KM_S = 1
/** A chemical engine. It only decides the propellant share, never the route. */
export const ROUTE_DEFAULT_ISP_SECONDS = 300
/** An electric engine, the other preset. */
export const ROUTE_ELECTRIC_ISP_SECONDS = 1500
export const ROUTE_MIN_ISP_SECONDS = 200
export const ROUTE_MAX_ISP_SECONDS = 4000

export type RouteExampleId = 'lowAndMedium' | 'altitude' | 'waitForPlanes' | 'oneShell' | 'driftPlanes' | 'lowToGeo' | 'retrograde'
/** The pair the mode opens on: a low and a medium orbit in one plane. */
export const ROUTE_DEFAULT_EXAMPLE: RouteExampleId = 'lowAndMedium'

interface ExampleOrbit {
  readonly altitudeKm: number
  readonly inclinationDeg: number
  readonly raanDeg: number
  readonly anomalyDeg: number
}

/** A pair of orbits showing one lesson, in round numbers. These need no catalogue,
 *  so the mode has something to show without a network. */
export interface RouteExample {
  readonly id: RouteExampleId
  readonly own: ExampleOrbit
  readonly target: ExampleOrbit
}

export const ROUTE_EXAMPLES: readonly RouteExample[] = [
  // Navigation satellites fly at about 20 200 km.
  { id: 'lowAndMedium', own: { altitudeKm: 550, inclinationDeg: 55, raanDeg: 0, anomalyDeg: 0 }, target: { altitudeKm: 20_200, inclinationDeg: 55, raanDeg: 0, anomalyDeg: 90 } },
  { id: 'altitude', own: { altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 0 }, target: { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 } },
  { id: 'oneShell', own: { altitudeKm: 550, inclinationDeg: 53, raanDeg: 0, anomalyDeg: 0 }, target: { altitudeKm: 550, inclinationDeg: 53, raanDeg: 60, anomalyDeg: 30 } },
  { id: 'driftPlanes', own: { altitudeKm: 550, inclinationDeg: 53, raanDeg: 60, anomalyDeg: 0 }, target: { altitudeKm: 550, inclinationDeg: 53, raanDeg: 0, anomalyDeg: 30 } },
  { id: 'waitForPlanes', own: { altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 30, anomalyDeg: 0 }, target: { altitudeKm: 600, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 90 } },
  { id: 'lowToGeo', own: { altitudeKm: 400, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 0 }, target: { altitudeKm: 35_786, inclinationDeg: 0.05, raanDeg: 40, anomalyDeg: 100 } },
  { id: 'retrograde', own: { altitudeKm: 500, inclinationDeg: 51.6, raanDeg: 0, anomalyDeg: 0 }, target: { altitudeKm: 500, inclinationDeg: 128.4, raanDeg: 180, anomalyDeg: 40 } },
]

export function routeExample(id: RouteExampleId): RouteExample {
  const example = ROUTE_EXAMPLES.find((candidate) => candidate.id === id)
  if (example === undefined) throw new Error(`Unknown route example: ${id}`)
  return example
}

function exampleSatellite(name: string, orbit: ExampleOrbit, referenceInstant: SimulationInstant): RouteSatellite {
  return {
    name,
    geometry: {
      semiMajorAxisKm: EARTH_RADIUS_KM + orbit.altitudeKm,
      eccentricity: 0,
      inclinationRad: degToRad(orbit.inclinationDeg),
      raanRad: degToRad(orbit.raanDeg),
      argOfPeriapsisRad: 0,
    },
    phase: { referenceInstant, meanAnomalyAtReferenceRad: degToRad(orbit.anomalyDeg) },
  }
}

/** An example's two satellites, placed as it describes at the start instant, so
 *  that an example gives the same route whenever it is planned. Their names are
 *  identifiers: the interface words them from the example. */
export function exampleSatellites(example: RouteExample, startInstant: SimulationInstant): { readonly own: RouteSatellite; readonly target: RouteSatellite } {
  return {
    own: exampleSatellite(`${example.id}-own`, example.own, startInstant),
    target: exampleSatellite(`${example.id}-target`, example.target, startInstant),
  }
}

export interface PlannedRequest {
  readonly request: RouteRequest
  /** Set when the clock's end shortens the search: how long it may then look. */
  readonly limitedToSeconds: number | null
}

/** What to search for from a start instant: a year ahead, within the clock's range. */
export function plannedRequest(own: RouteSatellite, target: RouteSatellite, startInstant: SimulationInstant): PlannedRequest {
  const wanted = ROUTE_MAX_HORIZON_SECONDS
  const room = secondsBetween(MAX_SIMULATION_INSTANT, startInstant)
  return { request: { own, target, startInstant, horizonSeconds: Math.min(wanted, room) }, limitedToSeconds: room < wanted ? room : null }
}
