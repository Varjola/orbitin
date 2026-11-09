import { format, text } from '../i18n/index.ts'
import { MANEUVER_RULES, type BurnDirection, type BurnRecord, type OrbitApsis } from '../simulation/maneuverGame.ts'
import type { ManeuverPanelModel, OrbitFacts } from './maneuverPanelModel.ts'

/** The Interception words and numbers, shared by the desktop drawer and the
 *  phone's game panel. */

export type GoalKey = 'distance' | 'shape' | 'period'
export const GOAL_KEYS: readonly GoalKey[] = ['distance', 'shape', 'period']

export interface GoalLine {
  readonly key: GoalKey
  readonly label: string
  readonly met: boolean
  /** The current difference, or "Done" once met. */
  readonly value: string
}

export const ORBIT_ROWS: readonly { readonly key: keyof OrbitFacts; readonly label: () => string }[] = [
  { key: 'altitudeKm', label: () => text().maneuvers.altitude },
  { key: 'periapsisAltitudeKm', label: () => text().maneuvers.periapsis },
  { key: 'apoapsisAltitudeKm', label: () => text().maneuvers.apoapsis },
  { key: 'periodSeconds', label: () => text().maneuvers.period },
  { key: 'eccentricity', label: () => text().maneuvers.eccentricity },
]

export function directionLabel(direction: BurnDirection): string {
  return direction === 'prograde' ? text().maneuvers.speedUp : text().maneuvers.slowDown
}

export function deltaVText(kmPerSecond: number): string {
  return text().maneuvers.deltaV(format().number(kmPerSecond * 1000, 1))
}

export function distanceText(km: number): string { return format().km(km, km < 10 ? 1 : 0) }

export function orbitValue(facts: OrbitFacts, key: keyof OrbitFacts): string {
  const f = format()
  return key === 'periodSeconds' ? f.duration(facts.periodSeconds) : key === 'eccentricity' ? f.number(facts.eccentricity, 4) : f.km(facts[key], 0)
}

export function goalLines(model: ManeuverPanelModel): readonly GoalLine[] {
  const t = text().maneuvers
  const f = format()
  const goals = model.goals
  const line = (key: GoalKey, label: string, met: boolean, value: string): GoalLine => ({ key, label, met, value: met ? t.met : value })
  const period = f.duration(Math.abs(goals.periodDifferenceSeconds))
  return [
    line('distance', t.goalDistance(f.km(MANEUVER_RULES.winDistanceKm, 0)), goals.distanceMet, t.distanceNow(distanceText(goals.distanceKm))),
    line('shape', t.goalShape, goals.shapeMet, t.shapeNow(f.number(Math.abs(goals.eccentricityDifference), 4))),
    line('period', t.goalPeriod, goals.periodMet, goals.periodDifferenceSeconds > 0 ? t.periodLonger(period) : t.periodShorter(period)),
  ]
}

/** Where the target is along the learner's orbit. */
export function phaseText(model: ManeuverPanelModel): string {
  const angle = format().degrees(Math.abs(model.goals.phaseAngleRad), 1)
  return model.goals.phaseAngleRad >= 0 ? text().maneuvers.ahead(angle) : text().maneuvers.behind(angle)
}

export function tankText(model: ManeuverPanelModel): string {
  return text().maneuvers.tankLeft(deltaVText(model.remainingKmPerSecond), deltaVText(model.tankKmPerSecond))
}

export function burnLine(burn: BurnRecord): string {
  const f = format()
  return text().maneuvers.burnLine(directionLabel(burn.direction), deltaVText(burn.deltaVKmPerSecond), f.km(burn.periapsisAltitudeKm, 0), f.km(burn.apoapsisAltitudeKm, 0))
}

/** How close in simulated time the satellite must be before a mark counts down. */
const APSIS_COUNTDOWN_SECONDS = 600

/** The label on an apogee or perigee mark: its name, then within ten minutes
 *  of arrival the whole minutes left, rounded up so it never says 0. */
export function apsisLabel(apsis: OrbitApsis): string {
  const t = text().maneuvers
  const name = apsis.kind === 'apoapsis' ? t.apogee : t.perigee
  if (apsis.secondsUntil > APSIS_COUNTDOWN_SECONDS) return name
  return t.apsisIn(name, format().minutes(Math.max(1, Math.ceil(apsis.secondsUntil / 60))))
}

/** The game's status line: its result, a burn in progress, or nothing. */
export function statusText(model: ManeuverPanelModel): string {
  const t = text().maneuvers
  const f = format()
  const score = model.score
  if (model.outcome === 'won' && score) return `${t.won} ${t.wonDetail(deltaVText(score.usedKmPerSecond), `${f.number(score.efficiency, 2)}×`, deltaVText(score.referenceKmPerSecond), f.duration(score.elapsedSeconds ?? 0), t.burnCount(score.burnCount))}`
  if (model.outcome === 'reentered') return `${t.reentered} ${t.reenteredDetail}`
  return model.burning ? t.burning(directionLabel(model.burning)) : ''
}

/** The line under the desktop burn buttons while the drawer is closed: a burn
 *  running, then what the last burn did (as the drawer's list says it), the
 *  game's result with where to go on, or an empty tank. */
export function controlsStatusText(model: ManeuverPanelModel): string {
  const t = text().maneuvers
  if (model.outcome === 'won') return `${t.won} ${t.decidedHint}`
  if (model.outcome === 'reentered') return `${t.reentered} ${t.decidedHint}`
  if (model.burning) return t.burning(directionLabel(model.burning))
  const last = model.burns.at(-1)
  const lastLine = last ? t.lastBurn(burnLine(last)) : ''
  if (model.remainingKmPerSecond > 0) return lastLine
  return lastLine ? `${lastLine} ${t.tankEmpty}` : t.tankEmpty
}

/** A game in progress with at least one burn asks before it is replaced. */
export function replacingNeedsConfirmation(model: ManeuverPanelModel | null): boolean {
  return model !== null && model.outcome === null && model.burns.length > 0
}
