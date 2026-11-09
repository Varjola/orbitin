import { format, text } from '../i18n/index.ts'
import type { RoutePairState, RoutePickRefusal, RoutePlanBlock } from '../app/RoutePlannerController.ts'
import type { RouteSeparation } from '../simulation/route/routeObjects.ts'
import type { RouteBurnRow, RouteListModel, RouteOrbitSummary, RoutePanelModel, RouteResultModel, RouteSideLabel, RouteSideModel } from './routePanelModel.ts'
import { sgp4ElementAgeWarning } from './tleWording.ts'

const HOUR = 3600
const DAY = 86_400
const NEARLY_CIRCULAR_KM = 1

/** Metres per second, with a decimal only while it still means something. */
export function deltaVText(kmPerSecond: number): string {
  const metres = kmPerSecond * 1000
  return `${format().number(metres, Math.abs(metres) < 1000 ? 1 : 0)} m/s`
}

export function burnPartText(kmPerSecond: number): string {
  const metres = kmPerSecond * 1000
  return format().signed(metres, Math.abs(metres) < 1000 ? 1 : 0)
}

/** A time limit, which always lands on whole hours or whole days. */
export function limitText(seconds: number): string {
  const t = text().routePlanner
  return seconds < 2 * DAY ? t.hours(Math.round(seconds / HOUR)) : t.days(Math.round(seconds / DAY))
}

/** A span of a route's time: exact in the short term, days and hours in the long. */
export function spanText(seconds: number): string {
  if (seconds < 2 * DAY) return format().duration(seconds)
  const days = Math.floor(seconds / DAY)
  return text().routePlanner.daysAndHours(days, Math.floor((seconds - days * DAY) / HOUR))
}

export function altitudeText(orbit: RouteOrbitSummary): string {
  const f = format()
  return orbit.apogeeAltitudeKm - orbit.perigeeAltitudeKm < NEARLY_CIRCULAR_KM
    ? f.km(orbit.perigeeAltitudeKm)
    : text().routePlanner.altitudeRange(f.number(orbit.perigeeAltitudeKm), f.km(orbit.apogeeAltitudeKm))
}

/** Things a reader must know before choosing from the routes found, most important first. */
export function listNotes(list: RouteListModel, solving: boolean): readonly string[] {
  const t = text().routePlanner
  const notes: string[] = []
  if (list.outOfDate) notes.push(t.outOfDate)
  if (!list.complete) notes.push(solving ? t.stillSearching : t.stoppedEarly)
  if (list.alreadyThere) notes.push(t.alreadyThere)
  if (!list.withinLimits) notes.push(t.noneWithinLimits)
  if (list.limitedToSeconds !== null) notes.push(t.limitedByClock(spanText(list.limitedToSeconds)))
  return notes
}

/** Things to know about one route before playing it. */
export function routeNotes(route: Pick<RouteResultModel, 'alreadyThere' | 'withinLimits' | 'limits' | 'arrivalSeconds' | 'totalDeltaVKmPerSecond'>): readonly string[] {
  const t = text().routePlanner
  const notes: string[] = []
  if (route.alreadyThere) notes.push(t.alreadyThere)
  const { timeSeconds, deltaVKmPerSecond } = route.limits
  if (timeSeconds !== null && route.arrivalSeconds > timeSeconds) notes.push(t.overTimeLimit(limitText(timeSeconds)))
  if (deltaVKmPerSecond !== null && route.totalDeltaVKmPerSecond > deltaVKmPerSecond) notes.push(t.overFuelLimit(deltaVText(deltaVKmPerSecond)))
  return notes
}

/** A satellite's name: an example's side, or the catalogue's name for it. */
export function sideName(label: RouteSideLabel): string {
  return label.kind === 'example' ? text().routePlanner.examples[label.exampleId][label.side] : label.name
}

/** An object reads "ISS (edited)" once its orbit is changed in the panel. */
export function sideTitle(side: Pick<RouteSideModel, 'label' | 'edited'>): string {
  return side.edited ? text().routePlanner.edited(sideName(side.label)) : sideName(side.label)
}

/** A catalogue object's element age, with the Real Objects warning once it is old. */
export function elementAgeLines(ageSeconds: number | null): readonly string[] {
  if (ageSeconds === null) return []
  const t = text().routePlanner
  const days = format().number(Math.abs(ageSeconds) / DAY, 1)
  const age = ageSeconds >= 0 ? t.elementsOld(days) : t.elementsAhead(days)
  return Math.abs(ageSeconds) > 3 * DAY ? [age, sgp4ElementAgeWarning(ageSeconds)] : [age]
}

export function refusalText(refusal: RoutePickRefusal): string {
  return text().routePlanner.refusals[refusal]
}

export function blockedText(block: RoutePlanBlock): string {
  switch (block) {
    case 'sameObject': return text().routePlanner.sameObject
    case 'clockEnds': return text().routePlanner.clockEnds
  }
}

export function pairText(pair: RoutePairState): string {
  const t = text().routePlanner
  if (pair.kind === 'loading') return t.loadingPair
  return pair.name === null ? t.pairRefused(refusalText(pair.refusal)) : t.pairObjectRefused(pair.name, refusalText(pair.refusal))
}

/** What the live region says about the search, or nothing when it has nothing to say. */
export function statusText(model: RoutePanelModel): string {
  const t = text().routePlanner
  if (model.pair !== null) return pairText(model.pair)
  if (model.status.kind !== 'solving' && model.blocked !== null) return blockedText(model.blocked)
  switch (model.status.kind) {
    case 'solving': return t.searching
    case 'cancelled': return t.cancelled
    case 'failed': return t.failed
    case 'unavailable': return t.unavailable
    case 'idle': return model.noRoute ? t.noRoute : ''
  }
}

/** Height gaps below this read as the same height. */
const SAME_HEIGHT_KM = 0.5
/** Node drift below this, in degrees a day, reads as none. */
const NO_DRIFT_DEG_PER_DAY = 0.0005
const LINE_UP_SHOWN_ABOVE_RAD = Math.PI / 360

/** How far apart the two objects are, one line each, for the panel. */
export function separationLines(separation: RouteSeparation): readonly { readonly label: string; readonly value: string }[] {
  const t = text().routePlanner.separation
  const f = format()
  const gap = separation.altitudeGapKm
  const drift = separation.nodeDriftRadPerDay * 180 / Math.PI
  return [
    { label: t.height, value: Math.abs(gap) < SAME_HEIGHT_KM ? t.sameHeight : gap > 0 ? t.targetHigher(f.km(gap)) : t.targetLower(f.km(-gap)) },
    { label: text().routePlanner.planeAngle, value: f.degrees(separation.planeAngleRad, 1) },
    { label: t.nodeDrift, value: Math.abs(drift) < NO_DRIFT_DEG_PER_DAY ? t.noDrift : t.degreesPerDay(f.number(Math.abs(drift), Math.abs(drift) < 0.1 ? 3 : 2)) },
    // Only once the planes are visibly apart: two planes that are one would line up
    // again only after drifting all the way round.
    ...(separation.lineUpSeconds !== null && separation.planeAngleRad > LINE_UP_SHOWN_ABOVE_RAD ? [{ label: t.lineUp, value: spanText(separation.lineUpSeconds) }] : []),
    { label: t.heightOnly, value: deltaVText(separation.altitudeOnlyKmPerSecond) },
  ]
}

/** A part of a burn smaller than this share of it is left out of its words. */
const PART_SHARE_IN_WORDS = 0.06
/** Changes of height and plane smaller than these are not worth a line. */
const HEIGHT_CHANGE_IN_WORDS_KM = 1
const TURN_IN_WORDS_RAD = Math.PI / 3600

/** A burn's direction in words, as seen riding along with Earth below: its parts,
 *  largest first, each forward or back, left or right, up or down. */
export function burnDirectionText(burn: RouteBurnRow): string {
  const t = text().routePlanner
  const parts = [
    { size: burn.progradeKmPerSecond, words: [t.directions.forward, t.directions.back] },
    { size: burn.normalKmPerSecond, words: [t.directions.left, t.directions.right] },
    { size: burn.outwardKmPerSecond, words: [t.directions.up, t.directions.down] },
  ].filter((part) => Math.abs(part.size) >= PART_SHARE_IN_WORDS * burn.sizeKmPerSecond)
  return parts.sort((a, b) => Math.abs(b.size) - Math.abs(a.size)).map((part) => t.burnPart(deltaVText(Math.abs(part.size)), part.words[part.size >= 0 ? 0 : 1]!)).join(', ')
}

/** What a burn changes: perigee, apogee and plane, each when it changes enough to see. */
export function burnChangeLines(burn: RouteBurnRow): readonly string[] {
  const t = text().routePlanner.changes
  const f = format()
  const lines: string[] = []
  if (Math.abs(burn.after.perigeeAltitudeKm - burn.before.perigeeAltitudeKm) >= HEIGHT_CHANGE_IN_WORDS_KM) lines.push(t.perigee(f.number(burn.before.perigeeAltitudeKm), f.km(burn.after.perigeeAltitudeKm)))
  if (Math.abs(burn.after.apogeeAltitudeKm - burn.before.apogeeAltitudeKm) >= HEIGHT_CHANGE_IN_WORDS_KM) lines.push(t.apogee(f.number(burn.before.apogeeAltitudeKm), f.km(burn.after.apogeeAltitudeKm)))
  if (burn.turnRad >= TURN_IN_WORDS_RAD) lines.push(t.plane(f.degrees(burn.turnRad, burn.turnRad < Math.PI / 18 ? 2 : 1)))
  return lines
}

export function burnOrbitText(burn: RouteBurnRow): string {
  return altitudeText(burn.after)
}
