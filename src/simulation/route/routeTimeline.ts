import type { Route } from './routeModel.ts'

/** Automatic playback takes at most this long at 1×, however long the route. */
export const ROUTE_PLAYBACK_MAX_SECONDS = 60
/** How long a burn holds the simulated clock, so its arrows can be read. */
export const ROUTE_BURN_HOLD_SECONDS = 3
/** The hold when a route has more than `MANY_BURNS` burns. */
export const ROUTE_SHORT_BURN_HOLD_SECONDS = 1.5
const MANY_BURNS = 8
/** Nothing plays slower than this, so a brief arc is not drawn out over a minute. */
export const ROUTE_MIN_RATE = 30
/** A wait gets at least this long on screen, unless the minimum rate shortens it. */
const MIN_WAIT_SECONDS = 1.5
/** Transfers' share of the time left after the burns, when the route also waits. */
const TRANSFER_SHARE = 0.6
/** Waits are weighed by the logarithm of their length over this, so a month does
 *  not swamp a 50 minute arc. */
const WAIT_WEIGHT_SECONDS = 600
/** Rates ease in log space over this much playback time. */
const EASE_SECONDS = 0.5
/** The faster side of a burn slows to this rate as it comes to the burn. */
const BURN_APPROACH_RATE = 60
/** The table's spacing in playback time. */
const SAMPLE_SECONDS = 0.02

export type RouteSegmentKind = 'wait' | 'drift' | 'transfer' | 'burn'

/** A stretch of playback. A burn holds the simulated clock at its instant. */
export interface RouteTimelineSegment {
  readonly kind: RouteSegmentKind
  readonly fromTau: number
  readonly toTau: number
  readonly fromSeconds: number
  readonly toSeconds: number
  /** The burn's place in the route, for a burn. */
  readonly burnIndex: number | null
}

/** Playback time τ against simulated seconds from the route's start: monotonic,
 *  piecewise and built once per route. Pure and without wall time. */
export interface RouteTimeline {
  readonly segments: readonly RouteTimelineSegment[]
  readonly durationTau: number
  readonly arrivalSeconds: number
  /** Sampled τ, strictly increasing, and the simulated seconds at each. */
  readonly taus: readonly number[]
  readonly seconds: readonly number[]
}

/** Where playback is in the route. */
export interface RouteTimelinePoint {
  readonly seconds: number
  /** The burn being held, if any. */
  readonly burnIndex: number | null
  /** How far through the hold, 0 to 1. */
  readonly burnProgress: number
  /** Simulated seconds per playback second here, 0 during a hold. */
  readonly rate: number
}

interface Planned {
  readonly kind: RouteSegmentKind
  readonly fromSeconds: number
  readonly toSeconds: number
  readonly burnIndex: number | null
  playback: number
}

/** Each stretch's playback time, before easing. */
function allocate(route: Route): Planned[] {
  const hold = route.burns.length > MANY_BURNS ? ROUTE_SHORT_BURN_HOLD_SECONDS : ROUTE_BURN_HOLD_SECONDS
  const moving: Planned[] = route.legs
    .filter((leg) => leg.toSeconds > leg.fromSeconds)
    .map((leg) => ({ kind: leg.kind, fromSeconds: leg.fromSeconds, toSeconds: leg.toSeconds, burnIndex: null, playback: 0 }))
  const remaining = Math.max(0, ROUTE_PLAYBACK_MAX_SECONDS - hold * route.burns.length)
  const length = (segment: Planned) => segment.toSeconds - segment.fromSeconds
  const transfers = moving.filter((segment) => segment.kind === 'transfer')
  const waits = moving.filter((segment) => segment.kind === 'wait' || segment.kind === 'drift')
  const waitWeights = waits.map((segment) => Math.log1p(length(segment) / WAIT_WEIGHT_SECONDS))
  const waitWeightSum = waitWeights.reduce((sum, weight) => sum + weight, 0)
  const waitBudget = transfers.length === 0 ? remaining : waits.length === 0 ? 0 : remaining * (1 - TRANSFER_SHARE)
  waits.forEach((segment, index) => { segment.playback = Math.max(MIN_WAIT_SECONDS, waitBudget * waitWeights[index]! / waitWeightSum) })
  const transferBudget = Math.max(0, remaining - waits.reduce((sum, segment) => sum + segment.playback, 0))
  const transferLength = transfers.reduce((sum, segment) => sum + length(segment), 0)
  for (const segment of transfers) segment.playback = transferBudget * length(segment) / transferLength
  // The waits' minimum can take the total past the budget only when there is no transfer left to give.
  const total = moving.reduce((sum, segment) => sum + segment.playback, 0)
  const scale = total > remaining && total > 0 ? remaining / total : 1
  for (const segment of moving) segment.playback = Math.min(segment.playback * scale, length(segment) / ROUTE_MIN_RATE)
  const planned: Planned[] = []
  route.burns.forEach((burn, burnIndex) => {
    for (const segment of moving) if (segment.fromSeconds < burn.atSeconds && !planned.includes(segment)) planned.push(segment)
    planned.push({ kind: 'burn', fromSeconds: burn.atSeconds, toSeconds: burn.atSeconds, burnIndex, playback: hold })
  })
  for (const segment of moving) if (!planned.includes(segment)) planned.push(segment)
  return planned
}

function smoothstep(x: number): number {
  const clamped = Math.min(1, Math.max(0, x))
  return clamped * clamped * (3 - 2 * clamped)
}

/** The rate a neighbour asks the edge of a moving stretch to ease towards. */
function edgeRate(neighbour: Planned | undefined): number {
  if (neighbour === undefined || neighbour.kind === 'burn') return BURN_APPROACH_RATE
  return (neighbour.toSeconds - neighbour.fromSeconds) / neighbour.playback
}

/** The automatic timeline: burns hold, transfers take most of what is left, and
 *  waits the rest by the logarithm of their length. Rates ease in log space within
 *  the faster of two neighbours, and each stretch still ends exactly where it should. */
export function buildAutomaticTimeline(route: Route): RouteTimeline {
  const planned = allocate(route)
  const segments: RouteTimelineSegment[] = []
  const taus: number[] = [0]
  const seconds: number[] = [0]
  let tau = 0
  planned.forEach((segment, index) => {
    const fromTau = tau
    const toTau = tau + segment.playback
    segments.push({ kind: segment.kind, fromTau, toTau, fromSeconds: segment.fromSeconds, toSeconds: segment.toSeconds, burnIndex: segment.burnIndex })
    tau = toTau
    if (segment.playback <= 0) return
    if (segment.kind === 'burn') { taus.push(toTau); seconds.push(segment.toSeconds); return }
    const length = segment.toSeconds - segment.fromSeconds
    const rate = length / segment.playback
    const logRate = Math.log(rate)
    const ease = Math.min(EASE_SECONDS, segment.playback / 2)
    const startLog = Math.log(Math.min(rate, edgeRate(planned[index - 1]))) - logRate
    const endLog = Math.log(Math.min(rate, edgeRate(planned[index + 1]))) - logRate
    const count = Math.max(4, Math.ceil(segment.playback / SAMPLE_SECONDS))
    const step = segment.playback / count
    const weights: number[] = []
    let sum = 0
    for (let sample = 0; sample < count; sample += 1) {
      const u = (sample + 0.5) * step
      const weight = Math.exp(startLog * (1 - smoothstep(u / ease)) + endLog * (1 - smoothstep((segment.playback - u) / ease)))
      weights.push(weight)
      sum += weight
    }
    let cumulative = 0
    for (let sample = 0; sample < count; sample += 1) {
      cumulative += weights[sample]!
      taus.push(sample === count - 1 ? toTau : fromTau + (sample + 1) * step)
      seconds.push(sample === count - 1 ? segment.toSeconds : segment.fromSeconds + length * cumulative / sum)
    }
  })
  return { segments, durationTau: tau, arrivalSeconds: route.arrivalSeconds, taus, seconds }
}

/** The last sample at or before `tau`. */
function sampleBefore(timeline: RouteTimeline, tau: number): number {
  let low = 0
  let high = timeline.taus.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (timeline.taus[middle]! <= tau) low = middle
    else high = middle
  }
  return low
}

/** The segment `tau` is in. At a boundary it is the later one, or the earlier
 *  one when `before` asks for it, as playing in reverse does. */
export function segmentIndexAt(timeline: RouteTimeline, tau: number, before = false): number {
  const { segments } = timeline
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    if (before ? tau <= segment.toTau : tau < segment.toTau) return index
  }
  return segments.length - 1
}

/** Simulated seconds from the route's start at playback time `tau`. */
export function secondsAtTau(timeline: RouteTimeline, tau: number): number {
  const { taus, seconds } = timeline
  if (taus.length < 2 || tau <= 0) return seconds[0]!
  if (tau >= timeline.durationTau) return seconds[seconds.length - 1]!
  const index = sampleBefore(timeline, tau)
  const span = taus[index + 1]! - taus[index]!
  return seconds[index]! + (seconds[index + 1]! - seconds[index]!) * (tau - taus[index]!) / span
}

/** The first playback time at which the route reaches `at` simulated seconds:
 *  at a burn, the start of its hold. */
export function tauAtSeconds(timeline: RouteTimeline, at: number): number {
  const { taus, seconds } = timeline
  if (at <= seconds[0]!) return 0
  if (at >= seconds[seconds.length - 1]!) {
    let index = seconds.length - 1
    while (index > 0 && seconds[index - 1]! >= at) index -= 1
    return taus[index]!
  }
  let low = 0
  let high = seconds.length - 1
  // The first sample at or past `at`.
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (seconds[middle]! >= at) high = middle
    else low = middle
  }
  return taus[low]! + (taus[high]! - taus[low]!) * (at - seconds[low]!) / (seconds[high]! - seconds[low]!)
}

export function timelinePoint(timeline: RouteTimeline, tau: number): RouteTimelinePoint {
  const clamped = Math.min(timeline.durationTau, Math.max(0, tau))
  const segment = timeline.segments[segmentIndexAt(timeline, clamped)]
  const seconds = secondsAtTau(timeline, clamped)
  if (segment?.kind === 'burn') {
    const hold = segment.toTau - segment.fromTau
    return { seconds, burnIndex: segment.burnIndex, burnProgress: hold > 0 ? (clamped - segment.fromTau) / hold : 1, rate: 0 }
  }
  const index = sampleBefore(timeline, Math.min(clamped, timeline.durationTau - 1e-9))
  const span = (timeline.taus[index + 1] ?? 0) - (timeline.taus[index] ?? 0)
  const rate = span > 0 ? ((timeline.seconds[index + 1] ?? 0) - (timeline.seconds[index] ?? 0)) / span : 0
  return { seconds, burnIndex: null, burnProgress: 0, rate }
}

/** Every burn's hold, in order. */
export function burnSegments(timeline: RouteTimeline): readonly RouteTimelineSegment[] {
  return timeline.segments.filter((segment) => segment.kind === 'burn')
}
