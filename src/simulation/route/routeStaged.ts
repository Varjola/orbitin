import { TAU } from '../../core/angles.ts'
import { EARTH_MU_KM3_S2 } from '../../core/constants.ts'
import { addSeconds } from '../../core/time.ts'
import { addVec3, crossVec3, dotVec3, lengthVec3, normalizeVec3, scaleVec3, subtractVec3, type Vec3 } from '../../core/vec3.ts'
import { elementsFromState } from '../../orbital/elementsFromState.ts'
import { deriveOrbitValues, type OrbitGeometry } from '../../orbital/geometry.ts'
import { j2SecularElementsAt, j2SecularRates } from '../../orbital/j2Secular.ts'
import { phaseFromTrueAnomaly } from '../../orbital/keplerianPropagator.ts'
import type { OrbitalState } from '../../orbital/propagator.ts'
import {
  bestArc, coastLeg, makeBurn, MIN_FLIGHT_SECONDS, nodeAlignmentSeconds, refineArc, routeOf, SEED_WORTHWHILE_RATIO, SeedBuckets, seedBucketEnd, solveArcAgain, spanningNodeRate, turnedAboutAxis,
  type ArcIdentity, type ArcSeed, type BestArc, type CandidateSink, type RouteRequest,
} from './routeFamilies.ts'
import type { FrontPoint } from './routeFront.ts'
import { conicWithinRouteLimits, ROUTE_MAX_APOGEE_RADIUS_KM, ROUTE_MIN_PERIGEE_RADIUS_KM, type Route, type RouteBurn, type RouteDriftLeg, type RouteLeg, type RouteSatellite, type RouteTransferLeg } from './routeModel.ts'
import { legState, satelliteState } from './routeState.ts'

/** Below this angle between the planes there is no node worth turning at, and
 *  Direct has the route. */
const MIN_PLANE_ANGLE_RAD = (0.1 * Math.PI) / 180
/** Where the orbits differ in height, how much of the turn the first burn makes:
 *  the rest is made where the climb or descent ends, at the other node. Some is
 *  best made low, most of it where the satellite is slow. */
const TURN_SPLITS = [0, 0.15, 0.4, 0.7] as const
/** Orbits whose radii differ less than this share have no climb to split a turn with. */
const SAME_HEIGHT_SHARE = 0.01
const NODE_CROSSINGS = 4
/** A climb's own timing comes round every orbit, so only the first two nodes. */
const SPLIT_CROSSINGS = 2
const HIGH_CROSSINGS = 2
/** Going high: apoapses as shares of the route's limit, highest last. */
const HIGH_APOAPSIS_SHARES = [0.25, 0.4, 0.6, 1] as const
/** Far out means at least this many times the larger orbit's radius. */
const HIGH_MIN_RADIUS_RATIO = 1.5
/** Going high is searched when its rough cost is within this of turning low. */
const HIGH_ESTIMATE_MARGIN = 1.1
const CROSSING_SAMPLES_PER_ORBIT = 36
const CROSSING_BISECTIONS = 40
/** The final arc leaves at least this long after the burn before it. */
const AFTER_BURN_SECONDS = 60
const ARC_DEPARTURES_PER_ORBIT = 16
const ARC_FLIGHTS_PER_ORBIT = 16
const MAX_ARC_DEPARTURES = 48
const MAX_ARC_FLIGHTS = 64
const ARC_FLIGHT_ORBITS = 3
const ARC_REVOLUTIONS = 2
const DEPARTURE_WINDOW_ORBITS = 2
/** As in Direct: long flights of many revolutions put the phase right, between
 *  orbits of nearly one period. */
const PHASING_MAX_PERIOD_RATIO = 1.2
const PHASING_MIN_ORBITS = 3
const PHASING_MAX_ORBITS = 240
const PHASING_ORBIT_GROWTH = 1.08
const PHASING_ARRIVAL_POINTS = 4
const PHASING_DEPARTURES = 6
/** Each stage refines at most this many of its seeds, those nearest the front. */
const MAX_REFINED_SEEDS = 10
const DAY = 86_400
/** Natural drift: how long to drift, as days and as shares of the time limit. Each
 *  gives the height whose node rate closes the gap in that time, either way round. */
const DRIFT_DAYS = [10, 30, 60, 120, 240] as const
const DRIFT_SHARES = [0.5, 0.85] as const
/** Shorter than this, waiting for the planes is Direct's to find. */
const MIN_DRIFT_SECONDS = 5 * DAY
/** A drift orbit at most this far above the larger of the two orbits. */
const MAX_DRIFT_RISE_KM = 3000
/** Drift orbits closer than this are one. */
const SAME_DRIFT_KM = 5
const DRIFT_RADIUS_BISECTIONS = 60
/** The final arc leaves within this many periods of the two orbits' phases coming
 *  round of the planes lining up, at most this long either side. */
const DRIFT_WINDOW_SYNODIC = 1.5
const MAX_DRIFT_SYNODIC_SECONDS = 3 * DAY

export type StagedFamily = 'turnAtNode' | 'goHigh' | 'drift'

/** What identifies the burns before a staged route's final arc. */
export type StageKey =
  | {
    readonly family: 'turnAtNode'
    readonly firstBurnSeconds: number
    /** The share of the turn made at the node while also changing height, or null
     *  for a turn alone. */
    readonly split: number | null
  }
  | { readonly family: 'goHigh'; readonly firstBurnSeconds: number; readonly apoapsisRadiusKm: number }
  | { readonly family: 'drift'; readonly firstBurnSeconds: number; readonly driftRadiusKm: number }

export interface StagedCandidate extends FrontPoint, ArcIdentity {
  readonly family: StagedFamily
  readonly stage: StageKey
}

/** The burns before the final arc, and the orbit they leave the satellite on. */
interface Stage {
  readonly key: StageKey
  readonly legs: readonly RouteLeg[]
  readonly burns: readonly RouteBurn[]
  readonly deltaVKmPerSecond: number
  /** The orbit after the last burn, open-ended. */
  readonly coast: RouteTransferLeg | RouteDriftLeg
  readonly coastPeriodSeconds: number
  /** When the final arc may leave. */
  readonly windowFromSeconds: number
  readonly windowToSeconds: number
  /** Where the final arc would naturally leave from. */
  readonly anchorSeconds: number
  /** The final arc's frame turns at this rate. */
  readonly arcNodeRateRadPerSecond: number
  /** The period of a circle where the final arc naturally leaves. */
  readonly anchorPeriodSeconds: number
}

export interface StagedProgress {
  readonly fraction: number
}

interface Context {
  readonly request: RouteRequest
  readonly ownAt: (seconds: number) => OrbitalState
  readonly targetAt: (seconds: number) => OrbitalState
  readonly targetGeometry: OrbitGeometry
  readonly targetPeriodSeconds: number
}

function contextOf(request: RouteRequest): Context {
  return {
    request,
    ownAt: (seconds) => satelliteState(request.own, addSeconds(request.startInstant, seconds)),
    targetAt: (seconds) => satelliteState(request.target, addSeconds(request.startInstant, seconds)),
    targetGeometry: request.target.geometry,
    targetPeriodSeconds: deriveOrbitValues(request.target.geometry).periodSeconds,
  }
}

function planeNormal(state: OrbitalState): Vec3 {
  return normalizeVec3(crossVec3(state.positionProjectInertialKm, state.velocityProjectInertialKmPerSecond))
}

function circularPeriod(radiusKm: number): number {
  return TAU * Math.sqrt(radiusKm ** 3 / EARTH_MU_KM3_S2)
}

/** The speed at `radiusKm` of the ellipse whose other apsis is at `otherRadiusKm`. */
function apsisSpeed(radiusKm: number, otherRadiusKm: number): number {
  return Math.sqrt((2 * EARTH_MU_KM3_S2 * otherRadiusKm) / (radiusKm * (radiusKm + otherRadiusKm)))
}

/** How far out an orbit reaches in a direction of its plane. */
function radiusAlong(state: OrbitalState, direction: Vec3): number {
  const r = state.positionProjectInertialKm
  const v = state.velocityProjectInertialKmPerSecond
  const radius = lengthVec3(r)
  const h = crossVec3(r, v)
  const p = dotVec3(h, h) / EARTH_MU_KM3_S2
  const eccentricity = scaleVec3(subtractVec3(scaleVec3(r, dotVec3(v, v) - EARTH_MU_KM3_S2 / radius), scaleVec3(v, dotVec3(r, v))), 1 / EARTH_MU_KM3_S2)
  return p / (1 + dotVec3(eccentricity, normalizeVec3(direction)))
}

/** The velocity's part across the radius, as a unit vector. */
function horizontalDirection(state: OrbitalState): Vec3 {
  const up = normalizeVec3(state.positionProjectInertialKm)
  const v = state.velocityProjectInertialKmPerSecond
  return normalizeVec3(subtractVec3(v, scaleVec3(up, dotVec3(v, up))))
}

/** A direction across the radius `up`, turned towards another by a share of the
 *  angle between them, about `up`. */
function turnedTowards(from: Vec3, to: Vec3, up: Vec3, share: number): Vec3 {
  const angle = Math.atan2(dotVec3(up, crossVec3(from, to)), dotVec3(from, to))
  const turn = share * angle
  return addVec3(scaleVec3(from, Math.cos(turn)), scaleVec3(crossVec3(up, from), Math.sin(turn)))
}

function withVelocity(state: OrbitalState, velocity: Vec3): OrbitalState {
  return { positionProjectInertialKm: state.positionProjectInertialKm, velocityProjectInertialKmPerSecond: velocity }
}

/** The instants in a span at which `side` changes sign, soonest first. */
function signChanges(side: (seconds: number) => number, fromSeconds: number, toSeconds: number, stepSeconds: number, most: number): number[] {
  const found: number[] = []
  let previous = fromSeconds
  let previousValue = side(previous)
  for (let at = fromSeconds + stepSeconds; at <= toSeconds && found.length < most; at += stepSeconds) {
    const value = side(at)
    if (previousValue === 0 || Math.sign(value) !== Math.sign(previousValue)) {
      let low = previous
      let high = at
      let lowValue = previousValue
      for (let step = 0; step < CROSSING_BISECTIONS; step += 1) {
        const middle = (low + high) / 2
        const middleValue = side(middle)
        if (Math.sign(middleValue) === Math.sign(lowValue)) { low = middle; lowValue = middleValue }
        else high = middle
      }
      found.push((low + high) / 2)
    }
    previous = at
    previousValue = value
  }
  return found
}

function nodeRateOf(geometry: OrbitGeometry): number {
  return j2SecularRates(geometry).raanRadPerSecond
}

/** The orbit after a burn, open-ended, flying in a frame that turns with its node. */
function openCoast(after: OrbitalState, request: RouteRequest, fromSeconds: number): { readonly coast: RouteTransferLeg; readonly periodSeconds: number } {
  const geometry = elementsFromState(after).geometry
  return { coast: coastLeg(after, request.startInstant, fromSeconds, Infinity, nodeRateOf(geometry)), periodSeconds: deriveOrbitValues(geometry).periodSeconds }
}

function coastState(coast: RouteLeg, seconds: number, request: RouteRequest): OrbitalState {
  return legState(coast, addSeconds(request.startInstant, seconds))
}

function targetRadii(context: Context): { readonly lowest: number; readonly highest: number } {
  const { semiMajorAxisKm: a, eccentricity: e } = context.targetGeometry
  return { lowest: a * (1 - e), highest: a * (1 + e) }
}

/** The rest of a stage: the window the final arc leaves in, and its frame. */
function finishStage(context: Context, key: StageKey, legs: readonly RouteLeg[], burns: readonly RouteBurn[], coast: RouteTransferLeg | RouteDriftLeg, coastPeriodSeconds: number, windowFrom: number, windowTo: number, anchorSeconds: number): Stage | null {
  const from = Math.max(windowFrom, coast.fromSeconds + AFTER_BURN_SECONDS)
  const to = Math.min(windowTo, context.request.horizonSeconds - MIN_FLIGHT_SECONDS)
  if (!(from < to)) return null
  const anchorRadius = lengthVec3(coastState(coast, anchorSeconds, context.request).positionProjectInertialKm)
  const target = targetRadii(context)
  return {
    key,
    legs,
    burns,
    deltaVKmPerSecond: burns.reduce((sum, burn) => sum + burn.sizeKmPerSecond, 0),
    coast,
    coastPeriodSeconds,
    windowFromSeconds: from,
    windowToSeconds: to,
    anchorSeconds,
    arcNodeRateRadPerSecond: spanningNodeRate(Math.min(anchorRadius, target.lowest), Math.max(anchorRadius, target.highest), context.targetGeometry.inclinationRad),
    anchorPeriodSeconds: circularPeriod(anchorRadius),
  }
}

function waitLegs(context: Context, untilSeconds: number): RouteLeg[] {
  const { own } = context.request
  return untilSeconds > 0 ? [{ kind: 'wait', fromSeconds: 0, toSeconds: untilSeconds, geometry: own.geometry, phase: own.phase }] : []
}

/** Turn at the node: where the satellite crosses the target's plane, turn into it,
 *  alone or with a climb or descent towards the target's height that leaves part
 *  of the turn for its far end. */
function nodeStage(context: Context, key: Extract<StageKey, { family: 'turnAtNode' }>): Stage | null {
  const t1 = key.firstBurnSeconds
  const before = context.ownAt(t1)
  const up = normalizeVec3(before.positionProjectInertialKm)
  const targetNow = context.targetAt(t1)
  const towards = normalizeVec3(crossVec3(planeNormal(targetNow), up))
  const v = before.velocityProjectInertialKmPerSecond
  let after: OrbitalState
  if (key.split === null) {
    const upward = dotVec3(v, up)
    const across = lengthVec3(subtractVec3(v, scaleVec3(up, upward)))
    after = withVelocity(before, addVec3(scaleVec3(up, upward), scaleVec3(towards, across)))
  } else {
    const radius = lengthVec3(before.positionProjectInertialKm)
    const farRadius = radiusAlong(targetNow, scaleVec3(up, -1))
    after = withVelocity(before, scaleVec3(turnedTowards(horizontalDirection(before), towards, up, key.split), apsisSpeed(radius, farRadius)))
  }
  if (!conicWithinRouteLimits(after.positionProjectInertialKm, after.velocityProjectInertialKmPerSecond)) return null
  const { coast, periodSeconds } = openCoast(after, context.request, t1)
  const anchor = key.split === null ? t1 : t1 + periodSeconds / 2
  return finishStage(context, key, waitLegs(context, t1), [makeBurn(t1, 'turn', before, after)], coast, periodSeconds, t1, t1 + DEPARTURE_WINDOW_ORBITS * periodSeconds, anchor)
}

interface HighPlan {
  readonly climbPeriodSeconds: number
  readonly returnPeriodSeconds: number
  readonly returnNodeRateRadPerSecond: number
}

/** The two halves of going high, from a radius to an apoapsis and back down to the
 *  target's height. */
function highPlan(context: Context, radiusKm: number, apoapsisKm: number, returnRadiusKm: number): HighPlan {
  const returnSemiMajorAxis = (apoapsisKm + returnRadiusKm) / 2
  return {
    climbPeriodSeconds: circularPeriod((radiusKm + apoapsisKm) / 2),
    returnPeriodSeconds: circularPeriod(returnSemiMajorAxis),
    returnNodeRateRadPerSecond: spanningNodeRate(returnRadiusKm, apoapsisKm, context.targetGeometry.inclinationRad),
  }
}

/** The plane to turn into far out: the target's plane where the satellite comes
 *  back down, turned back by what the way down turns. */
function returnPlaneNormal(context: Context, plan: HighPlan, farSeconds: number): Vec3 {
  const half = plan.returnPeriodSeconds / 2
  return turnedAboutAxis({ positionProjectInertialKm: planeNormal(context.targetAt(farSeconds + half)), velocityProjectInertialKmPerSecond: { x: 0, y: 0, z: 0 } }, -plan.returnNodeRateRadPerSecond * half).positionProjectInertialKm
}

/** Go high to turn: climb from a node so the far end is at the other node, turn
 *  there where the satellite is slow, and come back down to the target's height. */
function highStage(context: Context, key: Extract<StageKey, { family: 'goHigh' }>): Stage | null {
  const { request } = context
  const t1 = key.firstBurnSeconds
  const before = context.ownAt(t1)
  const radius = lengthVec3(before.positionProjectInertialKm)
  const climbed = withVelocity(before, scaleVec3(horizontalDirection(before), apsisSpeed(radius, key.apoapsisRadiusKm)))
  if (!conicWithinRouteLimits(climbed.positionProjectInertialKm, climbed.velocityProjectInertialKmPerSecond)) return null
  const climb = openCoast(climbed, request, t1)
  const t2 = t1 + climb.periodSeconds / 2
  const far = coastState(climb.coast, t2, request)
  const farUp = normalizeVec3(far.positionProjectInertialKm)
  const farRadius = lengthVec3(far.positionProjectInertialKm)
  const returnRadius = radiusAlong(context.targetAt(t2), scaleVec3(farUp, -1))
  const plan = highPlan(context, radius, farRadius, returnRadius)
  const towards = normalizeVec3(crossVec3(returnPlaneNormal(context, plan, t2), farUp))
  const turned = withVelocity(far, scaleVec3(towards, apsisSpeed(farRadius, returnRadius)))
  if (!conicWithinRouteLimits(turned.positionProjectInertialKm, turned.velocityProjectInertialKmPerSecond)) return null
  const back = openCoast(turned, request, t2)
  const t3 = t2 + back.periodSeconds / 2
  const legs = [...waitLegs(context, t1), { ...climb.coast, toSeconds: t2 }]
  const burns = [makeBurn(t1, 'climb', before, climbed), makeBurn(t2, 'turnHigh', far, turned)]
  return finishStage(context, key, legs, burns, back.coast, back.periodSeconds, t3 - context.targetPeriodSeconds / 2, t3 + 1.5 * context.targetPeriodSeconds, t3)
}

/** Natural drift: move to an orbit of another height, whose node J2 turns at
 *  another rate, and stay on it until its plane lines up with the target's. */
function driftStage(context: Context, key: Extract<StageKey, { family: 'drift' }>): Stage | null {
  const { request } = context
  const t1 = key.firstBurnSeconds
  const before = context.ownAt(t1)
  const radius = lengthVec3(before.positionProjectInertialKm)
  const moving = withVelocity(before, scaleVec3(horizontalDirection(before), apsisSpeed(radius, key.driftRadiusKm)))
  if (!conicWithinRouteLimits(moving.positionProjectInertialKm, moving.velocityProjectInertialKmPerSecond)) return null
  const way = openCoast(moving, request, t1)
  const t2 = t1 + way.periodSeconds / 2
  const arriving = coastState(way.coast, t2, request)
  const parked = withVelocity(arriving, scaleVec3(horizontalDirection(arriving), Math.sqrt(EARTH_MU_KM3_S2 / lengthVec3(arriving.positionProjectInertialKm))))
  const elements = elementsFromState(parked)
  const drifting: RouteSatellite = { name: `${request.own.name}-drift`, geometry: elements.geometry, phase: phaseFromTrueAnomaly(elements.geometry.eccentricity, elements.trueAnomalyRad, addSeconds(request.startInstant, t2)) }
  const lineUp = nodeAlignmentSeconds({ ...request, own: drifting }).find((seconds) => seconds > t2 + MIN_DRIFT_SECONDS / 2)
  if (lineUp === undefined) return null
  const driftPeriod = deriveOrbitValues(elements.geometry).periodSeconds
  const synodic = Math.min(MAX_DRIFT_SYNODIC_SECONDS, Math.max(2 * context.targetPeriodSeconds, 1 / Math.abs(1 / driftPeriod - 1 / context.targetPeriodSeconds)))
  const coast: RouteDriftLeg = { kind: 'drift', fromSeconds: t2, toSeconds: Infinity, geometry: drifting.geometry, phase: drifting.phase }
  const legs = [...waitLegs(context, t1), { ...way.coast, toSeconds: t2 }]
  const burns = [makeBurn(t1, 'toDrift', before, moving), makeBurn(t2, 'drift', arriving, parked)]
  return finishStage(context, key, legs, burns, coast, driftPeriod, lineUp - DRIFT_WINDOW_SYNODIC * synodic, lineUp + DRIFT_WINDOW_SYNODIC * synodic, lineUp)
}

function stageOf(context: Context, key: StageKey): Stage | null {
  switch (key.family) {
    case 'turnAtNode': return nodeStage(context, key)
    case 'goHigh': return highStage(context, key)
    case 'drift': return driftStage(context, key)
  }
}

/** The heights at which J2 turns your satellite's plane onto the target's in about
 *  the times worth trying, closing the node gap either way round. */
function driftRadii(context: Context): number[] {
  const { request } = context
  const own = request.own.geometry
  const target = context.targetGeometry
  if (Math.sin(own.inclinationRad) * Math.sin(target.inclinationRad) < 1e-3) return []
  const nodeAt = (geometry: OrbitGeometry, phase: RouteSatellite['phase']) => j2SecularElementsAt(geometry, phase, request.startInstant).geometry.raanRad
  const rawGap = nodeAt(own, request.own.phase) - nodeAt(target, request.target.phase)
  const gap = Math.atan2(Math.sin(rawGap), Math.cos(rawGap))
  const targetRate = j2SecularRates(target).raanRadPerSecond
  const rateAt = (radiusKm: number) => j2SecularRates({ semiMajorAxisKm: radiusKm, eccentricity: 0, inclinationRad: own.inclinationRad, raanRad: 0, argOfPeriapsisRad: 0 }).raanRadPerSecond
  const low = ROUTE_MIN_PERIGEE_RADIUS_KM
  const high = Math.min(ROUTE_MAX_APOGEE_RADIUS_KM, Math.max(own.semiMajorAxisKm, target.semiMajorAxisKm) + MAX_DRIFT_RISE_KM)
  const durations = [...DRIFT_DAYS.map((days) => days * DAY), ...DRIFT_SHARES.map((share) => share * request.horizonSeconds)]
    .filter((seconds) => seconds >= MIN_DRIFT_SECONDS && seconds < request.horizonSeconds)
  const radii: number[] = []
  for (const seconds of durations) {
    for (const closing of [-gap, -gap + (gap > 0 ? TAU : -TAU)]) {
      const wanted = targetRate + closing / seconds
      // The node rate changes steadily with height, so a bisection finds it.
      if ((rateAt(low) - wanted) * (rateAt(high) - wanted) > 0) continue
      let below = low
      let above = high
      for (let step = 0; step < DRIFT_RADIUS_BISECTIONS; step += 1) {
        const middle = (below + above) / 2
        if ((rateAt(below) - wanted) * (rateAt(middle) - wanted) <= 0) above = middle
        else below = middle
      }
      const found = (below + above) / 2
      if (Math.abs(found - own.semiMajorAxisKm) < SAME_HEIGHT_SHARE * own.semiMajorAxisKm) continue
      if (radii.some((radius) => Math.abs(radius - found) < SAME_DRIFT_KM)) continue
      radii.push(found)
    }
  }
  return radii.sort((a, b) => a - b)
}

/** The angle between the two planes at the start. */
function startPlaneAngle(context: Context): number {
  const own = planeNormal(context.ownAt(0))
  const target = planeNormal(context.targetAt(0))
  return Math.acos(Math.min(1, Math.max(-1, dotVec3(own, target))))
}

/** Rough costs between circles, to decide whether going high is worth a search. */
function turnLowEstimate(ownRadius: number, targetRadius: number, angle: number): number {
  const transfer = (ownRadius + targetRadius) / 2
  const speedAt = (radius: number) => Math.sqrt(EARTH_MU_KM3_S2 * (2 / radius - 1 / transfer))
  const v1 = Math.sqrt(EARTH_MU_KM3_S2 / ownRadius)
  const v2 = Math.sqrt(EARTH_MU_KM3_S2 / targetRadius)
  const change = (a: number, b: number, turn: number) => Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(turn))
  let best = Infinity
  for (let index = 0; index <= 10; index += 1) {
    const share = index / 10
    best = Math.min(best, change(v1, speedAt(ownRadius), share * angle) + change(speedAt(targetRadius), v2, (1 - share) * angle))
  }
  return best
}

export function goHighEstimate(ownRadius: number, targetRadius: number, apoapsis: number, angle: number): number {
  const v1 = Math.sqrt(EARTH_MU_KM3_S2 / ownRadius)
  const v2 = Math.sqrt(EARTH_MU_KM3_S2 / targetRadius)
  const up = apsisSpeed(ownRadius, apoapsis)
  const farUp = (up * ownRadius) / apoapsis
  const farDown = apsisSpeed(apoapsis, targetRadius)
  const down = (farDown * apoapsis) / targetRadius
  return Math.abs(up - v1) + Math.sqrt(farUp * farUp + farDown * farDown - 2 * farUp * farDown * Math.cos(angle)) + Math.abs(down - v2)
}

/** Every stage worth a search, soonest first within each family. */
export function stageKeys(request: RouteRequest): StageKey[] {
  const context = contextOf(request)
  const angle = startPlaneAngle(context)
  if (angle < MIN_PLANE_ANGLE_RAD) return []
  const ownPeriod = deriveOrbitValues(request.own.geometry).periodSeconds
  const step = ownPeriod / CROSSING_SAMPLES_PER_ORBIT
  const horizon = request.horizonSeconds
  const keys: StageKey[] = []

  const crossingSide = (seconds: number) => dotVec3(context.ownAt(seconds).positionProjectInertialKm, planeNormal(context.targetAt(seconds)))
  const ownRadius = request.own.geometry.semiMajorAxisKm
  const targetRadius = context.targetGeometry.semiMajorAxisKm
  const sameHeight = Math.abs(ownRadius - targetRadius) < SAME_HEIGHT_SHARE * Math.max(ownRadius, targetRadius)
  signChanges(crossingSide, 0, Math.min(horizon, DEPARTURE_WINDOW_ORBITS * ownPeriod), step, NODE_CROSSINGS).forEach((crossing, index) => {
    keys.push({ family: 'turnAtNode', firstBurnSeconds: crossing, split: null })
    if (!sameHeight && index < SPLIT_CROSSINGS) for (const split of TURN_SPLITS) keys.push({ family: 'turnAtNode', firstBurnSeconds: crossing, split })
  })

  const lowEstimate = turnLowEstimate(ownRadius, targetRadius, angle)
  const larger = Math.max(ownRadius * (1 + request.own.geometry.eccentricity), targetRadius * (1 + context.targetGeometry.eccentricity))
  for (const share of HIGH_APOAPSIS_SHARES) {
    const apoapsis = share * ROUTE_MAX_APOGEE_RADIUS_KM
    if (apoapsis < HIGH_MIN_RADIUS_RATIO * larger) continue
    if (goHighEstimate(ownRadius, targetRadius, apoapsis, angle) > HIGH_ESTIMATE_MARGIN * lowEstimate) continue
    const plan = highPlan(context, ownRadius, apoapsis, targetRadius)
    if (plan.climbPeriodSeconds / 2 + plan.returnPeriodSeconds / 2 >= horizon) continue
    const climbRate = spanningNodeRate(ownRadius, apoapsis, request.own.geometry.inclinationRad)
    // The far end must be in the plane to turn into when the satellite gets there.
    const farSide = (seconds: number) => {
      const here = context.ownAt(seconds).positionProjectInertialKm
      const half = plan.climbPeriodSeconds / 2
      const far = turnedAboutAxis({ positionProjectInertialKm: scaleVec3(here, -1), velocityProjectInertialKmPerSecond: { x: 0, y: 0, z: 0 } }, climbRate * half).positionProjectInertialKm
      return dotVec3(far, returnPlaneNormal(context, plan, seconds + half))
    }
    for (const crossing of signChanges(farSide, 0, Math.min(horizon, 1.5 * ownPeriod), step, HIGH_CROSSINGS)) {
      keys.push({ family: 'goHigh', firstBurnSeconds: crossing, apoapsisRadiusKm: apoapsis })
    }
  }

  for (const driftRadiusKm of driftRadii(context)) keys.push({ family: 'drift', firstBurnSeconds: 0, driftRadiusKm })
  return keys
}

function candidateOf(stage: Stage, departureSeconds: number, flightSeconds: number, arc: BestArc): StagedCandidate {
  return {
    family: stage.key.family,
    stage: stage.key,
    departureSeconds,
    flightSeconds,
    arrivalSeconds: departureSeconds + flightSeconds,
    way: arc.way,
    revolutions: arc.revolutions,
    branch: arc.branch,
    deltaVKmPerSecond: stage.deltaVKmPerSecond + arc.deltaVKmPerSecond,
  }
}

/** The final arc from a stage's orbit to the target: a grid over departure and
 *  flight, long flights where the periods are alike, then a pattern search from the
 *  best of it. */
function searchFinalArc(context: Context, stage: Stage, sink: CandidateSink<StagedCandidate>): void {
  const { request } = context
  const horizon = request.horizonSeconds
  const targetPeriod = context.targetPeriodSeconds
  const shorter = Math.min(stage.anchorPeriodSeconds, targetPeriod)
  const longer = Math.max(stage.anchorPeriodSeconds, targetPeriod)
  const windowLength = stage.windowToSeconds - stage.windowFromSeconds
  const departureStep = Math.max(Math.min(stage.coastPeriodSeconds, targetPeriod) / ARC_DEPARTURES_PER_ORBIT, windowLength / MAX_ARC_DEPARTURES)
  const maxFlight = ARC_FLIGHT_ORBITS * longer
  const flightStep = Math.max(longer / ARC_FLIGHTS_PER_ORBIT, maxFlight / MAX_ARC_FLIGHTS)
  const departAt = (seconds: number) => coastState(stage.coast, seconds, request)
  const evaluate = (departure: number, flight: number, minRevolutions: number, maxRevolutions: number) =>
    bestArc(departAt(departure), context.targetAt(departure + flight), flight, minRevolutions, maxRevolutions, stage.arcNodeRateRadPerSecond)
  const seeds = new SeedBuckets(departureStep * 4, flightStep * 4)
  const consider = (departure: number, flight: number, minRevolutions: number, maxRevolutions: number) => {
    const arc = evaluate(departure, flight, minRevolutions, maxRevolutions)
    if (arc === null) return
    sink.offer(candidateOf(stage, departure, flight, arc))
    seeds.offer({ departureSeconds: departure, flightSeconds: flight, deltaVKmPerSecond: arc.deltaVKmPerSecond, revolutions: arc.revolutions })
  }

  for (let departure = stage.windowFromSeconds; departure <= stage.windowToSeconds; departure += departureStep) {
    for (let flight = flightStep; flight <= maxFlight && departure + flight <= horizon; flight += flightStep) consider(departure, flight, 0, ARC_REVOLUTIONS)
  }
  if (longer / shorter <= PHASING_MAX_PERIOD_RATIO) {
    const first = Math.max(stage.windowFromSeconds, stage.anchorSeconds - targetPeriod / 2)
    for (let index = 0; index < PHASING_DEPARTURES; index += 1) {
      const departure = first + (index * targetPeriod) / PHASING_DEPARTURES
      if (departure > stage.windowToSeconds) break
      for (let orbits = PHASING_MIN_ORBITS; orbits <= PHASING_MAX_ORBITS; orbits *= PHASING_ORBIT_GROWTH) {
        for (let point = 0; point < PHASING_ARRIVAL_POINTS; point += 1) {
          const flight = (orbits + point / PHASING_ARRIVAL_POINTS) * targetPeriod
          if (departure + flight > horizon) continue
          consider(departure, flight, Math.max(0, Math.floor(flight / longer) - 1), Math.ceil(flight / shorter) + 1)
        }
      }
    }
  }

  const nearFront = (seed: ArcSeed) => (stage.deltaVKmPerSecond + seed.deltaVKmPerSecond) / sink.cheapestBy(seed.departureSeconds + seed.flightSeconds)
  const worthwhile = seeds.all().filter((seed) => nearFront(seed) <= SEED_WORTHWHILE_RATIO).sort((a, b) => nearFront(a) - nearFront(b)).slice(0, MAX_REFINED_SEEDS)
  for (const seed of worthwhile) {
    const arrival = seed.departureSeconds + seed.flightSeconds
    refineArc(
      seed,
      { departureSeconds: departureStep / 2, flightSeconds: flightStep / 2 },
      { earliestDepartureSeconds: stage.windowFromSeconds, latestArrivalSeconds: Math.min(horizon, seedBucketEnd(arrival)) },
      evaluate,
      (departure, flight, arc) => sink.offer(candidateOf(stage, departure, flight, arc)),
    )
  }
}

/** The staged families: Turn at the node, Go high to turn and Natural drift. Each stage is the
 *  burns before a final arc, searched like Direct from the orbit they leave. */
export function* searchStaged(request: RouteRequest, sink: CandidateSink<StagedCandidate>, families: readonly StagedFamily[]): Generator<StagedProgress, void, void> {
  const context = contextOf(request)
  const keys = stageKeys(request).filter((key) => families.includes(key.family))
  for (const [index, key] of keys.entries()) {
    const stage = stageOf(context, key)
    if (stage !== null) searchFinalArc(context, stage, sink)
    yield { fraction: (index + 1) / keys.length }
  }
}

/** The full route of a staged candidate, its burns made again from what identifies them. */
export function buildStagedRoute(request: RouteRequest, candidate: StagedCandidate): Route {
  const context = contextOf(request)
  const stage = stageOf(context, candidate.stage)
  if (stage === null) throw new Error('A staged candidate must have its stage when made again')
  const departure = candidate.departureSeconds
  const leaving = coastState(stage.coast, departure, request)
  const target = context.targetAt(candidate.arrivalSeconds)
  const arc = solveArcAgain(request.startInstant, leaving, target, candidate, stage.arcNodeRateRadPerSecond)
  const legs = [...stage.legs, { ...stage.coast, toSeconds: departure }, arc.leg]
  const burns = [...stage.burns, makeBurn(departure, 'approach', leaving, arc.departed), makeBurn(candidate.arrivalSeconds, 'arrive', arc.arriving, target)]
  return routeOf(candidate.family, request, legs, burns)
}
