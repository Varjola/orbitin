import { elementsFromState } from '../orbital/elementsFromState.ts'
import { deriveOrbitValues, type OrbitGeometry } from '../orbital/geometry.ts'
import { hohmannTransfer, propellantFraction } from '../orbital/maneuver.ts'
import { limitsOf, type RouteCatalogueState, type RouteLiveState, type RouteObjectState, type RoutePairState, type RoutePlanBlock, type RoutePlannerSnapshot, type RoutePlannerWindow, type RoutePlaybackSnapshot, type RouteSearchState, type RouteSolveStatus, type RouteSource, type RouteView } from '../app/RoutePlannerController.ts'
import { secondsBetween, type SimulationInstant } from '../core/time.ts'
import { routeWithinLimits, type RouteLimits } from '../simulation/route/routeFront.ts'
import type { BurnPurpose, Route, RouteBurn, RouteFamily, RouteLeg } from '../simulation/route/routeModel.ts'
import { ROUTE_MAX_BUDGET_KM_S, ROUTE_MAX_HORIZON_SECONDS, ROUTE_MAX_ISP_SECONDS, ROUTE_MIN_BUDGET_KM_S, ROUTE_MIN_ISP_SECONDS, ROUTE_MIN_LIMIT_SECONDS, type RouteExampleId } from '../simulation/route/routeSetup.ts'
import { planeAngleBetween, ROUTE_MAX_ALTITUDE_KM, ROUTE_MIN_ALTITUDE_KM, type RouteOrbitValues, type RouteSeparation } from '../simulation/route/routeObjects.ts'
import type { RouteTryId } from '../simulation/route/routeSources.ts'
import { adjacentBurn, shownRate, type RoutePlaybackSpeed } from '../simulation/route/routePlayback.ts'
import { buildAutomaticTimeline, type RouteTimelineSegment } from '../simulation/route/routeTimeline.ts'
import { routeProfile, type RouteCameraView, type RouteProfile } from '../simulation/route/routeDrawing.ts'

/** Below this the model cannot tell a route's cost from zero: its speed is the
 *  conic's, while its position also moves along the orbit with J2. */
export const ALREADY_THERE_KM_PER_SECOND = 0.02
const HOUR = 3600
const DAY = 86_400
/** The sliders' positions run from 0 to this. */
export const ROUTE_SLIDER_STEPS = 1000

export interface RouteOrbitSummary {
  readonly perigeeAltitudeKm: number
  readonly apogeeAltitudeKm: number
  readonly inclinationRad: number
}

export interface RouteBurnRow {
  readonly number: number
  readonly atSeconds: number
  readonly purpose: BurnPurpose
  readonly sizeKmPerSecond: number
  readonly progradeKmPerSecond: number
  readonly normalKmPerSecond: number
  readonly outwardKmPerSecond: number
  readonly before: RouteOrbitSummary
  readonly after: RouteOrbitSummary
  /** How far the burn turns the orbit's plane. */
  readonly turnRad: number
}

/** What to call a satellite: an example's side, or a catalogue object's name. */
export type RouteSideLabel =
  | { readonly kind: 'example'; readonly exampleId: RouteExampleId; readonly side: 'own' | 'target' }
  | { readonly kind: 'catalogue'; readonly catalogId: string; readonly name: string }

export interface RouteSideModel {
  readonly label: RouteSideLabel
  /** Changed in the panel since it was placed. */
  readonly edited: boolean
  readonly circular: boolean
  /** Its orbit in the live scene now. */
  readonly values: RouteOrbitValues
  /** A catalogue object's: from its elements' epoch to the live scene's instant.
   *  Positive when the epoch is earlier. */
  readonly elementAgeSeconds: number | null
}

/** One route of the shortlist, as the table lists it and the chart draws it. */
export interface RouteFrontPointModel {
  readonly deltaVKmPerSecond: number
  readonly arrivalSeconds: number
  readonly family: RouteFamily
  readonly burns: number
}

/** What a search was for: the two satellites as they were named then. */
export interface RoutePairModel {
  readonly own: RouteSideLabel
  readonly target: RouteSideLabel
  readonly ownEdited: boolean
  readonly targetEdited: boolean
}

/** The routes offered in the planning window: a few of those found, within the
 *  limits, soonest first. */
export interface RouteListModel extends RoutePairModel {
  readonly routes: readonly RouteFrontPointModel[]
  readonly limits: RouteLimits
  /** False when no route found keeps within the limits: the list is then drawn
   *  from all of them. */
  readonly withinLimits: boolean
  /** The cheapest route found is too small to tell from zero. */
  readonly alreadyThere: boolean
  readonly complete: boolean
  readonly outOfDate: boolean
  readonly limitedToSeconds: number | null
}

/** A stretch of a route between burns, in simulated time. */
export interface RouteLegModel {
  readonly kind: RouteLeg['kind']
  readonly fromSeconds: number
  readonly toSeconds: number
}

export interface RouteResultModel extends RoutePairModel {
  readonly family: RouteFamily
  readonly totalDeltaVKmPerSecond: number
  readonly arrivalSeconds: number
  readonly propellantFraction: number
  readonly specificImpulseSeconds: number
  /** The budget as set now, and how many of it the route needs. */
  readonly budgetKmPerSecond: number
  readonly tanks: number
  /** A Hohmann transfer between the two orbits' heights alone. The rest of the
   *  route's cost is the price of plane and phase together: Δv is a vector, so it is
   *  not split between them. */
  readonly altitudeOnlyKmPerSecond: number
  readonly limits: RouteLimits
  readonly withinLimits: boolean
  readonly alreadyThere: boolean
  readonly burns: readonly RouteBurnRow[]
  readonly legs: readonly RouteLegModel[]
  /** The route as its playback runs: the same stretches and holds as the playback
   *  bar, and the interceptor's height and plane along them. */
  readonly timeline: { readonly segments: readonly RouteTimelineSegment[]; readonly durationTau: number; readonly profile: RouteProfile }
}

/** The route in the window's details, or playing: fine-tuned when that saved
 *  something, with how much. */
export interface RouteShownModel extends RouteResultModel {
  readonly fineTunedSavingKmPerSecond: number | null
}

export interface RoutePanelModel {
  readonly view: RouteView
  readonly window: RoutePlannerWindow
  readonly shown: RouteShownModel | null
  readonly live: RouteLiveState
  /** A route has been played and can be shown again. */
  readonly hasRoute: boolean
  readonly tryId: RouteTryId | null
  readonly limitTime: boolean
  readonly limitFuel: boolean
  readonly limitSeconds: number
  readonly budgetKmPerSecond: number
  readonly own: RouteSideModel
  readonly target: RouteSideModel
  readonly separation: RouteSeparation
  readonly blocked: RoutePlanBlock | null
  readonly catalogue: RouteCatalogueState
  readonly search: RouteSearchState
  readonly pair: RoutePairState | null
  readonly status: RouteSolveStatus
  /** The last search finished and found nothing. */
  readonly noRoute: boolean
  readonly list: RouteListModel | null
  readonly specificImpulseSeconds: number
  readonly camera: RoutePlannerSnapshot['camera']
  readonly frameBurns: boolean
  /** The two orbit planes are drawn: chosen, or shown once they are apart. */
  readonly planesShown: boolean
}

function orbitSummary(geometry: OrbitGeometry): RouteOrbitSummary {
  const values = deriveOrbitValues(geometry)
  return { perigeeAltitudeKm: values.periapsisAltitudeKm, apogeeAltitudeKm: values.apoapsisAltitudeKm, inclinationRad: geometry.inclinationRad }
}

function burnRow(burn: RouteBurn, index: number): RouteBurnRow {
  const before = elementsFromState(burn.before).geometry
  const after = elementsFromState(burn.after).geometry
  return {
    number: index + 1,
    atSeconds: burn.atSeconds,
    purpose: burn.purpose,
    sizeKmPerSecond: burn.sizeKmPerSecond,
    progradeKmPerSecond: burn.components.progradeKmPerSecond,
    normalKmPerSecond: burn.components.normalKmPerSecond,
    outwardKmPerSecond: burn.components.outwardKmPerSecond,
    before: orbitSummary(before),
    after: orbitSummary(after),
    turnRad: planeAngleBetween(before, after),
  }
}

export function sideLabel(source: RouteSource): RouteSideLabel {
  return source.kind === 'example' ? source : { kind: 'catalogue', catalogId: source.catalogId, name: source.name }
}

function sideModel(state: RouteObjectState, instant: SimulationInstant): RouteSideModel {
  const { object, values } = state
  const { source } = object
  return {
    label: sideLabel(source),
    edited: object.edited,
    circular: object.circular,
    values,
    elementAgeSeconds: source.kind === 'catalogue' ? secondsBetween(instant, source.elements.epoch) : null,
  }
}

function pairModel(snapshot: RoutePlannerSnapshot): RoutePairModel {
  const { setup } = snapshot.result!
  return { own: sideLabel(setup.own.source), target: sideLabel(setup.target.source), ownEdited: setup.own.edited, targetEdited: setup.target.edited }
}

const timelines = new WeakMap<Route, RouteResultModel['timeline']>()

/** Built once a route: the panel model is rebuilt far more often than routes change. */
function timelineOf(route: Route): RouteResultModel['timeline'] {
  let timeline = timelines.get(route)
  if (timeline === undefined) {
    const built = buildAutomaticTimeline(route)
    timeline = { segments: built.segments, durationTau: built.durationTau, profile: routeProfile(route, built) }
    timelines.set(route, timeline)
  }
  return timeline
}

function resultModel(snapshot: RoutePlannerSnapshot, route: Route): RouteResultModel {
  const limits = limitsOf(snapshot.setup)
  return {
    ...pairModel(snapshot),
    family: route.family,
    totalDeltaVKmPerSecond: route.totalDeltaVKmPerSecond,
    arrivalSeconds: route.arrivalSeconds,
    propellantFraction: propellantFraction(route.totalDeltaVKmPerSecond, snapshot.specificImpulseSeconds),
    specificImpulseSeconds: snapshot.specificImpulseSeconds,
    budgetKmPerSecond: snapshot.setup.budgetKmPerSecond,
    tanks: route.totalDeltaVKmPerSecond / snapshot.setup.budgetKmPerSecond,
    altitudeOnlyKmPerSecond: hohmannTransfer(route.own.geometry.semiMajorAxisKm, route.target.geometry.semiMajorAxisKm).totalKmPerSecond,
    limits,
    withinLimits: routeWithinLimits(route, limits),
    alreadyThere: route.totalDeltaVKmPerSecond < ALREADY_THERE_KM_PER_SECOND,
    burns: route.burns.map(burnRow),
    legs: route.legs.filter((leg) => leg.toSeconds > leg.fromSeconds).map((leg) => ({ kind: leg.kind, fromSeconds: leg.fromSeconds, toSeconds: leg.toSeconds })),
    timeline: timelineOf(route),
  }
}

function listModel(snapshot: RoutePlannerSnapshot): RouteListModel | null {
  const { result, shortlist } = snapshot
  if (result === null || shortlist === null || shortlist.points.length === 0) return null
  const cheapest = result.front.routes[result.front.routes.length - 1]
  return {
    ...pairModel(snapshot),
    routes: shortlist.points.map((route) => ({ deltaVKmPerSecond: route.totalDeltaVKmPerSecond, arrivalSeconds: route.arrivalSeconds, family: route.family, burns: route.burns.length })),
    limits: limitsOf(snapshot.setup),
    withinLimits: shortlist.withinLimits,
    alreadyThere: cheapest !== undefined && cheapest.totalDeltaVKmPerSecond < ALREADY_THERE_KM_PER_SECOND,
    complete: result.front.complete,
    outOfDate: snapshot.outOfDate,
    limitedToSeconds: result.limitedToSeconds,
  }
}

export function buildRoutePanelModel(snapshot: RoutePlannerSnapshot, planesShown = false): RoutePanelModel {
  const { setup, status, result, own, target } = snapshot
  const details = snapshot.details
  const shownRoute = details === null ? null : details.fineTuned ?? details.route
  return {
    view: snapshot.view,
    window: snapshot.window,
    shown: details === null || shownRoute === null || result === null ? null : {
      ...resultModel(snapshot, shownRoute),
      fineTunedSavingKmPerSecond: details.fineTuned === null ? null : details.route.totalDeltaVKmPerSecond - details.fineTuned.totalDeltaVKmPerSecond,
    },
    live: snapshot.live,
    hasRoute: snapshot.hasRoute,
    tryId: setup.tryId,
    limitTime: setup.limitTime,
    limitFuel: setup.limitFuel,
    limitSeconds: setup.limitSeconds,
    budgetKmPerSecond: setup.budgetKmPerSecond,
    own: sideModel(own, snapshot.live.instant),
    target: sideModel(target, snapshot.live.instant),
    separation: snapshot.separation,
    blocked: snapshot.blocked,
    catalogue: snapshot.catalogue,
    search: snapshot.search,
    pair: snapshot.pair,
    status,
    noRoute: result !== null && result.front.complete && result.front.routes.length === 0,
    list: listModel(snapshot),
    specificImpulseSeconds: snapshot.specificImpulseSeconds,
    camera: snapshot.camera,
    frameBurns: snapshot.frameBurns,
    planesShown,
  }
}

function logPosition(value: number, low: number, high: number): number {
  return Math.round(ROUTE_SLIDER_STEPS * Math.log(value / low) / Math.log(high / low))
}

function fromLogPosition(position: number, low: number, high: number): number {
  return low * (high / low) ** (position / ROUTE_SLIDER_STEPS)
}

/** A limit lands on whole hours and, from two days on, whole days. */
export function limitFromPosition(position: number): number {
  const seconds = fromLogPosition(position, ROUTE_MIN_LIMIT_SECONDS, ROUTE_MAX_HORIZON_SECONDS)
  const unit = seconds < 2 * DAY ? HOUR : DAY
  return Math.min(ROUTE_MAX_HORIZON_SECONDS, Math.max(ROUTE_MIN_LIMIT_SECONDS, Math.round(seconds / unit) * unit))
}

export function positionFromLimit(seconds: number): number {
  return logPosition(seconds, ROUTE_MIN_LIMIT_SECONDS, ROUTE_MAX_HORIZON_SECONDS)
}

/** A budget lands on two significant figures. */
export function budgetFromPosition(position: number): number {
  const kmPerSecond = fromLogPosition(position, ROUTE_MIN_BUDGET_KM_S, ROUTE_MAX_BUDGET_KM_S)
  const unit = 10 ** (Math.floor(Math.log10(kmPerSecond)) - 1)
  return Math.min(ROUTE_MAX_BUDGET_KM_S, Math.max(ROUTE_MIN_BUDGET_KM_S, Number((Math.round(kmPerSecond / unit) * unit).toPrecision(2))))
}

export function positionFromBudget(kmPerSecond: number): number {
  return logPosition(kmPerSecond, ROUTE_MIN_BUDGET_KM_S, ROUTE_MAX_BUDGET_KM_S)
}

/** A height lands on three significant figures. */
export function altitudeFromPosition(position: number): number {
  const km = fromLogPosition(position, ROUTE_MIN_ALTITUDE_KM, ROUTE_MAX_ALTITUDE_KM)
  const unit = 10 ** (Math.floor(Math.log10(km)) - 2)
  return Math.min(ROUTE_MAX_ALTITUDE_KM, Math.max(ROUTE_MIN_ALTITUDE_KM, Math.round(km / unit) * unit))
}

export function positionFromAltitude(km: number): number {
  return logPosition(Math.min(ROUTE_MAX_ALTITUDE_KM, Math.max(ROUTE_MIN_ALTITUDE_KM, km)), ROUTE_MIN_ALTITUDE_KM, ROUTE_MAX_ALTITUDE_KM)
}

/** An engine's Isp lands on tens of seconds. */
export function ispFromPosition(position: number): number {
  return Math.min(ROUTE_MAX_ISP_SECONDS, Math.max(ROUTE_MIN_ISP_SECONDS, Math.round(fromLogPosition(position, ROUTE_MIN_ISP_SECONDS, ROUTE_MAX_ISP_SECONDS) / 10) * 10))
}

export function positionFromIsp(seconds: number): number {
  return logPosition(seconds, ROUTE_MIN_ISP_SECONDS, ROUTE_MAX_ISP_SECONDS)
}

/** The playback bar, as often as every frame. */
export interface RoutePlaybackModel {
  /** The same array for as long as the route is the same. */
  readonly segments: readonly RouteTimelineSegment[]
  readonly durationTau: number
  readonly tau: number
  readonly playing: boolean
  readonly reversed: boolean
  readonly speed: RoutePlaybackSpeed
  readonly autoplay: boolean
  /** Simulated seconds from the route's start. */
  readonly seconds: number
  /** Simulated seconds per second on screen; 0 while a burn holds the clock. */
  readonly rate: number
  /** The burn being held, numbered from 1. */
  readonly burnNumber: number | null
  readonly hasPreviousBurn: boolean
  readonly hasNextBurn: boolean
  readonly planesShown: boolean
  /** So fast that orbits are drawn instead of dots, with Earth's rotation held. */
  readonly drifting: boolean
  readonly camera: RouteCameraView
  /** Follow has given way to the face-on view while playback is too fast for it. */
  readonly followHeld: boolean
  readonly frameBurns: boolean
  /** The same object for as long as the route is the same. */
  readonly profile: RouteProfile | null
}

export interface RoutePlaybackViewOptions {
  readonly camera: RouteCameraView
  readonly followHeld?: boolean
  readonly frameBurns: boolean
  readonly profile: RouteProfile | null
}

export function buildRoutePlaybackModel(playback: RoutePlaybackSnapshot, planesShown: boolean, drifting = false, options: RoutePlaybackViewOptions = { camera: 'free', frameBurns: false, profile: null }): RoutePlaybackModel {
  const { timeline, state, point } = playback
  const held = point.burnIndex !== null
  return {
    segments: timeline.segments,
    durationTau: timeline.durationTau,
    tau: state.tau,
    playing: state.playing,
    reversed: state.reversed,
    speed: state.speed,
    autoplay: state.autoplay,
    seconds: point.seconds,
    rate: shownRate(state, point),
    burnNumber: held ? point.burnIndex! + 1 : null,
    hasPreviousBurn: adjacentBurn(state, timeline, -1) !== null,
    hasNextBurn: adjacentBurn(state, timeline, 1) !== null,
    planesShown,
    drifting,
    ...options,
    followHeld: options.followHeld ?? false,
  }
}

/** Planes are shown by default once they are more than about a degree apart. */
export const PLANES_SHOWN_ABOVE_RAD = Math.PI / 180

/** A constant rate's slider runs in tenths of a decade. */
export const CONSTANT_RATE_STEPS = 60

/** A constant rate lands on one or two significant figures. */
export function constantRateFromPosition(position: number): number {
  const rate = 10 ** (Math.min(CONSTANT_RATE_STEPS, Math.max(0, position)) / 10)
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(rate)) - 1)
  return Math.round(rate / unit) * unit
}

export function positionFromConstantRate(rate: number): number {
  return Math.round(10 * Math.log10(Math.max(1, rate)))
}
