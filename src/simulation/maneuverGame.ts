import { degToRad, TAU, wrapRadians } from '../core/angles.ts'
import { EARTH_RADIUS_KM, MIN_PERIAPSIS_ALTITUDE_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../core/time.ts'
import { lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { deriveOrbitValues, meanMotion, type OrbitGeometry } from '../orbital/geometry.ts'
import { inPlaneElementsFromState, type OrbitPlane } from '../orbital/inPlaneState.ts'
import { meanFromTrueAnomaly } from '../orbital/kepler.ts'
import { stateVectorEci } from '../orbital/keplerian.ts'
import { KeplerianPropagator, phaseFromTrueAnomaly, reanchorPhase, type OrbitPhase } from '../orbital/keplerianPropagator.ts'
import { applyTangentialKick, hohmannTransfer, nextInstantAtOrBelowAltitude, phaseAngleRad, sampleArc } from '../orbital/maneuver.ts'
import type { OrbitalState } from '../orbital/propagator.ts'

/** The Interception game's tunable rules: how games are drawn, thrust, the
 *  tank, and the win and re-entry tests. */
export const MANEUVER_RULES = {
  minInclinationRad: degToRad(10),
  maxInclinationRad: degToRad(80),
  minAltitudeKm: 300,
  maxAltitudeKm: 1000,
  minAltitudeGapKm: 150,
  maxAltitudeGapKm: 600,
  minTargetLeadRad: degToRad(30),
  maxTargetLeadRad: degToRad(330),
  /** The Δv budget grows linearly with the starting altitude gap, from the
   *  minimum at the smallest gap to the maximum at the largest, in steps. Even
   *  the minimum is well over what the transfer takes: at most 325 m/s, at the
   *  largest gap. */
  minTankKmPerSecond: 0.5,
  maxTankKmPerSecond: 1,
  tankStepsPerKmPerSecond: 100,
  thrustKmPerSecond2: 0.02,
  /** A tap still delivers this much burn: the smallest correction, 2 m/s. */
  minimumBurnSeconds: 0.1,
  winDistanceKm: 100,
  winEccentricityDifference: 0.005,
  winPeriodDifferenceSeconds: 25,
  reentryAltitudeKm: MIN_PERIAPSIS_ALTITUDE_KM,
  /** A burn stops before the orbit gets more eccentric than this. */
  maxEccentricity: 0.9,
  trailPeriodFraction: 0.75,
  /** Below this the Aid switch marks no apogee or perigee: about 1 km of
   *  difference from a circle, and a single tap goes past it. */
  minApsisEccentricity: 0.0002,
} as const

export type BurnDirection = 'prograde' | 'retrograde'

/** Everything a game starts from. Both orbits are circular and share the
 *  plane; the target leads the player by `targetLeadRad` along the motion. */
export interface GameSetup {
  /** The seed it was drawn from, or null for a constructed setup. */
  readonly seed: number | null
  readonly plane: OrbitPlane
  readonly playerAltitudeKm: number
  readonly targetAltitudeKm: number
  readonly playerArgumentOfLatitudeRad: number
  readonly targetLeadRad: number
}

/** One coasting orbit, flown from `validFrom` until the next burn. */
export interface OrbitSegment {
  readonly geometry: OrbitGeometry
  readonly phase: OrbitPhase
  readonly validFrom: SimulationInstant
}

export interface BurnRecord {
  readonly direction: BurnDirection
  readonly start: SimulationInstant
  readonly end: SimulationInstant
  readonly deltaVKmPerSecond: number
  readonly periapsisAltitudeKm: number
  readonly apoapsisAltitudeKm: number
}

export interface ActiveBurn {
  readonly direction: BurnDirection
  readonly start: SimulationInstant
  readonly heldSeconds: number
  readonly deltaVKmPerSecond: number
  /** The orbit including every kick so far. */
  readonly segment: OrbitSegment
}

export interface GameOutcome {
  readonly kind: 'won' | 'reentered'
  readonly at: SimulationInstant
}

export interface ManeuverGame {
  readonly setup: GameSetup
  readonly startInstant: SimulationInstant
  readonly target: OrbitSegment
  /** Oldest first; segments no trail can reach are pruned. */
  readonly playerHistory: readonly OrbitSegment[]
  readonly burns: readonly BurnRecord[]
  readonly activeBurn: ActiveBurn | null
  readonly tankKmPerSecond: number
  readonly usedKmPerSecond: number
  /** The Hohmann minimum between the two starting orbits. */
  readonly referenceKmPerSecond: number
  readonly outcome: GameOutcome | null
}

export interface GoalStatus {
  readonly distanceKm: number
  /** Player minus target. */
  readonly eccentricityDifference: number
  /** Player minus target. */
  readonly periodDifferenceSeconds: number
  /** Positive when the target is ahead of the player. */
  readonly phaseAngleRad: number
  readonly distanceMet: boolean
  readonly shapeMet: boolean
  readonly periodMet: boolean
}

/** mulberry32: small, fast and identical in every browser. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function drawGameSetup(seed: number): GameSetup {
  const rules = MANEUVER_RULES
  const random = seededRandom(seed)
  const between = (min: number, max: number): number => min + (max - min) * random()
  const plane = { inclinationRad: between(rules.minInclinationRad, rules.maxInclinationRad), raanRad: between(0, TAU) }
  const playerAltitudeKm = between(rules.minAltitudeKm, rules.maxAltitudeKm)
  // Uniform over every allowed target altitude, above and below the player.
  const above = Math.max(0, Math.min(playerAltitudeKm + rules.maxAltitudeGapKm, rules.maxAltitudeKm) - (playerAltitudeKm + rules.minAltitudeGapKm))
  const below = Math.max(0, playerAltitudeKm - rules.minAltitudeGapKm - Math.max(playerAltitudeKm - rules.maxAltitudeGapKm, rules.minAltitudeKm))
  const pick = random() * (above + below)
  const targetAltitudeKm = pick < above ? playerAltitudeKm + rules.minAltitudeGapKm + pick : playerAltitudeKm - rules.minAltitudeGapKm - (pick - above)
  return {
    seed: seed >>> 0,
    plane,
    playerAltitudeKm,
    targetAltitudeKm,
    playerArgumentOfLatitudeRad: between(0, TAU),
    targetLeadRad: between(rules.minTargetLeadRad, rules.maxTargetLeadRad),
  }
}

function circularSegment(plane: OrbitPlane, altitudeKm: number, argumentOfLatitudeRad: number, at: SimulationInstant): OrbitSegment {
  const geometry = { ...plane, semiMajorAxisKm: EARTH_RADIUS_KM + altitudeKm, eccentricity: 0, argOfPeriapsisRad: 0 }
  return { geometry, phase: phaseFromTrueAnomaly(0, wrapRadians(argumentOfLatitudeRad), at), validFrom: { ...at } }
}

function tankForAltitudeGap(altitudeGapKm: number): number {
  const rules = MANEUVER_RULES
  const share = Math.min(1, Math.max(0, (altitudeGapKm - rules.minAltitudeGapKm) / (rules.maxAltitudeGapKm - rules.minAltitudeGapKm)))
  const tankKmPerSecond = rules.minTankKmPerSecond + share * (rules.maxTankKmPerSecond - rules.minTankKmPerSecond)
  return Math.round(tankKmPerSecond * rules.tankStepsPerKmPerSecond) / rules.tankStepsPerKmPerSecond
}

export function createGameFromSetup(setup: GameSetup, startInstant: SimulationInstant): ManeuverGame {
  const player = circularSegment(setup.plane, setup.playerAltitudeKm, setup.playerArgumentOfLatitudeRad, startInstant)
  const target = circularSegment(setup.plane, setup.targetAltitudeKm, setup.playerArgumentOfLatitudeRad + setup.targetLeadRad, startInstant)
  const referenceKmPerSecond = hohmannTransfer(player.geometry.semiMajorAxisKm, target.geometry.semiMajorAxisKm).totalKmPerSecond
  return {
    setup,
    startInstant: { ...startInstant },
    target,
    playerHistory: [player],
    burns: [],
    activeBurn: null,
    tankKmPerSecond: tankForAltitudeGap(Math.abs(setup.targetAltitudeKm - setup.playerAltitudeKm)),
    usedKmPerSecond: 0,
    referenceKmPerSecond,
    outcome: null,
  }
}

export function createGame(seed: number, startInstant: SimulationInstant): ManeuverGame {
  return createGameFromSetup(drawGameSetup(seed), startInstant)
}

/** The same start, a full tank and an empty log. */
export function restartGame(game: ManeuverGame): ManeuverGame {
  return createGameFromSetup(game.setup, game.startInstant)
}

export function segmentState(segment: OrbitSegment, at: SimulationInstant): OrbitalState {
  return new KeplerianPropagator(segment.geometry, segment.phase).stateAt(at)
}

function periodSeconds(geometry: OrbitGeometry): number {
  return deriveOrbitValues(geometry).periodSeconds
}

/** The coasting segment flown at an instant, ignoring any burn in progress.
 *  Before the first segment, the first one, as if it had always been flown. */
function coastSegmentAt(history: readonly OrbitSegment[], at: SimulationInstant): OrbitSegment {
  let segment = history[0]
  for (const candidate of history) if (secondsBetween(at, candidate.validFrom) >= 0) segment = candidate
  return segment
}

/** The player's orbit at an instant, including a burn in progress. */
export function playerSegmentAt(game: ManeuverGame, at: SimulationInstant): OrbitSegment {
  if (game.activeBurn && secondsBetween(at, game.activeBurn.start) >= 0) return game.activeBurn.segment
  return coastSegmentAt(game.playerHistory, at)
}

export function tankRemaining(game: ManeuverGame): number {
  return Math.max(0, game.tankKmPerSecond - game.usedKmPerSecond)
}

/** Starts a burn, unless the game is over, a burn is already running or the
 *  tank is empty. */
export function beginBurn(game: ManeuverGame, direction: BurnDirection, at: SimulationInstant): ManeuverGame {
  if (game.outcome || game.activeBurn || tankRemaining(game) === 0) return game
  return { ...game, activeBurn: { direction, start: { ...at }, heldSeconds: 0, deltaVKmPerSecond: 0, segment: playerSegmentAt(game, at) } }
}

/** The segment after an instantaneous kick at `at`, or null when the orbit
 *  would become too eccentric (or open) for the game. */
function kickedSegment(game: ManeuverGame, segment: OrbitSegment, at: SimulationInstant, deltaVKmPerSecond: number, direction: BurnDirection): OrbitSegment | null {
  const kicked = applyTangentialKick(segmentState(segment, at), direction === 'prograde' ? deltaVKmPerSecond : -deltaVKmPerSecond)
  let elements: ReturnType<typeof inPlaneElementsFromState>
  try { elements = inPlaneElementsFromState(game.setup.plane, kicked) } catch { return null }
  if (elements.geometry.eccentricity > MANEUVER_RULES.maxEccentricity) return null
  return { geometry: elements.geometry, phase: phaseFromTrueAnomaly(elements.geometry.eccentricity, elements.trueAnomalyRad, at), validFrom: segment.validFrom }
}

function withKick(game: ManeuverGame, burn: ActiveBurn, segment: OrbitSegment, deltaVKmPerSecond: number, heldSeconds: number): ManeuverGame {
  const emptied = deltaVKmPerSecond >= tankRemaining(game)
  return {
    ...game,
    usedKmPerSecond: emptied ? game.tankKmPerSecond : game.usedKmPerSecond + deltaVKmPerSecond,
    activeBurn: { ...burn, heldSeconds, deltaVKmPerSecond: burn.deltaVKmPerSecond + deltaVKmPerSecond, segment },
  }
}

/** Thrusts through one simulation step. The kick is applied at the middle of
 *  the step (drift, kick, drift), so the result is second-order accurate and
 *  practically independent of the frame rate; Δv depends only on held time.
 *  An empty tank ends the burn at `to`. */
export function continueBurn(game: ManeuverGame, from: SimulationInstant, to: SimulationInstant): ManeuverGame {
  const burn = game.activeBurn
  const seconds = secondsBetween(to, from)
  if (!burn || game.outcome || !(seconds > 0)) return game
  const deltaV = Math.min(MANEUVER_RULES.thrustKmPerSecond2 * seconds, tankRemaining(game))
  const segment = kickedSegment(game, burn.segment, addSeconds(from, seconds / 2), deltaV, burn.direction)
  if (!segment) return finishBurn(game, from)
  const next = withKick(game, burn, segment, deltaV, burn.heldSeconds + seconds)
  return tankRemaining(next) === 0 ? finishBurn(next, to) : next
}

/** Ends the burn at release. A press shorter than the minimum still delivers
 *  the minimum, added at release. */
export function endBurn(game: ManeuverGame, at: SimulationInstant): ManeuverGame {
  const burn = game.activeBurn
  if (!burn) return game
  const shortfallSeconds = MANEUVER_RULES.minimumBurnSeconds - burn.heldSeconds
  if (shortfallSeconds > 0 && !game.outcome) {
    const deltaV = Math.min(MANEUVER_RULES.thrustKmPerSecond2 * shortfallSeconds, tankRemaining(game))
    const segment = deltaV > 0 ? kickedSegment(game, burn.segment, at, deltaV, burn.direction) : null
    if (segment) return finishBurn(withKick(game, burn, segment, deltaV, MANEUVER_RULES.minimumBurnSeconds), at)
  }
  return finishBurn(game, at)
}

function finishBurn(game: ManeuverGame, at: SimulationInstant): ManeuverGame {
  const burn = game.activeBurn
  if (!burn) return game
  const { geometry, phase } = burn.segment
  const values = deriveOrbitValues(geometry)
  const segment = { geometry, phase: reanchorPhase(geometry, phase, at), validFrom: { ...at } }
  return {
    ...game,
    activeBurn: null,
    playerHistory: pruneHistory([...game.playerHistory, segment], at, periodSeconds(game.target.geometry)),
    burns: [...game.burns, { direction: burn.direction, start: burn.start, end: { ...at }, deltaVKmPerSecond: burn.deltaVKmPerSecond, periapsisAltitudeKm: values.periapsisAltitudeKm, apoapsisAltitudeKm: values.apoapsisAltitudeKm }],
  }
}

/** A trail never reaches back a full target period, so older segments go. */
function pruneHistory(history: readonly OrbitSegment[], at: SimulationInstant, keepSeconds: number): readonly OrbitSegment[] {
  const horizon = addSeconds(at, -keepSeconds)
  let first = 0
  while (first + 1 < history.length && secondsBetween(history[first + 1].validFrom, horizon) <= 0) first += 1
  return first === 0 ? history : history.slice(first)
}

export function goalStatus(game: ManeuverGame, at: SimulationInstant): GoalStatus {
  const rules = MANEUVER_RULES
  const player = playerSegmentAt(game, at)
  const playerState = segmentState(player, at)
  const targetPosition = segmentState(game.target, at).positionProjectInertialKm
  const distanceKm = lengthVec3(subtractVec3(playerState.positionProjectInertialKm, targetPosition))
  const eccentricityDifference = player.geometry.eccentricity - game.target.geometry.eccentricity
  const periodDifferenceSeconds = periodSeconds(player.geometry) - periodSeconds(game.target.geometry)
  return {
    distanceKm,
    eccentricityDifference,
    periodDifferenceSeconds,
    phaseAngleRad: phaseAngleRad(playerState, targetPosition),
    distanceMet: distanceKm <= rules.winDistanceKm,
    shapeMet: Math.abs(eccentricityDifference) <= rules.winEccentricityDifference,
    periodMet: Math.abs(periodDifferenceSeconds) <= rules.winPeriodDifferenceSeconds,
  }
}

/** Decides the game over one simulation step: re-entry is found analytically
 *  within the step, so no warp can skip it; the win is tested at `to`. A burn
 *  in progress ends with the game. */
export function settleOutcome(game: ManeuverGame, from: SimulationInstant, to: SimulationInstant): ManeuverGame {
  if (game.outcome) return game
  const segment = playerSegmentAt(game, to)
  const reentry = nextInstantAtOrBelowAltitude(segment.geometry, segment.phase, MANEUVER_RULES.reentryAltitudeKm, from)
  if (reentry && secondsBetween(reentry, to) <= 0) return { ...finishBurn(game, reentry), outcome: { kind: 'reentered', at: reentry } }
  const goals = goalStatus(game, to)
  if (goals.distanceMet && goals.shapeMet && goals.periodMet) return { ...finishBurn(game, to), outcome: { kind: 'won', at: { ...to } } }
  return game
}

/** How far back both trails reach: the same span of time for both. */
export function trailSeconds(game: ManeuverGame, at: SimulationInstant): number {
  return MANEUVER_RULES.trailPeriodFraction * Math.min(periodSeconds(playerSegmentAt(game, at).geometry), periodSeconds(game.target.geometry))
}

function sampleTimes(from: SimulationInstant, to: SimulationInstant, stepSeconds: number): SimulationInstant[] {
  const span = secondsBetween(to, from)
  const steps = Math.max(1, Math.ceil(span / stepSeconds))
  return Array.from({ length: steps + 1 }, (_, index) => addSeconds(from, (span * index) / steps))
}

export function targetTrail(game: ManeuverGame, at: SimulationInstant): ProjectInertialVec3[] {
  const times = sampleTimes(addSeconds(at, -trailSeconds(game, at)), at, periodSeconds(game.target.geometry) / 360)
  return times.map((time) => segmentState(game.target, time).positionProjectInertialKm)
}

/** The path the player actually flew, oldest first. Each burn's start and end
 *  are exact points; the few seconds between them are drawn straight, which
 *  at a burn's length is indistinguishable from the curved path. */
export function playerTrail(game: ManeuverGame, at: SimulationInstant): ProjectInertialVec3[] {
  const from = addSeconds(at, -trailSeconds(game, at))
  const intervals = game.burns.map((burn) => [burn.start, burn.end] as const)
  if (game.activeBurn) intervals.push([game.activeBurn.start, at])
  const inside = (time: SimulationInstant) => intervals.some(([start, end]) => secondsBetween(time, start) > 0 && secondsBetween(end, time) > 0)
  const boundaries = intervals.flatMap((interval) => interval).filter((time) => secondsBetween(time, from) > 0 && secondsBetween(at, time) > 0)
  const times = [...sampleTimes(from, at, periodSeconds(playerSegmentAt(game, at).geometry) / 360).filter((time) => !inside(time)), ...boundaries]
    .sort((a, b) => a.unixSeconds - b.unixSeconds)
  const activeStart = game.activeBurn?.start
  return times.map((time) => {
    const segment = activeStart && secondsBetween(time, activeStart) > 0 ? game.activeBurn!.segment : coastSegmentAt(game.playerHistory, time)
    return segmentState(segment, time).positionProjectInertialKm
  })
}

const AIM_LINE_STEP_RAD = Math.PI / 128

/** The dashed aim line, or null when there is none. While a burn is held it
 *  is the next 180° if the burn ended now. After the burn the far end stays
 *  put and the line shrinks ahead of the satellite until it gets there; the
 *  next burn replaces it. From a circular orbit or an apsis, the far end is
 *  the opposite apsis. */
export function predictionArc(game: ManeuverGame, at: SimulationInstant): ProjectInertialVec3[] | null {
  if (game.outcome) return null
  const segment = playerSegmentAt(game, at)
  const propagator = new KeplerianPropagator(segment.geometry, segment.phase)
  const nowRad = propagator.trueAnomalyAt(at)
  if (game.activeBurn) return sampleArc(segment.geometry, nowRad, Math.PI, AIM_LINE_STEP_RAD)
  const burn = game.burns.at(-1)
  if (!burn) return null
  const endRad = propagator.trueAnomalyAt(burn.end) + Math.PI
  const eccentricity = segment.geometry.eccentricity
  const flightSeconds = wrapRadians(meanFromTrueAnomaly(endRad, eccentricity) - propagator.meanAnomalyAt(burn.end)) / meanMotion(segment.geometry)
  const remainingRad = wrapRadians(endRad - nowRad)
  // The tolerance keeps the full line at the release instant; rounding just
  // past the far end wraps to nearly a whole turn and ends the line.
  if (secondsBetween(at, burn.end) >= flightSeconds || remainingRad > Math.PI + 1e-9) return null
  return sampleArc(segment.geometry, nowRad, Math.min(remainingRad, Math.PI), AIM_LINE_STEP_RAD)
}

/** One end of the player's orbit, for the Aid switch. */
export interface OrbitApsis {
  readonly kind: 'apoapsis' | 'periapsis'
  readonly state: OrbitalState
  /** Until the player next passes it. */
  readonly secondsUntil: number
}

/** Where the player's orbit is highest and lowest, in that order. Empty while
 *  the orbit is practically circular. */
export function orbitApsides(game: ManeuverGame, at: SimulationInstant): readonly OrbitApsis[] {
  const { geometry, phase } = playerSegmentAt(game, at)
  if (geometry.eccentricity < MANEUVER_RULES.minApsisEccentricity) return []
  const meanAnomalyRad = new KeplerianPropagator(geometry, phase).meanAnomalyAt(at)
  const { meanMotionRadPerSecond } = deriveOrbitValues(geometry)
  const apsis = (kind: OrbitApsis['kind'], trueAnomalyRad: number): OrbitApsis => ({
    kind,
    state: stateVectorEci(geometry, trueAnomalyRad),
    // At an apsis the true and mean anomalies are the same.
    secondsUntil: wrapRadians(trueAnomalyRad - meanAnomalyRad) / meanMotionRadPerSecond,
  })
  return [apsis('apoapsis', Math.PI), apsis('periapsis', 0)]
}

export interface GameScore {
  readonly usedKmPerSecond: number
  readonly referenceKmPerSecond: number
  /** Δv used divided by the Hohmann minimum. */
  readonly efficiency: number
  readonly burnCount: number
  /** Simulated time from start to the outcome, or null while playing. */
  readonly elapsedSeconds: number | null
}

export function gameScore(game: ManeuverGame): GameScore {
  return {
    usedKmPerSecond: game.usedKmPerSecond,
    referenceKmPerSecond: game.referenceKmPerSecond,
    efficiency: game.usedKmPerSecond / game.referenceKmPerSecond,
    burnCount: game.burns.length,
    elapsedSeconds: game.outcome ? secondsBetween(game.outcome.at, game.startInstant) : null,
  }
}
