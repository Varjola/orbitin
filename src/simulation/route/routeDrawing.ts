import type { ProjectInertialVec3 } from '../../core/referenceFrames.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../../core/time.ts'
import { EARTH_RADIUS_KM } from '../../core/constants.ts'
import { addVec3, crossVec3, dotVec3, lengthVec3, normalizeVec3, scaleVec3, type Vec3 } from '../../core/vec3.ts'
import { secondsAtTau, type RouteTimeline } from './routeTimeline.ts'
import { burnFrame } from '../../orbital/burnFrame.ts'
import { meanMotion, type OrbitGeometry } from '../../orbital/geometry.ts'
import { j2SecularElementsAt } from '../../orbital/j2Secular.ts'
import { stateVectorEci } from '../../orbital/keplerian.ts'
import type { Route, RouteBurn, RouteLeg, RouteSatellite } from './routeModel.ts'
import { satelliteState, stateOnRoute, targetStateOnRoute } from './routeState.ts'

const RING_POINTS = 192
/** A trail covers this share of an orbit behind the satellite. */
const TRAIL_SHARE_OF_ORBIT = 0.3
const TRAIL_POINTS = 48

/** A satellite's whole orbit at an instant, its plane and apsides turned by J2. */
export function orbitRing(satellite: RouteSatellite, instant: SimulationInstant): ProjectInertialVec3[] {
  const { geometry } = j2SecularElementsAt(satellite.geometry, satellite.phase, instant)
  const points: ProjectInertialVec3[] = []
  for (let index = 0; index <= RING_POINTS; index += 1) points.push(stateVectorEci(geometry, (2 * Math.PI * index) / RING_POINTS).positionProjectInertialKm)
  return points
}

/** The leg the satellite is on `seconds` into a route, or null from arrival on. */
export function legAt(route: Route, seconds: number): RouteLeg | null {
  if (seconds >= route.arrivalSeconds) return null
  return route.legs.find((leg) => seconds < leg.toSeconds) ?? null
}

/** The orbit a leg is on at an instant: drifted by J2 while waiting, turned with its
 *  frame on a transfer. */
export function legOrbit(leg: RouteLeg, instant: SimulationInstant): OrbitGeometry {
  switch (leg.kind) {
    case 'wait':
    case 'drift': return j2SecularElementsAt(leg.geometry, leg.phase, instant).geometry
    case 'transfer': return { ...leg.geometry, raanRad: leg.geometry.raanRad + leg.nodeRateRadPerSecond * secondsBetween(instant, leg.phase.referenceInstant) }
  }
}

/** The orbit your satellite is on `seconds` into a route; from arrival on, the target's. */
export function currentOrbit(route: Route, seconds: number): OrbitGeometry {
  const instant = routeInstant(route, seconds)
  const leg = legAt(route, seconds)
  return leg === null ? j2SecularElementsAt(route.target.geometry, route.target.phase, instant).geometry : legOrbit(leg, instant)
}

/** A whole orbit as points. */
export function ringOf(geometry: OrbitGeometry): ProjectInertialVec3[] {
  const points: ProjectInertialVec3[] = []
  for (let index = 0; index <= RING_POINTS; index += 1) points.push(stateVectorEci(geometry, (2 * Math.PI * index) / RING_POINTS).positionProjectInertialKm)
  return points
}

export function normalOf(geometry: OrbitGeometry): ProjectInertialVec3 {
  const state = stateVectorEci(geometry, 0)
  return normalizeVec3(crossVec3(state.positionProjectInertialKm, state.velocityProjectInertialKmPerSecond))
}

/** At rates where an orbit passes in under this long on screen, a dot only strobes. */
export const ORBIT_SCREEN_SECONDS = 1
/** Once shown, the drift view stays until the rate falls this far below where it began,
 *  so it does not flicker on the edge. */
const DRIFT_VIEW_HYSTERESIS = 0.7

/** Whether playback runs so fast that the satellites' orbits, not their dots, should
 *  be drawn, with Earth's rotation held. `rate` is simulated seconds per second on
 *  screen, 0 while paused or holding a burn. */
export function driftViewShown(route: Route, seconds: number, rate: number, shownBefore: boolean): boolean {
  return orbitPassesWithin(route, seconds, rate, ORBIT_SCREEN_SECONDS, shownBefore)
}

/** Following your satellite, an orbit that passes in under this long on screen
 *  swings the view round too fast to watch. */
export const FOLLOW_ORBIT_SCREEN_SECONDS = 8

/** Whether playback runs too fast to follow your satellite: the follow view then
 *  gives way to the face-on one until it slows down again. */
export function followTooFast(route: Route, seconds: number, rate: number, shownBefore: boolean): boolean {
  return orbitPassesWithin(route, seconds, rate, FOLLOW_ORBIT_SCREEN_SECONDS, shownBefore)
}

function orbitPassesWithin(route: Route, seconds: number, rate: number, screenSeconds: number, shownBefore: boolean): boolean {
  if (!(rate > 0)) return false
  const period = 2 * Math.PI / meanMotion(currentOrbit(route, seconds))
  return rate * screenSeconds > period * (shownBefore ? DRIFT_VIEW_HYSTERESIS : 1)
}

/** The unit normal of a satellite's orbit plane at an instant. */
export function orbitNormal(satellite: RouteSatellite, instant: SimulationInstant): ProjectInertialVec3 {
  const state = stateVectorEci(j2SecularElementsAt(satellite.geometry, satellite.phase, instant).geometry, 0)
  return normalizeVec3(crossVec3(state.positionProjectInertialKm, state.velocityProjectInertialKmPerSecond))
}

/** Your satellite's tail in playback covers this share of the orbit it is on. */
export const TAIL_SHARE_OF_ORBIT = 0.1

/** The path just flown, oldest first, ending where the satellite is: for your
 *  satellite a short tail of the orbit it is on now. */
export function recentPath(route: Route, seconds: number, which: 'own' | 'target'): ProjectInertialVec3[] {
  const period = 2 * Math.PI / meanMotion(which === 'own' ? currentOrbit(route, seconds) : route.target.geometry)
  const span = Math.min(seconds, (which === 'own' ? TAIL_SHARE_OF_ORBIT : TRAIL_SHARE_OF_ORBIT) * period)
  const points: ProjectInertialVec3[] = []
  if (span <= 0) return points
  for (let index = 0; index <= TRAIL_POINTS; index += 1) {
    const at = seconds - span + (span * index) / TRAIL_POINTS
    points.push((which === 'own' ? stateOnRoute(route, at) : targetStateOnRoute(route, at)).positionProjectInertialKm)
  }
  return points
}

/** The path a satellite on its own orbit has just flown, oldest first. */
export function satelliteTrail(satellite: RouteSatellite, instant: SimulationInstant): ProjectInertialVec3[] {
  const span = TRAIL_SHARE_OF_ORBIT * 2 * Math.PI / meanMotion(satellite.geometry)
  const points: ProjectInertialVec3[] = []
  for (let index = 0; index <= TRAIL_POINTS; index += 1) points.push(satelliteState(satellite, addSeconds(instant, -span + (span * index) / TRAIL_POINTS)).positionProjectInertialKm)
  return points
}

/** Two orbit planes' line of nodes at an instant, or null when the planes are one. */
export function lineOfNodes(pair: Pick<Route, 'own' | 'target'>, instant: SimulationInstant): ProjectInertialVec3 | null {
  const direction = crossVec3(orbitNormal(pair.own, instant), orbitNormal(pair.target, instant))
  return lengthVec3(direction) < 1e-6 ? null : normalizeVec3(direction)
}

/** The view tilts this far from straight above the two planes, towards their
 *  line of nodes, so the rings stay open and the angle between them shows. */
const VIEW_TILT_RAD = (40 * Math.PI) / 180

/** Where to look at two orbits from: above their planes, tilted towards where they
 *  cross. */
export function routeViewDirection(route: Pick<Route, 'own' | 'target'>, instant: SimulationInstant): ProjectInertialVec3 {
  const own = orbitNormal(route.own, instant)
  const sum = addVec3(own, orbitNormal(route.target, instant))
  // Opposite planes have no plane between them: look down on your satellite's.
  const above = lengthVec3(sum) < 1e-6 ? own : normalizeVec3(sum)
  const node = lineOfNodes(route, instant)
  if (node === null) return above
  return normalizeVec3(addVec3(scaleVec3(above, Math.cos(VIEW_TILT_RAD)), scaleVec3(node, Math.sin(VIEW_TILT_RAD))))
}

/** How a route goes, sampled evenly in playback time so it lines up with the
 *  timeline: your height above the surface, and the angle between your plane and
 *  the target's. */
export interface RouteProfile {
  readonly altitudeKm: readonly number[]
  readonly planeAngleRad: readonly number[]
  readonly lowestKm: number
  readonly highestKm: number
  readonly widestRad: number
}

export const ROUTE_PROFILE_SAMPLES = 160

export function routeProfile(route: Route, timeline: RouteTimeline, samples = ROUTE_PROFILE_SAMPLES): RouteProfile {
  const altitudeKm: number[] = []
  const planeAngleRad: number[] = []
  for (let index = 0; index <= samples; index += 1) {
    const seconds = Math.min(route.arrivalSeconds, secondsAtTau(timeline, (timeline.durationTau * index) / samples))
    altitudeKm.push(lengthVec3(stateOnRoute(route, seconds).positionProjectInertialKm) - EARTH_RADIUS_KM)
    const cosine = dotVec3(normalOf(currentOrbit(route, seconds)), orbitNormal(route.target, routeInstant(route, seconds)))
    planeAngleRad.push(Math.acos(Math.min(1, Math.max(-1, cosine))))
  }
  return { altitudeKm, planeAngleRad, lowestKm: Math.min(...altitudeKm), highestKm: Math.max(...altitudeKm), widestRad: Math.max(...planeAngleRad) }
}

/** How the camera looks at the two orbits: left to the learner, face-on to your
 *  orbit's plane, along the line where the two planes cross, or following your
 *  satellite. Every view but the free one looks at Earth's centre. */
export type RouteCameraView = 'free' | 'faceOn' | 'edgeOn' | 'follow'
export const ROUTE_CAMERA_VIEWS: readonly RouteCameraView[] = ['free', 'faceOn', 'edgeOn', 'follow']

/** What a camera view looks at: the two planes, and where you are. */
export interface RouteCameraScene {
  readonly ownNormal: ProjectInertialVec3
  readonly targetNormal: ProjectInertialVec3
  readonly own: { readonly positionProjectInertialKm: ProjectInertialVec3; readonly velocityProjectInertialKmPerSecond: ProjectInertialVec3 }
}

/** Seen exactly along the line of nodes both rings are lines; a little above it
 *  they stay thin ellipses whose angle still reads. */
const EDGE_ON_TILT_RAD = (8 * Math.PI) / 180
const AXIS: Vec3 = { x: 0, y: 0, z: 1 }

/** The direction from Earth's centre the camera looks from, or null for the free view. */
export function cameraDirection(view: RouteCameraView, scene: RouteCameraScene): ProjectInertialVec3 | null {
  switch (view) {
    case 'free': return null
    case 'faceOn': return scene.ownNormal
    case 'edgeOn': {
      const crossing = crossVec3(scene.ownNormal, scene.targetNormal)
      // One plane: look along it from where it crosses the equator, or along any line in it.
      const equatorial = crossVec3(AXIS, scene.ownNormal)
      const node = lengthVec3(crossing) >= 1e-6 ? normalizeVec3(crossing) : lengthVec3(equatorial) >= 1e-6 ? normalizeVec3(equatorial) : { x: 1, y: 0, z: 0 }
      const sum = addVec3(scene.ownNormal, scene.targetNormal)
      const above = lengthVec3(sum) < 1e-6 ? scene.ownNormal : normalizeVec3(sum)
      return normalizeVec3(addVec3(scaleVec3(node, Math.cos(EDGE_ON_TILT_RAD)), scaleVec3(above, Math.sin(EDGE_ON_TILT_RAD))))
    }
    case 'follow': return aboveAndBehind(scene.own, scene.ownNormal, 0.5, 0.35)
  }
}

/** Over the satellite, raised above its plane and drawn back along its path, so it
 *  and the way ahead are in view. */
function aboveAndBehind(state: RouteCameraScene['own'], normal: ProjectInertialVec3, above: number, behind: number): ProjectInertialVec3 {
  const out = normalizeVec3(state.positionProjectInertialKm)
  const along = normalizeVec3(state.velocityProjectInertialKmPerSecond)
  return normalizeVec3(addVec3(addVec3(out, scaleVec3(normal, above)), scaleVec3(along, -behind)))
}

/** Where to look at a burn from: well above its plane, so the velocity before and
 *  after and the turn between them are seen nearly true. */
export function burnViewDirection(burn: RouteBurn): ProjectInertialVec3 {
  const { positionProjectInertialKm: position, velocityProjectInertialKmPerSecond: velocity } = burn.before
  return aboveAndBehind(burn.before, normalizeVec3(crossVec3(position, velocity)), 1.6, 0.3)
}

/** How far a burn's drawing has come in its hold: the thrust arrow grows, then
 *  the velocity turns from before to after, then both hold still to be read. */
export interface BurnStage {
  readonly grown: number
  readonly turned: number
}

const GROW_UNTIL = 0.3
const TURN_UNTIL = 0.75

function eased(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export function burnStage(progress: number): BurnStage {
  return { grown: eased(progress / GROW_UNTIL), turned: eased((progress - GROW_UNTIL) / (TURN_UNTIL - GROW_UNTIL)) }
}

/** A burn's vectors in km/s, from the satellite. The parts follow the burn's own
 *  frame at the state before it, so they add up to the burn. */
export interface BurnVectors {
  readonly position: ProjectInertialVec3
  readonly deltaV: Vec3
  readonly parts: { readonly prograde: Vec3; readonly normal: Vec3; readonly outward: Vec3 }
  readonly before: Vec3
  /** The velocity as far as it has turned: from before to after along the burn. */
  readonly current: Vec3
  readonly after: Vec3
  /** Unit, in the plane before the burn, square to the velocity and away from Earth. */
  readonly side: Vec3
}

/** Under this angle between the velocity before and after a burn, the triangle
 *  before + Δv = after is too thin to read: at the drawn size its far corners lie
 *  closer than an arrow head is wide. */
export const THIN_TRIANGLE_RAD = (4 * Math.PI) / 180

/** True when a burn hardly turns the velocity, as in a climb within one plane: the
 *  velocity is then drawn beside the thrust arrow instead of as a triangle. */
export function triangleIsThin(vectors: Pick<BurnVectors, 'before' | 'after'>): boolean {
  const { before, after } = vectors
  return Math.atan2(lengthVec3(crossVec3(before, after)), dotVec3(before, after)) < THIN_TRIANGLE_RAD
}

export function burnVectors(burn: RouteBurn, stage: BurnStage): BurnVectors {
  const frame = burnFrame(burn.before)
  const { components } = burn
  const before = burn.before.velocityProjectInertialKmPerSecond
  return {
    position: burn.before.positionProjectInertialKm,
    deltaV: burn.deltaVKmPerSecond,
    parts: {
      prograde: scaleVec3(frame.prograde, components.progradeKmPerSecond),
      normal: scaleVec3(frame.normal, components.normalKmPerSecond),
      outward: scaleVec3(frame.outward, components.outwardKmPerSecond),
    },
    before,
    current: addVec3(before, scaleVec3(burn.deltaVKmPerSecond, stage.turned)),
    after: burn.after.velocityProjectInertialKmPerSecond,
    side: frame.outward,
  }
}

/** The instant `seconds` into a route. */
export function routeInstant(route: Route, seconds: number): SimulationInstant {
  return addSeconds(route.startInstant, seconds)
}
