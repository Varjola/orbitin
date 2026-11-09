import { MAX_SIMULATION_INSTANT } from '../core/constants.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../core/time.ts'
import type { Sgp4MeanElements } from '../data/sgp4MeanElements.ts'
import { j2SecularElementsAt } from '../orbital/j2Secular.ts'
import { fineTunedRoute } from '../simulation/route/routeFineTune.ts'
import { shortlistRoutes, type RouteLimits, type RouteShortlist } from '../simulation/route/routeFront.ts'
import type { Route, RouteFront, RouteSatellite } from '../simulation/route/routeModel.ts'
import { editedSatellite, orbitValuesAt, routeSeparation, targetPlacedAhead, type RouteOrbitValues, type RouteSeparation } from '../simulation/route/routeObjects.ts'
import type { RouteCameraView } from '../simulation/route/routeDrawing.ts'
import { adjacentBurn, advancePlayback, INITIAL_PLAYBACK, restartedPlayback, seekPlayback, showBurn, togglePlaying, type RoutePlaybackSpeed, type RoutePlaybackState } from '../simulation/route/routePlayback.ts'
import { buildAutomaticTimeline, timelinePoint, type RouteTimeline, type RouteTimelinePoint } from '../simulation/route/routeTimeline.ts'
import { exampleSatellites, plannedRequest, routeExample, ROUTE_DEFAULT_BUDGET_KM_S, ROUTE_DEFAULT_EXAMPLE, ROUTE_DEFAULT_ISP_SECONDS, ROUTE_DEFAULT_LIMIT_SECONDS, ROUTE_MAX_ISP_SECONDS, ROUTE_MIN_ISP_SECONDS, ROUTE_MIN_LIMIT_SECONDS, type RouteExampleId } from '../simulation/route/routeSetup.ts'
import { catalogueSatellite, isRealPairId, routeRealPair, type RouteRealPairId, type RouteRefusal, type RouteTryId } from '../simulation/route/routeSources.ts'
import type { ManeuverClockPort } from './ManeuverController.ts'
import type { RouteSolverPort, RouteSolverFactory } from './routeSolverWorker.ts'
import type { RouteSolverReply } from './routeSolverSession.ts'
import { routeDeltaVBucket, routeDurationBucket, type UsageEvent } from './usageEvents.ts'

export type RouteSide = 'own' | 'target'

/** Where an object came from. A catalogue object carries its elements, so its
 *  name and element age stay however the catalogue changes. */
export type RouteSource =
  | { readonly kind: 'example'; readonly exampleId: RouteExampleId; readonly side: RouteSide }
  | { readonly kind: 'catalogue'; readonly catalogId: string; readonly name: string; readonly elements: Sgp4MeanElements }

/** One of the two objects in the scene: where it came from, and the orbit it is on
 *  as mean elements from the instant it was placed or last changed. */
export interface RouteObject {
  readonly source: RouteSource
  readonly satellite: RouteSatellite
  /** Changed in the panel since it was placed. */
  readonly edited: boolean
  /** The panel sets one height for both ends of the orbit. */
  readonly circular: boolean
}

/** The two objects and the limits on the routes shown. A limit keeps its value
 *  while it is off. */
export interface RoutePlannerSetup {
  readonly own: RouteObject
  readonly target: RouteObject
  /** The Try these card this setup came from, until an object changes. */
  readonly tryId: RouteTryId | null
  readonly limitTime: boolean
  readonly limitFuel: boolean
  readonly limitSeconds: number
  readonly budgetKmPerSecond: number
}

export type RouteSolveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'solving'; readonly fraction: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unavailable' }

/** A search's outcome, with what it was asked. */
export interface RoutePlanResult {
  readonly setup: RoutePlannerSetup
  /** Where the routes start: the scene as it was when Plan route was pressed. */
  readonly instant: SimulationInstant
  readonly front: RouteFront
  readonly limitedToSeconds: number | null
}

/** One catalogue entry in the search's list. */
export interface RouteCatalogueEntry {
  readonly catalogId: string
  readonly name: string
}

/** Why a catalogue object was not taken. */
export type RoutePickRefusal = RouteRefusal | 'missing' | 'unavailable'

/** The catalogue as the panel's switch shows it. Once loaded, in any mode, it stays. */
export type RouteCatalogueState = 'off' | 'loading' | 'ready' | 'unavailable'

export interface RouteSearchState {
  readonly text: string
  readonly results: readonly RouteCatalogueEntry[]
  readonly moreResults: boolean
  /** Being fetched after it was chosen for a side. */
  readonly pending: { readonly catalogId: string; readonly side: RouteSide } | null
  readonly refusal: RoutePickRefusal | null
}

/** A real pair being fetched for Try these, or why it could not be. */
export type RoutePairState =
  | { readonly kind: 'loading'; readonly id: RouteRealPairId }
  | { readonly kind: 'refused'; readonly id: RouteRealPairId; readonly name: string | null; readonly refusal: RoutePickRefusal }

/** Why no route can be planned: both sides are one object, or the clock is too
 *  near its end to leave even the shortest time limit. */
export type RoutePlanBlock = 'sameObject' | 'clockEnds'

/** The two objects running before any route: the scene the mode opens on. */
export interface RouteLiveState {
  readonly instant: SimulationInstant
  readonly playing: boolean
  /** Simulated seconds per second on screen. */
  readonly rate: number
}

/** The live scene, or a route found from it. */
export type RouteView = 'live' | 'route'

/** The planning window: closed, showing the routes found, or one route's details. */
export type RoutePlannerWindow = 'closed' | 'routes' | 'details'

/** The route chosen in the window, and the same route fine-tuned when that saves
 *  something. The fine-tuned one is what plays. */
export interface RouteDetails {
  readonly route: Route
  readonly fineTuned: Route | null
}

export interface RouteObjectState {
  readonly object: RouteObject
  /** Its orbit now, as the panel shows it. */
  readonly values: RouteOrbitValues
}

export interface RoutePlannerSnapshot {
  readonly setup: RoutePlannerSetup
  readonly view: RouteView
  readonly window: RoutePlannerWindow
  readonly details: RouteDetails | null
  readonly live: RouteLiveState
  /** The instant in view: the live scene's, or the route's start. */
  readonly instant: SimulationInstant
  readonly own: RouteObjectState
  readonly target: RouteObjectState
  readonly separation: RouteSeparation
  readonly blocked: RoutePlanBlock | null
  readonly status: RouteSolveStatus
  readonly result: RoutePlanResult | null
  /** The routes offered in the window: a few of those found, within the limits. */
  readonly shortlist: RouteShortlist<Route> | null
  /** A route has been played and can be shown again. */
  readonly hasRoute: boolean
  /** The objects or the scene's instant have changed since the shown result was
   *  asked for. The limits only choose among the routes found. */
  readonly outOfDate: boolean
  readonly catalogue: RouteCatalogueState
  readonly search: RouteSearchState
  readonly pair: RoutePairState | null
  /** The engine's: it decides the propellant share, never the route. */
  readonly specificImpulseSeconds: number
  readonly camera: RouteCameraView
  /** Playback turns the camera to each burn as it comes. */
  readonly frameBurns: boolean
}

export type RouteCatalogueRecordResult =
  | { readonly ok: true; readonly catalogId: string; readonly name: string; readonly elements: Sgp4MeanElements }
  | { readonly ok: false; readonly refusal: 'missing' | 'noElements' | 'unavailable' }

/** The catalogue as the planner uses it: the one shared catalogue, loaded only when
 *  asked for, and searched without touching Real Objects' search. */
export interface RouteCataloguePort {
  /** Whether the catalogue is available. */
  load(): Promise<boolean>
  /** Loaded already, here or in another mode. */
  loaded(): boolean
  search(text: string, limit: number): { readonly entries: readonly RouteCatalogueEntry[]; readonly hasMore: boolean }
  record(catalogId: string): Promise<RouteCatalogueRecordResult>
}

export const ROUTE_SEARCH_RESULTS = 8
/** The live scene's speeds, in simulated seconds per second: the steps the other
 *  modes' clocks use. At 10 min/s a low orbit takes about ten seconds and the
 *  medium one a little over a minute. */
export const ROUTE_LIVE_RATES: readonly number[] = [1, 60, 600, 3600]
/** The live scene's rate when the Route Planner opens: 1 min/s. */
export const ROUTE_DEFAULT_LIVE_RATE = 60

/** The chosen route as it plays. */
export interface RoutePlaybackSnapshot {
  readonly route: Route
  readonly timeline: RouteTimeline
  readonly state: RoutePlaybackState
  readonly point: RouteTimelinePoint
}

interface Running {
  readonly id: number
  readonly setup: RoutePlannerSetup
  readonly instant: SimulationInstant
  readonly limitedToSeconds: number | null
}

const NO_SEARCH: RouteSearchState = { text: '', results: [], moreResults: false, pending: null, refusal: null }

export function limitsOf(setup: RoutePlannerSetup): RouteLimits {
  return { timeSeconds: setup.limitTime ? setup.limitSeconds : null, deltaVKmPerSecond: setup.limitFuel ? setup.budgetKmPerSecond : null }
}

/** The same two objects: the limits do not change what a search finds. */
function sameObjects(a: RoutePlannerSetup, b: RoutePlannerSetup): boolean {
  return a.own === b.own && a.target === b.target
}

/** Both limits start off, so the window offers the whole range from fastest to cheapest. */
const NO_LIMIT_FIELDS: Pick<RoutePlannerSetup, 'limitTime' | 'limitFuel' | 'limitSeconds' | 'budgetKmPerSecond'> = { limitTime: false, limitFuel: false, limitSeconds: ROUTE_DEFAULT_LIMIT_SECONDS, budgetKmPerSecond: ROUTE_DEFAULT_BUDGET_KM_S }

/** The same mean elements, counted from another instant. */
export function rebasedSatellite(satellite: RouteSatellite, instant: SimulationInstant): RouteSatellite {
  const drifted = j2SecularElementsAt(satellite.geometry, satellite.phase, instant)
  return { name: satellite.name, geometry: drifted.geometry, phase: { referenceInstant: { ...instant }, meanAnomalyAtReferenceRad: drifted.meanAnomalyRad } }
}

function exampleObjects(exampleId: RouteExampleId, instant: SimulationInstant): Pick<RoutePlannerSetup, 'own' | 'target'> {
  const satellites = exampleSatellites(routeExample(exampleId), instant)
  const object = (side: RouteSide): RouteObject => ({ source: { kind: 'example', exampleId, side }, satellite: satellites[side], edited: false, circular: true })
  return { own: object('own'), target: object('target') }
}

function catalogueObject(found: Extract<RouteCatalogueRecordResult, { ok: true }>, satellite: RouteSatellite): RouteObject {
  return { source: { kind: 'catalogue', catalogId: found.catalogId, name: found.name, elements: found.elements }, satellite, edited: false, circular: false }
}

function sourcesKind(setup: RoutePlannerSetup): 'example' | 'catalogue' | 'mixed' {
  const kinds = [setup.own.source.kind, setup.target.source.kind]
  if (kinds.every((kind) => kind === 'example')) return 'example'
  return kinds.every((kind) => kind === 'catalogue') ? 'catalogue' : 'mixed'
}

/** Owns the Route Planner: the two objects running in the live scene, the search
 *  from a moment of it, and the route found. Routes are session-only plain data,
 *  so they live here rather than in the application state. The shared clock stays
 *  paused in this mode, with its instant set from here every frame. */
export class RoutePlannerController {
  private setupState: RoutePlannerSetup | null = null
  private view: RouteView = 'live'
  private window: RoutePlannerWindow = 'closed'
  private details: RouteDetails | null = null
  /** The live scene was running when the window opened, and runs on when it closes. */
  private resumeLive = false
  private live: RouteLiveState | null = null
  private status: RouteSolveStatus = { kind: 'idle' }
  private result: RoutePlanResult | null = null
  private running: Running | null = null
  private solver: RouteSolverPort | null = null
  private search: RouteSearchState = NO_SEARCH
  private pair: RoutePairState | null = null
  private catalogueLoading: 'loading' | 'unavailable' | null = null
  /** Bumped by anything that makes a pending catalogue answer stale. */
  private pickGeneration = 0
  private nextId = 1
  private disposed = false
  /** The route being played, its timeline and where playback is in it. */
  private played: { readonly route: Route; readonly timeline: RouteTimeline } | null = null
  private playback: RoutePlaybackState = INITIAL_PLAYBACK
  private specificImpulseSeconds = ROUTE_DEFAULT_ISP_SECONDS
  private camera: RouteCameraView = 'free'
  private frameBurns = false
  private readonly clock: ManeuverClockPort
  private readonly createSolver: RouteSolverFactory
  private readonly catalogue: RouteCataloguePort
  private readonly record: (event: UsageEvent) => void
  private readonly changed: () => void
  private readonly fineTune: (route: Route) => Route | null

  constructor(clock: ManeuverClockPort, createSolver: RouteSolverFactory, catalogue: RouteCataloguePort, record: (event: UsageEvent) => void, changed: () => void, fineTune: (route: Route) => Route | null = fineTunedRoute) {
    this.clock = clock
    this.createSolver = createSolver
    this.catalogue = catalogue
    this.record = record
    this.changed = changed
    this.fineTune = fineTune
  }

  /** The live scene starts from the shared clock's instant when first asked for. */
  private get liveState(): RouteLiveState {
    this.live ??= { instant: this.clock.instant(), playing: true, rate: ROUTE_DEFAULT_LIVE_RATE }
    return this.live
  }

  private get setup(): RoutePlannerSetup {
    this.setupState ??= { ...exampleObjects(ROUTE_DEFAULT_EXAMPLE, this.liveState.instant), tryId: ROUTE_DEFAULT_EXAMPLE, ...NO_LIMIT_FIELDS }
    return this.setupState
  }

  snapshot(): RoutePlannerSnapshot {
    const setup = this.setup
    const live = this.liveState
    const instant = this.viewInstant()
    const result = this.result
    return {
      setup,
      view: this.view,
      window: this.window,
      details: this.details,
      live,
      instant,
      own: { object: setup.own, values: orbitValuesAt(setup.own.satellite, live.instant) },
      target: { object: setup.target, values: orbitValuesAt(setup.target.satellite, live.instant) },
      separation: routeSeparation(setup.own.satellite, setup.target.satellite, live.instant),
      blocked: this.blocked(),
      status: this.status,
      result,
      shortlist: this.shortlist(),
      hasRoute: this.played !== null,
      outOfDate: result !== null && (!sameObjects(result.setup, setup) || secondsBetween(result.instant, live.instant) !== 0),
      catalogue: this.catalogueState(),
      search: this.search,
      pair: this.pair,
      specificImpulseSeconds: this.specificImpulseSeconds,
      camera: this.camera,
      frameBurns: this.frameBurns,
    }
  }

  /** For every frame: cheaper than a whole snapshot. */
  cameraSettings(): { readonly camera: RouteCameraView; readonly frameBurns: boolean } {
    return { camera: this.camera, frameBurns: this.frameBurns }
  }

  /** A view the camera keeps to until the learner turns it by hand. */
  setCameraView(camera: RouteCameraView): void {
    if (camera === this.camera) return
    this.camera = camera
    this.changed()
  }

  setFrameBurns(frameBurns: boolean): void {
    if (frameBurns === this.frameBurns) return
    this.frameBurns = frameBurns
    this.changed()
  }

  /** Entering the mode pauses the shared clock: from here on its instant is set
   *  every frame, from the live scene or the route in view. */
  enter(): void {
    this.clock.set({ speedMultiplier: this.clock.setting().speedMultiplier, playing: false }, this.viewInstant())
  }

  /** A search carries on while the learner looks at another mode; the live scene
   *  and playback pause where they are. */
  leave(): void {
    this.playback = { ...this.playback, playing: false }
    this.live = { ...this.liveState, playing: false }
  }

  /** The two objects where the live scene has them, for drawing it. */
  liveScene(): { readonly own: RouteSatellite; readonly target: RouteSatellite; readonly instant: SimulationInstant } {
    return { own: this.setup.own.satellite, target: this.setup.target.satellite, instant: this.liveState.instant }
  }

  /** The live scene is in view and running, so its values change every frame. */
  liveRunning(): boolean {
    return this.view === 'live' && this.liveState.playing
  }

  /** The route in view as it plays, or null in the live scene. */
  playbackSnapshot(): RoutePlaybackSnapshot | null {
    if (this.view !== 'route' || this.played === null) return null
    return { ...this.played, state: this.playback, point: timelinePoint(this.played.timeline, this.playback.tau) }
  }

  /** Moves the live scene or playback on by one frame of screen time, and gives the
   *  instant the shared clock should show. */
  frame(wallSeconds: number): SimulationInstant {
    if (this.view === 'route' && this.played !== null) {
      this.playback = advancePlayback(this.playback, this.played.timeline, wallSeconds)
      return this.viewInstant()
    }
    const live = this.liveState
    if (live.playing && wallSeconds > 0) {
      const room = secondsBetween(MAX_SIMULATION_INSTANT, live.instant)
      const step = Math.min(room, wallSeconds * live.rate)
      // The clock's end stops the scene, as it stops every other mode.
      this.live = { ...live, instant: addSeconds(live.instant, step), playing: step < room }
      if (step >= room) this.changed()
    }
    return this.liveState.instant
  }

  toggleLive(): void {
    this.live = { ...this.liveState, playing: !this.liveState.playing }
    this.changed()
  }

  setLiveRate(rate: number): void {
    if (!ROUTE_LIVE_RATES.includes(rate)) return
    this.live = { ...this.liveState, rate }
    this.changed()
  }

  togglePlaying(): void { this.updatePlayback((state, timeline) => togglePlaying(state, timeline)) }
  setReversed(reversed: boolean): void { this.updatePlayback((state) => ({ ...state, reversed })) }
  setPlaybackSpeed(speed: RoutePlaybackSpeed): void { this.updatePlayback((state) => ({ ...state, speed })) }
  setAutoplay(autoplay: boolean): void { this.updatePlayback((state) => ({ ...state, autoplay })) }
  /** Scrubbing pauses, so playback does not pull against the hand. */
  seek(tau: number): void { this.updatePlayback((state, timeline) => seekPlayback({ ...state, playing: false }, timeline, tau)) }
  showBurn(burnIndex: number): void { this.updatePlayback((state, timeline) => showBurn(state, timeline, burnIndex)) }

  /** The next or previous burn in time, if there is one. */
  stepBurn(direction: 1 | -1): void {
    this.updatePlayback((state, timeline) => {
      const burnIndex = adjacentBurn(state, timeline, direction)
      return burnIndex === null ? state : showBurn(state, timeline, burnIndex)
    })
  }

  /** Back to the live scene as it was when the route's search began, paused. The
   *  routes found are kept. */
  exitRoute(): void {
    if (this.view === 'live') return
    this.view = 'live'
    this.playback = { ...this.playback, playing: false }
    if (this.result !== null) this.live = { ...this.liveState, instant: this.result.instant, playing: false }
    this.changed()
  }

  /** Shows the chosen route again, from where its playback was. */
  viewRoute(): void {
    if (this.played === null || this.view === 'route') return
    this.view = 'route'
    this.changed()
  }

  /** A Try these card sets both objects in the live scene, and leaves the limits. A real pair
   *  first fetches its two catalogue records. */
  selectTry(id: RouteTryId): void {
    this.toLive()
    this.pickGeneration += 1
    this.search = { ...this.search, pending: null, refusal: null }
    if (!isRealPairId(id)) {
      this.pair = null
      this.setupState = { ...this.setup, ...exampleObjects(id, this.liveState.instant), tryId: id }
      this.changed()
      return
    }
    this.pair = { kind: 'loading', id }
    this.changed()
    void this.loadPair(id, this.pickGeneration)
  }

  setLimitTime(limitTime: boolean): void { this.change({ limitTime }) }
  setLimitFuel(limitFuel: boolean): void { this.change({ limitFuel }) }
  setLimit(limitSeconds: number): void { this.change({ limitSeconds }) }
  setBudget(budgetKmPerSecond: number): void { this.change({ budgetKmPerSecond }) }

  /** Only the propellant share follows, so the route is not out of date. */
  setSpecificImpulse(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    this.specificImpulseSeconds = Math.min(ROUTE_MAX_ISP_SECONDS, Math.max(ROUTE_MIN_ISP_SECONDS, seconds))
    this.changed()
  }

  /** Plan route: pauses the live scene where it is and opens the window there. A
   *  scene with no routes found for it yet is planned at once. */
  openPlanner(): void {
    this.toLive()
    if (this.window !== 'closed' || this.blocked() !== null) return
    this.resumeLive = this.liveState.playing
    this.live = { ...this.liveState, playing: false }
    this.window = 'routes'
    const current = this.result !== null && sameObjects(this.result.setup, this.setup) && secondsBetween(this.result.instant, this.liveState.instant) === 0
    if (current || this.running !== null) this.changed()
    else this.plan()
  }

  /** Closing the window stops any search, and the live scene runs on as it was. */
  closePlanner(): void {
    if (this.window === 'closed') return
    this.window = 'closed'
    if (this.running !== null) this.cancel()
    this.live = { ...this.liveState, playing: this.resumeLive }
    this.changed()
  }

  /** A route of the shortlist pressed in the chart or the table: its details, fine-tuned. */
  selectRoute(index: number): void {
    const route = this.shortlist()?.points[index]
    if (route === undefined) return
    this.details = { route, fineTuned: this.fineTune(route) }
    this.window = 'details'
    this.changed()
  }

  /** From a route's details back to all the routes found. */
  backToRoutes(): void {
    if (this.window !== 'details') return
    this.window = 'routes'
    this.changed()
  }

  /** Plays the route in the details from its start, paused, in place of the scene. */
  playDetails(): void {
    const details = this.details
    if (details === null || this.window !== 'details') return
    const route = details.fineTuned ?? details.route
    this.play(route)
    this.window = 'closed'
    this.view = 'route'
    this.recordPlay(route)
    this.changed()
  }

  /** Changes an object's orbit where it is now in the live scene. */
  editObject(side: RouteSide, changes: Partial<RouteOrbitValues>): void {
    this.toLive()
    const object = this.setup[side]
    const instant = this.liveState.instant
    const values = orbitValuesAt(object.satellite, instant)
    // A circular orbit's one height sets both ends.
    const height = changes.perigeeAltitudeKm ?? changes.apogeeAltitudeKm
    const shaped = object.circular && height !== undefined ? { ...changes, perigeeAltitudeKm: height, apogeeAltitudeKm: height } : changes
    if (Object.entries(shaped).every(([key, value]) => values[key as keyof RouteOrbitValues] === value)) return
    this.setObject(side, { ...object, satellite: editedSatellite(object.satellite, instant, shaped), edited: true })
  }

  /** Circular sets both heights to the orbit's mean height; elliptical frees them. */
  setCircular(side: RouteSide, circular: boolean): void {
    this.toLive()
    const object = this.setup[side]
    if (object.circular === circular) return
    if (!circular) { this.setObject(side, { ...object, circular }); return }
    const instant = this.liveState.instant
    const values = orbitValuesAt(object.satellite, instant)
    const mean = (values.perigeeAltitudeKm + values.apogeeAltitudeKm) / 2
    const changed = values.apogeeAltitudeKm - values.perigeeAltitudeKm > 1e-9
    this.setObject(side, { ...object, circular, satellite: changed ? editedSatellite(object.satellite, instant, { perigeeAltitudeKm: mean, apogeeAltitudeKm: mean }) : object.satellite, edited: object.edited || changed })
  }

  /** Moves the target along its orbit to this far ahead of your satellite. */
  setTargetAhead(aheadDeg: number): void {
    if (!Number.isFinite(aheadDeg)) return
    this.toLive()
    const { own, target } = this.setup
    this.setObject('target', { ...target, satellite: targetPlacedAhead(own.satellite, target.satellite, this.liveState.instant, aheadDeg), edited: true })
  }

  swap(): void {
    this.toLive()
    this.cancelLoads()
    this.change({ own: this.setup.target, target: this.setup.own, tryId: null })
  }

  /** The switch: loads the one shared catalogue, which then stays for the session. */
  enableCatalogue(): void {
    if (this.catalogueState() === 'ready' || this.catalogueLoading === 'loading') return
    this.catalogueLoading = 'loading'
    this.changed()
    void this.loadCatalogue()
  }

  searchCatalogue(text: string): void {
    this.search = { ...this.search, text, refusal: null, ...this.results(text) }
    this.changed()
  }

  /** Takes a catalogue object for a side, placed where the catalogue has it now,
   *  unless it cannot be planned with. */
  pick(side: RouteSide, catalogId: string): void {
    if (this.catalogueState() !== 'ready') return
    this.pickGeneration += 1
    this.pair = null
    this.search = { ...this.search, pending: { catalogId, side }, refusal: null }
    this.changed()
    void this.fetchPick(side, catalogId, this.pickGeneration)
  }

  /** Plans from the live scene as it is now, which pauses. A route that was being
   *  played from an earlier search is put away. */
  plan(): void {
    const setup = this.setup
    if (this.blocked() !== null) return
    const solver = this.ensureSolver()
    if (solver === null) return
    if (this.running !== null) solver.post({ kind: 'cancel', id: this.running.id })
    this.toLive()
    this.play(null)
    this.details = null
    if (this.window === 'details') this.window = 'routes'
    this.live = { ...this.liveState, playing: false }
    const instant = this.liveState.instant
    const { request, limitedToSeconds } = plannedRequest(rebasedSatellite(setup.own.satellite, instant), rebasedSatellite(setup.target.satellite, instant), instant)
    const id = this.nextId
    this.nextId += 1
    this.running = { id, setup, instant, limitedToSeconds }
    this.status = { kind: 'solving', fraction: 0 }
    solver.post({ kind: 'plan', id, request })
    this.changed()
  }

  cancel(): void {
    if (this.running === null) return
    this.solver?.post({ kind: 'cancel', id: this.running.id })
    this.running = null
    this.status = { kind: 'cancelled' }
    this.changed()
  }

  dispose(): void {
    this.disposed = true
    this.pickGeneration += 1
    this.running = null
    this.solver?.dispose()
    this.solver = null
  }

  private viewInstant(): SimulationInstant {
    if (this.view === 'route' && this.played !== null) return addSeconds(this.played.route.startInstant, timelinePoint(this.played.timeline, this.playback.tau).seconds)
    return this.liveState.instant
  }

  /** Anything that changes the objects happens in the live scene. */
  private toLive(): void {
    if (this.view === 'route') this.exitRoute()
  }

  private shortlist(): RouteShortlist<Route> | null {
    return this.result === null ? null : shortlistRoutes(this.result.front.routes, limitsOf(this.setup))
  }

  private catalogueState(): RouteCatalogueState {
    if (this.catalogue.loaded()) return 'ready'
    return this.catalogueLoading ?? 'off'
  }

  private updatePlayback(change: (state: RoutePlaybackState, timeline: RouteTimeline) => RoutePlaybackState): void {
    if (this.played === null) return
    this.playback = change(this.playback, this.played.timeline)
  }

  private blocked(): RoutePlanBlock | null {
    const { own, target } = this.setup
    const a = own.source
    const b = target.source
    if (a.kind === 'catalogue' && b.kind === 'catalogue' && a.catalogId === b.catalogId && !own.edited && !target.edited) return 'sameObject'
    if (secondsBetween(MAX_SIMULATION_INSTANT, this.liveState.instant) < ROUTE_MIN_LIMIT_SECONDS) return 'clockEnds'
    return null
  }

  /** The learner's own change of an object, which drops any still loading. */
  private setObject(side: RouteSide, object: RouteObject): void {
    this.cancelLoads()
    this.change(side === 'own' ? { own: object, tryId: null } : { target: object, tryId: null })
  }

  private change(fields: Partial<RoutePlannerSetup>): void {
    this.setupState = { ...this.setup, ...fields }
    this.changed()
  }

  /** A change to the objects is the newest word: a pair or a pick still loading
   *  is dropped, so it cannot land on top of that change later, and a pair's
   *  refusal no longer applies. */
  private cancelLoads(): void {
    this.pickGeneration += 1
    this.pair = null
    if (this.search.pending !== null) this.search = { ...this.search, pending: null }
  }

  private results(text: string): Pick<RouteSearchState, 'results' | 'moreResults'> {
    if (this.catalogueState() !== 'ready' || text.trim() === '') return { results: [], moreResults: false }
    const found = this.catalogue.search(text, ROUTE_SEARCH_RESULTS)
    return { results: found.entries, moreResults: found.hasMore }
  }

  private async loadCatalogue(): Promise<void> {
    const available = await this.catalogue.load().catch(() => false)
    if (this.disposed) return
    this.catalogueLoading = available ? null : 'unavailable'
    this.search = { ...this.search, ...this.results(this.search.text) }
    this.changed()
  }

  private async fetchPick(side: RouteSide, catalogId: string, generation: number): Promise<void> {
    const found = await this.catalogue.record(catalogId).catch((): RouteCatalogueRecordResult => ({ ok: false, refusal: 'unavailable' }))
    if (this.disposed || generation !== this.pickGeneration) return
    const placed = found.ok ? catalogueSatellite(found.catalogId, found.elements, this.liveState.instant) : null
    if (!found.ok || placed === null || !placed.ok) {
      this.search = { ...this.search, pending: null, refusal: !found.ok ? found.refusal : placed !== null && !placed.ok ? placed.refusal : 'noElements' }
      this.changed()
      return
    }
    this.search = { ...this.search, pending: null }
    this.toLive()
    this.setObject(side, catalogueObject(found, placed.satellite))
  }

  private async loadPair(id: RouteRealPairId, generation: number): Promise<void> {
    const pair = routeRealPair(id)
    const available = this.catalogueState() === 'ready' || await this.catalogue.load().catch(() => false)
    if (this.disposed) return
    this.catalogueLoading = available ? null : 'unavailable'
    if (generation !== this.pickGeneration) return
    if (!available) { this.refusePair(id, null, 'unavailable'); return }
    const fetch = (catalogId: string) => this.catalogue.record(catalogId).catch((): RouteCatalogueRecordResult => ({ ok: false, refusal: 'unavailable' }))
    const [own, target] = await Promise.all([fetch(pair.ownCatalogId), fetch(pair.targetCatalogId)])
    if (this.disposed || generation !== this.pickGeneration) return
    const instant = this.liveState.instant
    const objects: RouteObject[] = []
    for (const found of [own, target]) {
      if (!found.ok) { this.refusePair(id, null, found.refusal); return }
      const placed = catalogueSatellite(found.catalogId, found.elements, instant)
      if (!placed.ok) { this.refusePair(id, found.name, placed.refusal); return }
      objects.push(catalogueObject(found, placed.satellite))
    }
    this.pair = null
    this.toLive()
    this.setupState = { ...this.setup, own: objects[0]!, target: objects[1]!, tryId: id }
    this.changed()
  }

  private refusePair(id: RouteRealPairId, name: string | null, refusal: RoutePickRefusal): void {
    this.pair = { kind: 'refused', id, name, refusal }
    this.changed()
  }

  private ensureSolver(): RouteSolverPort | null {
    if (this.solver !== null) return this.solver
    try {
      this.solver = this.createSolver({ reply: (reply) => this.onReply(reply), failure: () => this.onSolverFailure() })
    } catch {
      this.status = { kind: 'unavailable' }
      this.changed()
    }
    return this.solver
  }

  private onReply(reply: RouteSolverReply): void {
    const running = this.running
    if (running === null || reply.id !== running.id) return
    switch (reply.kind) {
      case 'progress':
        this.status = { kind: 'solving', fraction: reply.fraction }
        if (reply.front !== null) this.show(running, reply.front)
        break
      case 'done':
        this.running = null
        this.status = { kind: 'idle' }
        this.show(running, reply.front)
        break
      case 'failed':
        this.running = null
        this.status = { kind: 'failed' }
        break
    }
    this.changed()
  }

  /** There is no falling back to searching on the page: it would freeze the view. */
  private onSolverFailure(): void {
    this.solver?.dispose()
    this.solver = null
    if (this.running === null) return
    this.running = null
    this.status = { kind: 'unavailable' }
    this.changed()
  }

  private show(running: Running, front: RouteFront): void {
    this.result = { setup: running.setup, instant: running.instant, front, limitedToSeconds: running.limitedToSeconds }
  }

  /** A route starts from its beginning, paused, even when it was in view already. */
  private play(route: Route | null): void {
    const timeline = route !== null && route === this.played?.route ? this.played.timeline : null
    this.played = route === null ? null : { route, timeline: timeline ?? buildAutomaticTimeline(route) }
    this.playback = restartedPlayback(this.playback)
    if (route === null) this.view = 'live'
  }

  /** A route chosen and played: what it costs, and which limits chose it. */
  private recordPlay(route: Route): void {
    const { limitTime, limitFuel } = this.setup
    this.record({
      type: 'route_planned',
      limits: limitTime && limitFuel ? 'both' : limitTime ? 'time' : limitFuel ? 'fuel' : 'none',
      family: route.family,
      deltaV: routeDeltaVBucket(route.totalDeltaVKmPerSecond),
      duration: routeDurationBucket(route.arrivalSeconds),
      sources: sourcesKind(this.result?.setup ?? this.setup),
    })
  }
}
