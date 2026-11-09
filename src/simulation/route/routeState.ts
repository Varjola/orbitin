import { addSeconds, secondsBetween, type SimulationInstant } from '../../core/time.ts'
import { J2SecularPropagator } from '../../orbital/j2SecularPropagator.ts'
import { KeplerianPropagator } from '../../orbital/keplerianPropagator.ts'
import type { OrbitalState } from '../../orbital/propagator.ts'
import type { Route, RouteLeg, RouteSatellite } from './routeModel.ts'

export function legState(leg: RouteLeg, instant: SimulationInstant): OrbitalState {
  switch (leg.kind) {
    case 'wait':
    case 'drift': return new J2SecularPropagator(leg.geometry, leg.phase).stateAt(instant)
    case 'transfer': {
      const raanRad = leg.geometry.raanRad + leg.nodeRateRadPerSecond * secondsBetween(instant, leg.phase.referenceInstant)
      return new KeplerianPropagator({ ...leg.geometry, raanRad }, leg.phase).stateAt(instant)
    }
  }
}

export function satelliteState(satellite: RouteSatellite, instant: SimulationInstant): OrbitalState {
  return new J2SecularPropagator(satellite.geometry, satellite.phase).stateAt(instant)
}

/** Where the satellite is, `seconds` after the route's start: the one lookup
 *  behind playback, the arrows and the tests. Time is limited to the route. At
 *  the instant of a burn this is the state after it, and from arrival on the
 *  satellite is the target. */
export function stateOnRoute(route: Route, seconds: number): OrbitalState {
  const instant = addSeconds(route.startInstant, Math.max(0, seconds))
  if (seconds >= route.arrivalSeconds) return targetStateOnRoute(route, route.arrivalSeconds)
  const leg = route.legs.find((candidate) => seconds < candidate.toSeconds)
  if (leg === undefined) throw new Error('A route before its arrival must be on a leg')
  return legState(leg, instant)
}

export function targetStateOnRoute(route: Route, seconds: number): OrbitalState {
  return satelliteState(route.target, addSeconds(route.startInstant, seconds))
}
