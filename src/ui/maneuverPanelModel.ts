import { EARTH_RADIUS_KM } from '../core/constants.ts'
import type { SimulationInstant } from '../core/time.ts'
import { lengthVec3 } from '../core/vec3.ts'
import { deriveOrbitValues } from '../orbital/geometry.ts'
import { gameScore, goalStatus, MANEUVER_RULES, playerSegmentAt, segmentState, tankRemaining, type BurnDirection, type BurnRecord, type GameOutcome, type GameScore, type GoalStatus, type ManeuverGame, type OrbitSegment } from '../simulation/maneuverGame.ts'

export interface OrbitFacts {
  readonly altitudeKm: number
  readonly periapsisAltitudeKm: number
  readonly apoapsisAltitudeKm: number
  readonly periodSeconds: number
  readonly eccentricity: number
}

/** The orbital plane altitude view (the default) or the 3D view at true scale. */
export type ManeuverDisplay = 'altitude' | 'globe'

/** Everything the Interception panel and burn controls show, for one instant. */
export interface ManeuverPanelModel {
  readonly outcome: GameOutcome['kind'] | null
  readonly burning: BurnDirection | null
  readonly display: ManeuverDisplay
  /** Whether the apogee and perigee marks are drawn. */
  readonly aid: boolean
  readonly goals: GoalStatus
  readonly tankKmPerSecond: number
  readonly usedKmPerSecond: number
  readonly remainingKmPerSecond: number
  readonly player: OrbitFacts
  readonly target: OrbitFacts
  /** Oldest first. */
  readonly burns: readonly BurnRecord[]
  /** Present once the game is decided. */
  readonly score: GameScore | null
  /** The player's lowest point is below the re-entry altitude. */
  readonly lowPeriapsis: boolean
}

function orbitFacts(segment: OrbitSegment, at: SimulationInstant): OrbitFacts {
  const values = deriveOrbitValues(segment.geometry)
  return {
    altitudeKm: lengthVec3(segmentState(segment, at).positionProjectInertialKm) - EARTH_RADIUS_KM,
    periapsisAltitudeKm: values.periapsisAltitudeKm,
    apoapsisAltitudeKm: values.apoapsisAltitudeKm,
    periodSeconds: values.periodSeconds,
    eccentricity: segment.geometry.eccentricity,
  }
}

export function buildManeuverPanelModel(game: ManeuverGame, at: SimulationInstant, display: ManeuverDisplay, aid: boolean): ManeuverPanelModel {
  const player = orbitFacts(playerSegmentAt(game, at), at)
  return {
    outcome: game.outcome?.kind ?? null,
    burning: game.activeBurn?.direction ?? null,
    display,
    aid,
    goals: goalStatus(game, at),
    tankKmPerSecond: game.tankKmPerSecond,
    usedKmPerSecond: game.usedKmPerSecond,
    remainingKmPerSecond: tankRemaining(game),
    player,
    target: orbitFacts(game.target, at),
    burns: game.burns,
    score: game.outcome ? gameScore(game) : null,
    lowPeriapsis: player.periapsisAltitudeKm < MANEUVER_RULES.reentryAltitudeKm,
  }
}

/** Whether a panel must redraw at once rather than at its readout pace. */
export function maneuverPanelKey(model: ManeuverPanelModel): string {
  return `${model.outcome}|${model.burning}|${model.display}|${model.aid}|${model.burns.length}|${model.remainingKmPerSecond === 0}|${model.lowPeriapsis}|${model.goals.distanceMet}|${model.goals.shapeMet}|${model.goals.periodMet}`
}
