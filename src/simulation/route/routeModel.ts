import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM, MIN_PERIAPSIS_RADIUS_KM } from '../../core/constants.ts'
import type { ProjectInertialVec3 } from '../../core/referenceFrames.ts'
import type { SimulationInstant } from '../../core/time.ts'
import type { BurnComponents } from '../../orbital/burnFrame.ts'
import type { OrbitGeometry } from '../../orbital/geometry.ts'
import type { OrbitPhase } from '../../orbital/keplerianPropagator.ts'
import type { OrbitalState } from '../../orbital/propagator.ts'

/** Every leg of a route keeps its perigee at or above this: Orbitin's floor. */
export const ROUTE_MIN_PERIGEE_RADIUS_KM = MIN_PERIAPSIS_RADIUS_KM
/** Two-body motion stops being honest near the Moon. Wider than the limit on
 *  authored orbits, because going far out is itself a route. */
export const ROUTE_MAX_APOGEE_RADIUS_KM = EARTH_RADIUS_KM + 100_000
/** A transfer that starts on an orbit exactly at a limit stays within it. */
const LIMIT_TOLERANCE_KM = 1e-3

/** A satellite as the route model sees it: mean elements, which drift under
 *  secular J2 for as long as it stays on them. */
export interface RouteSatellite {
  readonly name: string
  readonly geometry: OrbitGeometry
  readonly phase: OrbitPhase
}

export type RouteFamily = 'direct' | 'turnAtNode' | 'goHigh' | 'drift'
/** What a burn is for: leaving, turning where the planes cross, climbing far out,
 *  turning there, moving to an orbit to drift on and settling on it, heading for the
 *  target from where those left the satellite, and matching the target. */
export type BurnPurpose = 'depart' | 'turn' | 'climb' | 'turnHigh' | 'toDrift' | 'drift' | 'approach' | 'arrive'

interface RouteLegBase {
  readonly fromSeconds: number
  readonly toSeconds: number
  readonly geometry: OrbitGeometry
  readonly phase: OrbitPhase
}

/** Stays on the orbit the satellite is on, drifting under secular J2. */
export interface RouteWaitLeg extends RouteLegBase {
  readonly kind: 'wait'
}

/** A conic between burns, in a frame that turns about the Earth's axis at this
 *  rate. J2 turns the arc's plane as well as the planes it joins: left fixed in
 *  space, a long arc would get part of a plane change for nothing, and pay for one
 *  between two planes that stay together. */
export interface RouteTransferLeg extends RouteLegBase {
  readonly kind: 'transfer'
  readonly nodeRateRadPerSecond: number
}

/** Parked on an orbit of another height, for J2 to turn its plane at another rate
 *  until it lines up with the target's. Moves as a wait does. */
export interface RouteDriftLeg extends RouteLegBase {
  readonly kind: 'drift'
}

export type RouteLeg = RouteWaitLeg | RouteTransferLeg | RouteDriftLeg

export interface RouteBurn {
  readonly atSeconds: number
  readonly purpose: BurnPurpose
  readonly deltaVKmPerSecond: ProjectInertialVec3
  readonly components: BurnComponents
  readonly sizeKmPerSecond: number
  readonly before: OrbitalState
  readonly after: OrbitalState
}

/** A complete plan from the start instant until matched with the target. Times
 *  count in seconds from `startInstant`. Plain data, so it can leave a Worker. */
export interface Route {
  readonly family: RouteFamily
  readonly startInstant: SimulationInstant
  readonly own: RouteSatellite
  readonly target: RouteSatellite
  readonly legs: readonly RouteLeg[]
  readonly burns: readonly RouteBurn[]
  readonly totalDeltaVKmPerSecond: number
  readonly arrivalSeconds: number
}

/** Routes of which none is both cheaper and sooner than another, soonest first. */
export interface RouteFront {
  readonly routes: readonly Route[]
  /** False while the search is still working on it. */
  readonly complete: boolean
}

/** Whether the whole conic through a state keeps within the route limits, even
 *  on the parts of it a short arc does not fly. Unbound conics do not. */
export function conicWithinRouteLimits(position: ProjectInertialVec3, velocity: ProjectInertialVec3): boolean {
  const radius = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z)
  const energy = (velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z) / 2 - EARTH_MU_KM3_S2 / radius
  if (!(energy < 0)) return false
  const semiMajorAxis = -EARTH_MU_KM3_S2 / (2 * energy)
  const hx = position.y * velocity.z - position.z * velocity.y
  const hy = position.z * velocity.x - position.x * velocity.z
  const hz = position.x * velocity.y - position.y * velocity.x
  const eccentricity = Math.sqrt(Math.max(0, 1 - (hx * hx + hy * hy + hz * hz) / (EARTH_MU_KM3_S2 * semiMajorAxis)))
  return semiMajorAxis * (1 - eccentricity) >= ROUTE_MIN_PERIGEE_RADIUS_KM - LIMIT_TOLERANCE_KM
    && semiMajorAxis * (1 + eccentricity) <= ROUTE_MAX_APOGEE_RADIUS_KM + LIMIT_TOLERANCE_KM
}
