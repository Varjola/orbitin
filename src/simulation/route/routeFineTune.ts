import { addSeconds } from '../../core/time.ts'
import { meanMotion } from '../../orbital/geometry.ts'
import { bestArc, makeBurn, MIN_FLIGHT_SECONDS, refineArc, routeOf, solveArcAgain, type BestArc } from './routeFamilies.ts'
import type { Route, RouteLeg } from './routeModel.ts'
import { legState, satelliteState } from './routeState.ts'

/** The pattern search starts this coarse, or at an eighth of the flight if shorter. */
const START_STEP_SECONDS = 300
/** A saving below this is not one worth showing: about a tenth of a metre per second. */
export const FINE_TUNE_MIN_SAVING_KM_PER_SECOND = 1e-4

/** One route of the front, fine-tuned: the final arc's departure and flight time
 *  searched locally down to the second, with everything before it kept. The
 *  satellite may leave earlier or later along the coast it is on, and arrive no
 *  later than the route did: arriving later is another route of the front, not
 *  this one tuned. Null when that saves nothing worth naming.
 *
 *  The search found this route on a grid and refined it within a stretch of
 *  arrival times; a chosen route can afford a closer look of its own. */
export function fineTunedRoute(route: Route): Route | null {
  const finalLeg = route.legs.at(-1)
  const departureBurn = route.burns.at(-2)
  const arrivalBurn = route.burns.at(-1)
  if (finalLeg?.kind !== 'transfer' || departureBurn === undefined || arrivalBurn === undefined) return null
  const coastLeg = route.legs.length > 1 ? route.legs.at(-2)! : null
  // A route that leaves at once has no coast before it: its own orbit stands in.
  const coast: RouteLeg = coastLeg ?? { kind: 'wait', fromSeconds: 0, toSeconds: departureBurn.atSeconds, geometry: route.own.geometry, phase: route.own.phase }
  const start = route.startInstant
  const from = (seconds: number) => legState(coast, addSeconds(start, seconds))
  const to = (seconds: number) => satelliteState(route.target, addSeconds(start, seconds))
  const nodeRate = finalLeg.nodeRateRadPerSecond
  const flight = arrivalBurn.atSeconds - departureBurn.atSeconds
  const original = departureBurn.sizeKmPerSecond + arrivalBurn.sizeKmPerSecond
  let best: { readonly departure: number; readonly flight: number; readonly arc: BestArc } | null = null
  const step = Math.max(MIN_FLIGHT_SECONDS / 2, Math.min(START_STEP_SECONDS, flight / 8))
  refineArc(
    { departureSeconds: departureBurn.atSeconds, flightSeconds: flight, deltaVKmPerSecond: original, revolutions: Math.floor(flight * meanMotion(finalLeg.geometry) / (2 * Math.PI)) },
    { departureSeconds: step, flightSeconds: step },
    // Not before the burn that started the coast: that would be a different route.
    { earliestDepartureSeconds: coastLeg === null ? 0 : coast.fromSeconds + 1, latestArrivalSeconds: arrivalBurn.atSeconds },
    (departure, flightSeconds, minRevolutions, maxRevolutions) => bestArc(from(departure), to(departure + flightSeconds), flightSeconds, minRevolutions, maxRevolutions, nodeRate),
    (departure, flightSeconds, arc) => { if (arc.deltaVKmPerSecond < (best?.arc.deltaVKmPerSecond ?? original)) best = { departure, flight: flightSeconds, arc } },
  )
  const found = best as { readonly departure: number; readonly flight: number; readonly arc: BestArc } | null
  if (found === null || original - found.arc.deltaVKmPerSecond < FINE_TUNE_MIN_SAVING_KM_PER_SECOND) return null
  const departed = from(found.departure)
  const arrival = found.departure + found.flight
  const target = to(arrival)
  const solved = solveArcAgain(start, departed, target, { departureSeconds: found.departure, flightSeconds: found.flight, way: found.arc.way, revolutions: found.arc.revolutions, branch: found.arc.branch }, nodeRate)
  const legs = [
    ...route.legs.slice(0, coastLeg === null ? -1 : -2),
    ...(found.departure > coast.fromSeconds ? [{ ...coast, toSeconds: found.departure }] : []),
    solved.leg,
  ]
  const burns = [
    ...route.burns.slice(0, -2),
    makeBurn(found.departure, departureBurn.purpose, departed, solved.departed),
    makeBurn(arrival, 'arrive', solved.arriving, target),
  ]
  return routeOf(route.family, { own: route.own, target: route.target, startInstant: start, horizonSeconds: arrivalBurn.atSeconds }, legs, burns)
}
