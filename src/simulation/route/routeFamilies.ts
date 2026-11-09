import { TAU } from '../../core/angles.ts'
import { addSeconds, type SimulationInstant } from '../../core/time.ts'
import { lengthVec3, subtractVec3, type Vec3 } from '../../core/vec3.ts'
import { burnComponents } from '../../orbital/burnFrame.ts'
import { elementsFromState } from '../../orbital/elementsFromState.ts'
import { deriveOrbitValues } from '../../orbital/geometry.ts'
import { j2SecularElementsAt, j2SecularRates } from '../../orbital/j2Secular.ts'
import { phaseFromTrueAnomaly } from '../../orbital/keplerianPropagator.ts'
import { lambertArcs, type LambertBranch, type LambertWay } from '../../orbital/lambert.ts'
import type { OrbitalState } from '../../orbital/propagator.ts'
import type { FrontPoint } from './routeFront.ts'
import { conicWithinRouteLimits, type BurnPurpose, type Route, type RouteBurn, type RouteFamily, type RouteLeg, type RouteSatellite, type RouteTransferLeg } from './routeModel.ts'
import { satelliteState } from './routeState.ts'

const SECONDS_PER_DAY = 86_400
const WAYS: readonly LambertWay[] = ['short', 'long']
/** Below this a flight is no longer a transfer the grid or a refinement should
 *  consider: an impulsive burn is already a stretch at minutes. */
export const MIN_FLIGHT_SECONDS = 60
const DEPARTURES_PER_ORBIT = 24
const FLIGHTS_PER_ORBIT = 24
/** The fine span tries every flight up to this many orbits of the slower satellite
 *  and whole revolutions, for the fast and short routes that decide the front's
 *  early end. Later spans only look for the planes and phases lining up. */
const FINE_FLIGHT_ORBITS = 3
const FINE_REVOLUTIONS = 2
const COARSE_FLIGHT_ORBITS = 1.5
const COARSE_REVOLUTIONS = 1
const COARSE_DEPARTURE_STRIDE = 2
/** Long flights of many revolutions are how to move along an orbit, or between
 *  orbits so alike that the phase would take weeks to come round: a slightly
 *  different period, held for long enough. Only between orbits this alike. */
const PHASING_MAX_PERIOD_RATIO = 1.2
const PHASING_MAX_ORBITS = 240
const PHASING_ORBIT_GROWTH = 1.04
/** Each flight also tries arriving at other points of the orbit. */
const PHASING_ARRIVAL_POINTS = 4
const PHASING_DEPARTURES = 12
const PHASING_DEPARTURES_PER_ORBIT = 6
/** Later departure spans start this much later than the one before. */
const SPAN_GROWTH = 1.25
/** How many of the instants the node gap closes to look at, soonest first. */
const MAX_NODE_ALIGNMENTS = 8
const SEED_BUCKET_GROWTH = 1.25
const SEEDS_PER_BUCKET = 3
/** A seed this much dearer than the front at its arrival will not reach it. */
export const SEED_WORTHWHILE_RATIO = 1.5
const REFINE_FINEST_STEP_SECONDS = 1
const MAX_REFINE_EVALUATIONS = 400
const REFINE_DIRECTIONS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
/** How many grid points are evaluated between two reports of progress. */
const GRID_POINTS_PER_CHUNK = 4_000
/** The share of the search's reported progress the grid takes. */
const GRID_SHARE = 0.85

export interface RouteRequest {
  readonly own: RouteSatellite
  readonly target: RouteSatellite
  readonly startInstant: SimulationInstant
  /** The search looks for arrivals up to this long after the start. */
  readonly horizonSeconds: number
}

export interface DirectCandidate extends FrontPoint {
  readonly family: 'direct'
  readonly departureSeconds: number
  readonly flightSeconds: number
  readonly way: LambertWay
  readonly revolutions: number
  readonly branch: LambertBranch
}

/** Where a family's candidates go: the front being built. */
export interface CandidateSink<Point extends FrontPoint> {
  offer(point: Point): boolean
  /** The lowest Δv of any candidate arriving by then. */
  cheapestBy(arrivalSeconds: number): number
}

/** Departures to try at one spacing, each with its range of flight times. */
export interface DepartureSpan {
  readonly fromSeconds: number
  readonly toSeconds: number
  readonly stride: number
  readonly maxFlightSeconds: number
  readonly maxRevolutions: number
}

export interface DirectGrid {
  /** The spacing every span's departures and arrivals fall on. */
  readonly stepSeconds: number
  /** Flight times are whole multiples of this many steps. */
  readonly flightStride: number
  readonly spans: readonly DepartureSpan[]
  /** The long flights to try from each of these departures. */
  readonly phasingDepartures: readonly number[]
  readonly phasingFlights: readonly number[]
  readonly shorterPeriodSeconds: number
  readonly longerPeriodSeconds: number
}

export interface DirectProgress {
  readonly fraction: number
  /** Set when the front has just become worth showing for the first time. */
  readonly firstFrontReady: boolean
}

export interface BestArc {
  readonly deltaVKmPerSecond: number
  readonly way: LambertWay
  readonly revolutions: number
  readonly branch: LambertBranch
}

export interface ArcSeed {
  readonly departureSeconds: number
  readonly flightSeconds: number
  readonly deltaVKmPerSecond: number
  readonly revolutions: number
}

function assertRequest(request: RouteRequest): void {
  if (!(request.horizonSeconds > 0) || !Number.isFinite(request.horizonSeconds)) throw new Error('A route search needs a positive, finite time limit')
}

/** The instants within the horizon at which the two orbits' nodes line up under
 *  J2, which is when their planes are closest. Soonest first. */
export function nodeAlignmentSeconds(request: RouteRequest): number[] {
  const own = request.own.geometry
  const target = request.target.geometry
  // The planes' angle depends on the node gap only through this product. An
  // equatorial orbit has no node to line up.
  if (Math.sin(own.inclinationRad) * Math.sin(target.inclinationRad) < 1e-6) return []
  const nodeAtStart = (satellite: RouteSatellite) => j2SecularElementsAt(satellite.geometry, satellite.phase, request.startInstant).geometry.raanRad
  const gap = nodeAtStart(request.own) - nodeAtStart(request.target)
  const closing = j2SecularRates(own).raanRadPerSecond - j2SecularRates(target).raanRadPerSecond
  if (closing === 0) return []
  const period = TAU / Math.abs(closing)
  const first = (((-gap / closing) % period) + period) % period
  const instants: number[] = []
  for (let index = 0; index < MAX_NODE_ALIGNMENTS && first + index * period <= request.horizonSeconds; index += 1) instants.push(first + index * period)
  return instants
}

/** Where Direct looks. All of it at first, and later only in spans long enough to
 *  see every relative phase, spreading out with time and placed where the planes
 *  line up, because over months only the planes' slow turning gives anything new.
 *  Between orbits of nearly one period it also tries long flights of many
 *  revolutions, starting soon. */
export function directGrid(request: RouteRequest): DirectGrid {
  assertRequest(request)
  const { horizonSeconds: horizon } = request
  const ownPeriod = deriveOrbitValues(request.own.geometry).periodSeconds
  const targetPeriod = deriveOrbitValues(request.target.geometry).periodSeconds
  const shorter = Math.min(ownPeriod, targetPeriod)
  const longer = Math.max(ownPeriod, targetPeriod)
  const stepSeconds = Math.min(shorter / DEPARTURES_PER_ORBIT, horizon / (2 * DEPARTURES_PER_ORBIT))
  const flightStride = Math.max(1, Math.round(Math.min(longer / FLIGHTS_PER_ORBIT, horizon / FLIGHTS_PER_ORBIT) / stepSeconds))

  const synodic = ownPeriod === targetPeriod ? Infinity : 1 / Math.abs(1 / ownPeriod - 1 / targetPeriod)
  const threeDays = 3 * SECONDS_PER_DAY
  const fineUntil = Math.min(horizon, clamp(2 * synodic, 4 * longer, Math.max(4 * longer, threeDays)))
  const spanLength = clamp(synodic, 2 * longer, Math.max(2 * longer, threeDays))
  const spans: DepartureSpan[] = [{ fromSeconds: 0, toSeconds: fineUntil, stride: 1, maxFlightSeconds: FINE_FLIGHT_ORBITS * longer, maxRevolutions: FINE_REVOLUTIONS }]

  const later: (readonly [number, number])[] = []
  for (let from = fineUntil; from < horizon; from *= SPAN_GROWTH) later.push([from, from + spanLength])
  for (const alignment of nodeAlignmentSeconds(request)) later.push([alignment - spanLength / 2, alignment + spanLength / 2])
  later.sort((a, b) => a[0] - b[0])
  let open: [number, number] | null = null
  const addLater = (from: number, to: number) => {
    const clippedFrom = Math.max(fineUntil, from)
    const clippedTo = Math.min(horizon, to)
    if (clippedFrom < clippedTo) spans.push({ fromSeconds: clippedFrom, toSeconds: clippedTo, stride: COARSE_DEPARTURE_STRIDE, maxFlightSeconds: COARSE_FLIGHT_ORBITS * longer, maxRevolutions: COARSE_REVOLUTIONS })
  }
  for (const [from, to] of later) {
    if (open !== null && from <= open[1]) open[1] = Math.max(open[1], to)
    else {
      if (open !== null) addLater(open[0], open[1])
      open = [from, to]
    }
  }
  if (open !== null) addLater(open[0], open[1])

  const phasingFlights: number[] = []
  const phasingDepartures: number[] = []
  if (longer / shorter <= PHASING_MAX_PERIOD_RATIO) {
    for (let orbits = FINE_FLIGHT_ORBITS; orbits <= PHASING_MAX_ORBITS; orbits *= PHASING_ORBIT_GROWTH) {
      for (let point = 0; point < PHASING_ARRIVAL_POINTS; point += 1) {
        const flight = (orbits + point / PHASING_ARRIVAL_POINTS) * longer
        if (flight < horizon) phasingFlights.push(flight)
      }
    }
    for (let index = 0; index < PHASING_DEPARTURES; index += 1) phasingDepartures.push((index * longer) / PHASING_DEPARTURES_PER_ORBIT)
    // Orbits of one period keep their phase, however long they wait. So when their
    // planes line up the phase is still whatever it was, and only a long flight can
    // put it right.
    for (const alignment of nodeAlignmentSeconds(request)) {
      for (let index = 0; index < PHASING_DEPARTURES; index += 1) {
        const departure = alignment + ((index - PHASING_DEPARTURES / 2) * longer) / PHASING_DEPARTURES_PER_ORBIT
        if (departure >= 0 && departure < horizon) phasingDepartures.push(departure)
      }
    }
  }
  return { stepSeconds, flightStride, spans, phasingDepartures, phasingFlights, shorterPeriodSeconds: shorter, longerPeriodSeconds: longer }
}

/** How many departure and flight pairs a grid evaluates, each of them a Lambert
 *  solve per way. */
export function directGridPoints(grid: DirectGrid, horizonSeconds: number): number {
  let points = 0
  const flightStep = grid.stepSeconds * grid.flightStride
  for (const span of grid.spans) {
    const departureStep = grid.stepSeconds * span.stride
    const departures = Math.ceil((span.toSeconds - span.fromSeconds) / departureStep)
    for (let index = 0; index < departures; index += 1) {
      points += Math.floor(Math.min(span.maxFlightSeconds, horizonSeconds - span.fromSeconds - index * departureStep) / flightStep)
    }
  }
  for (const departure of grid.phasingDepartures) {
    for (const flight of grid.phasingFlights) if (departure + flight <= horizonSeconds) points += 1
  }
  return points
}

export function speedChange(a: Vec3, b: Vec3): number {
  const x = a.x - b.x
  const y = a.y - b.y
  const z = a.z - b.z
  return Math.sqrt(x * x + y * y + z * z)
}

/** How fast a transfer's frame turns about the axis: the rate of the ellipse that
 *  spans the two orbits, at the inclination halfway between them. A cheap arc is
 *  much like that, and one that climbs to a far orbit turns far slower than either
 *  rate at the low end would suggest. */
export function transferNodeRate(request: RouteRequest): number {
  const own = request.own.geometry
  const target = request.target.geometry
  const lowest = Math.min(own.semiMajorAxisKm * (1 - own.eccentricity), target.semiMajorAxisKm * (1 - target.eccentricity))
  const highest = Math.max(own.semiMajorAxisKm * (1 + own.eccentricity), target.semiMajorAxisKm * (1 + target.eccentricity))
  return spanningNodeRate(lowest, highest, (own.inclinationRad + target.inclinationRad) / 2)
}

/** The node rate of the ellipse reaching from one radius to another. */
export function spanningNodeRate(lowestKm: number, highestKm: number, inclinationRad: number): number {
  return j2SecularRates({
    semiMajorAxisKm: (lowestKm + highestKm) / 2,
    eccentricity: (highestKm - lowestKm) / (highestKm + lowestKm),
    inclinationRad,
    raanRad: 0,
    argOfPeriapsisRad: 0,
  }).raanRadPerSecond
}

export function turnedAboutAxis(state: OrbitalState, angleRad: number): OrbitalState {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)
  const turned = (v: Vec3): Vec3 => ({ x: cosine * v.x - sine * v.y, y: sine * v.x + cosine * v.y, z: v.z })
  return { positionProjectInertialKm: turned(state.positionProjectInertialKm), velocityProjectInertialKmPerSecond: turned(state.velocityProjectInertialKmPerSecond) }
}

/** The cheapest acceptable arc from one state to the other in a flight time.
 *  The arc starts in the same frame as the departure state and is solved in the
 *  frame it flies in, where the target is turned back by what the frame turns. */
export function bestArc(own: OrbitalState, target: OrbitalState, flightSeconds: number, minRevolutions: number, maxRevolutions: number, nodeRateRadPerSecond: number): BestArc | null {
  let best: BestArc | null = null
  const goal = turnedAboutAxis(target, -nodeRateRadPerSecond * flightSeconds)
  for (const way of WAYS) {
    for (const arc of lambertArcs(own.positionProjectInertialKm, goal.positionProjectInertialKm, flightSeconds, way, maxRevolutions, minRevolutions)) {
      const deltaV = speedChange(arc.departureVelocityKmPerSecond, own.velocityProjectInertialKmPerSecond) + speedChange(goal.velocityProjectInertialKmPerSecond, arc.arrivalVelocityKmPerSecond)
      if (best !== null && deltaV >= best.deltaVKmPerSecond) continue
      if (!conicWithinRouteLimits(own.positionProjectInertialKm, arc.departureVelocityKmPerSecond)) continue
      best = { deltaVKmPerSecond: deltaV, way, revolutions: arc.revolutions, branch: arc.branch }
    }
  }
  return best
}

function candidateOf(departureSeconds: number, flightSeconds: number, arc: BestArc): DirectCandidate {
  return { family: 'direct', departureSeconds, flightSeconds, arrivalSeconds: departureSeconds + flightSeconds, ...arc }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** The cheapest few different solutions per stretch of arrival time, so that
 *  refinement starts from all along the front and not only from one valley. */
export class SeedBuckets {
  private readonly buckets = new Map<number, ArcSeed[]>()
  private readonly sameDepartureSeconds: number
  private readonly sameFlightSeconds: number

  constructor(sameDepartureSeconds: number, sameFlightSeconds: number) {
    this.sameDepartureSeconds = sameDepartureSeconds
    this.sameFlightSeconds = sameFlightSeconds
  }

  offer(seed: ArcSeed): void {
    const key = seedBucket(seed.departureSeconds + seed.flightSeconds)
    let bucket = this.buckets.get(key)
    if (bucket === undefined) this.buckets.set(key, bucket = [])
    const worst = bucket[SEEDS_PER_BUCKET - 1]
    if (worst !== undefined && seed.deltaVKmPerSecond >= worst.deltaVKmPerSecond) return
    const same = bucket.findIndex((other) => Math.abs(other.departureSeconds - seed.departureSeconds) < this.sameDepartureSeconds && Math.abs(other.flightSeconds - seed.flightSeconds) < this.sameFlightSeconds)
    if (same >= 0) {
      if (seed.deltaVKmPerSecond >= bucket[same]!.deltaVKmPerSecond) return
      bucket.splice(same, 1)
    }
    bucket.push(seed)
    bucket.sort((a, b) => a.deltaVKmPerSecond - b.deltaVKmPerSecond)
    bucket.length = Math.min(bucket.length, SEEDS_PER_BUCKET)
  }

  /** Soonest stretch first. */
  all(): ArcSeed[] {
    return [...this.buckets.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, bucket]) => bucket)
  }
}

function seedBucket(arrivalSeconds: number): number {
  return Math.floor(Math.log(Math.max(arrivalSeconds, MIN_FLIGHT_SECONDS) / MIN_FLIGHT_SECONDS) / Math.log(SEED_BUCKET_GROWTH))
}

export function seedBucketEnd(arrivalSeconds: number): number {
  return MIN_FLIGHT_SECONDS * SEED_BUCKET_GROWTH ** (seedBucket(arrivalSeconds) + 1)
}

/** One conic from here to there: the coarse grid, then a pattern search from the
 *  best of it. Everything it finds goes into `archive`. It yields between pieces
 *  of work, so the caller can report progress or stop. */
export function* searchDirect(request: RouteRequest, archive: CandidateSink<DirectCandidate>): Generator<DirectProgress, void, void> {
  const grid = directGrid(request)
  const { horizonSeconds: horizon, startInstant: start } = request
  const ownAt = (seconds: number) => satelliteState(request.own, addSeconds(start, seconds))
  const targetAt = (seconds: number) => satelliteState(request.target, addSeconds(start, seconds))
  const flightStep = grid.stepSeconds * grid.flightStride
  const seeds = new SeedBuckets(grid.stepSeconds * DEPARTURES_PER_ORBIT / 4, flightStep * FLIGHTS_PER_ORBIT / 4)
  const totalPoints = Math.max(1, directGridPoints(grid, horizon))
  const nodeRate = transferNodeRate(request)
  let points = 0
  let sinceReport = 0
  const consider = (departure: number, flight: number, own: OrbitalState, target: OrbitalState, minRevolutions: number, maxRevolutions: number) => {
    const arc = bestArc(own, target, flight, minRevolutions, maxRevolutions, nodeRate)
    if (arc === null) return
    archive.offer(candidateOf(departure, flight, arc))
    seeds.offer({ departureSeconds: departure, flightSeconds: flight, deltaVKmPerSecond: arc.deltaVKmPerSecond, revolutions: arc.revolutions })
  }

  for (const [spanIndex, span] of grid.spans.entries()) {
    // Departures and arrivals fall on one lattice, so that each state is computed
    // once however many flights share it.
    const targets: (OrbitalState | undefined)[] = []
    const departures = Math.ceil((span.toSeconds - span.fromSeconds) / (grid.stepSeconds * span.stride))
    for (let departureIndex = 0; departureIndex < departures; departureIndex += 1) {
      const departureSteps = departureIndex * span.stride
      const departure = span.fromSeconds + departureSteps * grid.stepSeconds
      const own = ownAt(departure)
      const flights = Math.floor(Math.min(span.maxFlightSeconds, horizon - departure) / flightStep)
      for (let flightIndex = 1; flightIndex <= flights; flightIndex += 1) {
        const arrivalSteps = departureSteps + flightIndex * grid.flightStride
        const target = targets[arrivalSteps] ??= targetAt(span.fromSeconds + arrivalSteps * grid.stepSeconds)
        consider(departure, flightIndex * flightStep, own, target, 0, span.maxRevolutions)
      }
      points += flights
      sinceReport += flights
      if (sinceReport >= GRID_POINTS_PER_CHUNK) {
        sinceReport = 0
        yield { fraction: (GRID_SHARE * points) / totalPoints, firstFrontReady: false }
      }
    }
    if (spanIndex === 0) {
      for (const departure of grid.phasingDepartures) {
        const own = ownAt(departure)
        for (const flight of grid.phasingFlights) {
          if (departure + flight > horizon) continue
          consider(departure, flight, own, targetAt(departure + flight), Math.max(0, Math.floor(flight / grid.longerPeriodSeconds) - 1), Math.ceil(flight / grid.shorterPeriodSeconds) + 1)
          points += 1
        }
        yield { fraction: (GRID_SHARE * points) / totalPoints, firstFrontReady: false }
      }
      yield { fraction: (GRID_SHARE * points) / totalPoints, firstFrontReady: true }
    }
  }

  const allSeeds = seeds.all()
  for (const [index, seed] of allSeeds.entries()) {
    const arrival = seed.departureSeconds + seed.flightSeconds
    if (seed.deltaVKmPerSecond <= SEED_WORTHWHILE_RATIO * archive.cheapestBy(arrival)) refineSeed(seed, grid, request, archive, ownAt, targetAt)
    yield { fraction: GRID_SHARE + ((1 - GRID_SHARE) * (index + 1)) / allSeeds.length, firstFrontReady: false }
  }
}

function refineSeed(seed: ArcSeed, grid: DirectGrid, request: RouteRequest, archive: CandidateSink<DirectCandidate>, ownAt: (seconds: number) => OrbitalState, targetAt: (seconds: number) => OrbitalState): void {
  const nodeRate = transferNodeRate(request)
  refineArc(
    seed,
    { departureSeconds: grid.stepSeconds / 2, flightSeconds: (grid.stepSeconds * grid.flightStride) / 2 },
    { earliestDepartureSeconds: 0, latestArrivalSeconds: Math.min(request.horizonSeconds, seedBucketEnd(seed.departureSeconds + seed.flightSeconds)) },
    (departure, flight, minRevolutions, maxRevolutions) => bestArc(ownAt(departure), targetAt(departure + flight), flight, minRevolutions, maxRevolutions, nodeRate),
    (departure, flight, arc) => archive.offer(candidateOf(departure, flight, arc)),
  )
}

export interface RefineBounds {
  readonly earliestDepartureSeconds: number
  readonly latestArrivalSeconds: number
}

/** A pattern search over departure and flight time from a seed, offering every arc
 *  it tries. It moves to the first better neighbour and halves its steps when none
 *  is better, down to a second. */
export function refineArc(
  seed: ArcSeed,
  steps: { readonly departureSeconds: number; readonly flightSeconds: number },
  bounds: RefineBounds,
  evaluate: (departureSeconds: number, flightSeconds: number, minRevolutions: number, maxRevolutions: number) => BestArc | null,
  offer: (departureSeconds: number, flightSeconds: number, arc: BestArc) => void,
): void {
  let { departureSeconds: departure, flightSeconds: flight, deltaVKmPerSecond: best } = seed
  let departureStep = steps.departureSeconds
  let flightStep = steps.flightSeconds
  let evaluations = 0
  while ((departureStep > REFINE_FINEST_STEP_SECONDS || flightStep > REFINE_FINEST_STEP_SECONDS) && evaluations < MAX_REFINE_EVALUATIONS) {
    let moved = false
    for (const [towardsDeparture, towardsFlight] of REFINE_DIRECTIONS) {
      const nextDeparture = departure + towardsDeparture * departureStep
      const nextFlight = flight + towardsFlight * flightStep
      if (nextDeparture < bounds.earliestDepartureSeconds || nextFlight < MIN_FLIGHT_SECONDS || nextDeparture + nextFlight > bounds.latestArrivalSeconds) continue
      evaluations += 1
      const arc = evaluate(nextDeparture, nextFlight, Math.max(0, seed.revolutions - 1), seed.revolutions + 1)
      if (arc === null) continue
      offer(nextDeparture, nextFlight, arc)
      if (arc.deltaVKmPerSecond < best) {
        best = arc.deltaVKmPerSecond
        departure = nextDeparture
        flight = nextFlight
        moved = true
        break
      }
    }
    if (!moved) {
      departureStep /= 2
      flightStep /= 2
    }
  }
}

export function makeBurn(atSeconds: number, purpose: BurnPurpose, before: OrbitalState, after: OrbitalState): RouteBurn {
  const deltaV = subtractVec3(after.velocityProjectInertialKmPerSecond, before.velocityProjectInertialKmPerSecond)
  return {
    atSeconds,
    purpose,
    deltaVKmPerSecond: deltaV,
    components: burnComponents(before, deltaV),
    sizeKmPerSecond: lengthVec3(deltaV),
    before,
    after,
  }
}

/** What identifies one Lambert arc among those a search tried. */
export interface ArcIdentity {
  readonly departureSeconds: number
  readonly flightSeconds: number
  readonly way: LambertWay
  readonly revolutions: number
  readonly branch: LambertBranch
}

export interface SolvedArc {
  readonly leg: RouteTransferLeg
  /** Just after the departure burn, and just before the arrival burn. */
  readonly departed: OrbitalState
  readonly arriving: OrbitalState
}

/** An arc solved again from what identifies it, from a state to the target's state
 *  at arrival, flown in a frame turning at `nodeRateRadPerSecond`. */
export function solveArcAgain(start: SimulationInstant, from: OrbitalState, target: OrbitalState, identity: ArcIdentity, nodeRateRadPerSecond: number): SolvedArc {
  const turn = nodeRateRadPerSecond * identity.flightSeconds
  const goal = turnedAboutAxis(target, -turn)
  const arc = lambertArcs(from.positionProjectInertialKm, goal.positionProjectInertialKm, identity.flightSeconds, identity.way, identity.revolutions, identity.revolutions)
    .find((option) => option.revolutions === identity.revolutions && option.branch === identity.branch)
  if (arc === undefined) throw new Error('A route candidate must have an arc when solved again')
  const departed: OrbitalState = { positionProjectInertialKm: from.positionProjectInertialKm, velocityProjectInertialKmPerSecond: arc.departureVelocityKmPerSecond }
  const arriving = turnedAboutAxis({ positionProjectInertialKm: goal.positionProjectInertialKm, velocityProjectInertialKmPerSecond: arc.arrivalVelocityKmPerSecond }, turn)
  return {
    leg: coastLeg(departed, start, identity.departureSeconds, identity.departureSeconds + identity.flightSeconds, nodeRateRadPerSecond),
    departed,
    arriving,
  }
}

/** A conic leg starting from a state just after a burn. */
export function coastLeg(after: OrbitalState, start: SimulationInstant, fromSeconds: number, toSeconds: number, nodeRateRadPerSecond: number): RouteTransferLeg {
  const elements = elementsFromState(after)
  return {
    kind: 'transfer',
    fromSeconds,
    toSeconds,
    geometry: elements.geometry,
    phase: phaseFromTrueAnomaly(elements.geometry.eccentricity, elements.trueAnomalyRad, addSeconds(start, fromSeconds)),
    nodeRateRadPerSecond,
  }
}

export function routeOf(family: RouteFamily, request: RouteRequest, legs: readonly RouteLeg[], burns: readonly RouteBurn[]): Route {
  return {
    family,
    startInstant: request.startInstant,
    own: request.own,
    target: request.target,
    legs,
    burns,
    totalDeltaVKmPerSecond: burns.reduce((sum, burn) => sum + burn.sizeKmPerSecond, 0),
    arrivalSeconds: burns[burns.length - 1]!.atSeconds,
  }
}

/** The full route of a candidate, solved again from what identifies its arc. */
export function buildDirectRoute(request: RouteRequest, candidate: DirectCandidate): Route {
  const { startInstant: start } = request
  const departure = candidate.departureSeconds
  const own = satelliteState(request.own, addSeconds(start, departure))
  const target = satelliteState(request.target, addSeconds(start, candidate.arrivalSeconds))
  const arc = solveArcAgain(start, own, target, candidate, transferNodeRate(request))
  const legs: RouteLeg[] = []
  if (departure > 0) legs.push({ kind: 'wait', fromSeconds: 0, toSeconds: departure, geometry: request.own.geometry, phase: request.own.phase })
  legs.push(arc.leg)
  return routeOf('direct', request, legs, [makeBurn(departure, 'depart', own, arc.departed), makeBurn(candidate.arrivalSeconds, 'arrive', arc.arriving, target)])
}
