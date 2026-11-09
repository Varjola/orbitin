import { burnSegments, secondsAtTau, segmentIndexAt, tauAtSeconds, type RouteTimeline, type RouteTimelinePoint } from './routeTimeline.ts'

/** Multiples of the automatic timeline. */
export const ROUTE_TIMELINE_FACTORS = [0.25, 0.5, 1, 2, 4] as const
export type RouteTimelineFactor = typeof ROUTE_TIMELINE_FACTORS[number]
/** At a constant rate a burn still holds for this long on screen. */
export const ROUTE_CONSTANT_BURN_SECONDS = 1.5
/** Selecting a burn while paused shows it here in its hold, with its arrows drawn. */
const SHOWN_BURN_PROGRESS = 0.85
/** Two playback times this close are the same place. */
const SAME_TAU = 1e-6

export type RoutePlaybackSpeed =
  | { readonly kind: 'timeline'; readonly factor: RouteTimelineFactor }
  | { readonly kind: 'constant'; readonly rate: number }

export interface RoutePlaybackState {
  /** Playback time on the route's timeline. */
  readonly tau: number
  readonly playing: boolean
  readonly reversed: boolean
  readonly speed: RoutePlaybackSpeed
  /** At the timeline's pace, playback runs on through each burn; without it, it
   *  pauses in each burn it comes to. A constant rate never pauses. */
  readonly autoplay: boolean
}

export const INITIAL_PLAYBACK: RoutePlaybackState = { tau: 0, playing: false, reversed: false, speed: { kind: 'timeline', factor: 1 }, autoplay: true }

/** Simulated seconds per second on screen at this speed, 0 while a burn holds the
 *  clock. The timeline's own rate scales with its factor. */
export function shownRate(state: RoutePlaybackState, point: RouteTimelinePoint): number {
  if (point.burnIndex !== null) return 0
  return state.speed.kind === 'constant' ? state.speed.rate : point.rate * state.speed.factor
}

/** A new route starts at its beginning, paused, at the speed the learner chose. */
export function restartedPlayback(state: RoutePlaybackState): RoutePlaybackState {
  return { ...state, tau: 0, playing: false }
}

function atEnd(state: RoutePlaybackState, timeline: RouteTimeline): boolean {
  return state.reversed ? state.tau <= SAME_TAU : state.tau >= timeline.durationTau - SAME_TAU
}

/** Play starts again from the far end when it is already at the end it plays to. */
export function togglePlaying(state: RoutePlaybackState, timeline: RouteTimeline): RoutePlaybackState {
  if (state.playing) return { ...state, playing: false }
  if (atEnd(state, timeline)) return { ...state, tau: state.reversed ? timeline.durationTau : 0, playing: true }
  return { ...state, playing: true }
}

export function seekPlayback(state: RoutePlaybackState, timeline: RouteTimeline, tau: number): RoutePlaybackState {
  return { ...state, tau: Math.min(timeline.durationTau, Math.max(0, tau)) }
}

/** The start of a burn's hold while playing, so it plays out; while paused, late in
 *  its hold, so its arrows are already drawn. */
export function showBurn(state: RoutePlaybackState, timeline: RouteTimeline, burnIndex: number): RoutePlaybackState {
  const segment = burnSegments(timeline).find((candidate) => candidate.burnIndex === burnIndex)
  if (segment === undefined) return state
  const tau = state.playing ? segment.fromTau : segment.fromTau + SHOWN_BURN_PROGRESS * (segment.toTau - segment.fromTau)
  return { ...state, tau }
}

/** The burn after or before where playback is, in time order whichever way it plays. */
export function adjacentBurn(state: RoutePlaybackState, timeline: RouteTimeline, direction: 1 | -1): number | null {
  const holds = burnSegments(timeline)
  const current = holds.find((segment) => state.tau >= segment.fromTau - SAME_TAU && state.tau <= segment.toTau + SAME_TAU)
  if (direction > 0) return holds.find((segment) => segment.fromTau > state.tau + SAME_TAU && segment !== current)?.burnIndex ?? null
  const earlier = holds.filter((segment) => segment.toTau < state.tau - SAME_TAU && segment !== current)
  return earlier[earlier.length - 1]?.burnIndex ?? null
}

/** Moves playback on by `wallSeconds` of screen time. Reaching either end pauses,
 *  and so does reaching a burn at the timeline's pace without autoplay. */
export function advancePlayback(state: RoutePlaybackState, timeline: RouteTimeline, wallSeconds: number): RoutePlaybackState {
  if (!state.playing || wallSeconds <= 0) return state
  const tau = state.speed.kind === 'timeline'
    ? state.tau + (state.reversed ? -1 : 1) * state.speed.factor * wallSeconds
    : constantRateTau(state.tau, timeline, state.speed.rate, state.reversed, wallSeconds)
  const clamped = Math.min(timeline.durationTau, Math.max(0, tau))
  const stop = state.speed.kind === 'timeline' && !state.autoplay ? burnStop(state.tau, clamped, timeline, state.reversed) : null
  if (stop !== null) return { ...state, tau: stop, playing: false }
  const next = { ...state, tau: clamped }
  return atEnd(next, timeline) ? { ...next, tau: state.reversed ? 0 : timeline.durationTau, playing: false } : next
}

/** Where playback from `start` to `end` stops in a burn it comes to: late in the
 *  hold, with the arrows drawn. Playing on from there goes on. */
function burnStop(start: number, end: number, timeline: RouteTimeline, reversed: boolean): number | null {
  const shown = burnSegments(timeline).map((segment) => segment.fromTau + SHOWN_BURN_PROGRESS * (segment.toTau - segment.fromTau))
  if (!reversed) return shown.find((tau) => tau > start && tau <= end) ?? null
  const passed = shown.filter((tau) => tau < start && tau >= end)
  return passed[passed.length - 1] ?? null
}

/** At a constant rate simulated time runs evenly, except that a burn holds for a
 *  short time on screen however fast the rate. */
function constantRateTau(start: number, timeline: RouteTimeline, rate: number, reversed: boolean, wallSeconds: number): number {
  const direction = reversed ? -1 : 1
  let tau = start
  let remaining = wallSeconds
  for (let guard = 0; guard <= timeline.segments.length + 1 && remaining > 0; guard += 1) {
    const segment = timeline.segments[segmentIndexAt(timeline, tau, reversed)]
    if (segment === undefined) break
    const end = reversed ? segment.fromTau : segment.toTau
    if (Math.abs(end - tau) <= SAME_TAU && (reversed ? tau <= SAME_TAU : tau >= timeline.durationTau - SAME_TAU)) break
    if (segment.kind === 'burn') {
      const holdRate = (segment.toTau - segment.fromTau) / ROUTE_CONSTANT_BURN_SECONDS
      const needed = Math.abs(end - tau) / holdRate
      if (needed > remaining) return tau + direction * holdRate * remaining
      remaining -= needed
      tau = end
      continue
    }
    const at = secondsAtTau(timeline, tau)
    const boundary = reversed ? segment.fromSeconds : segment.toSeconds
    const needed = Math.abs(boundary - at) / rate
    // Kept within the stretch: a step too small to move the seconds would otherwise
    // find the instant's first τ, the start of the burn behind it.
    if (needed > remaining) return Math.min(segment.toTau, Math.max(segment.fromTau, tauAtSeconds(timeline, at + direction * rate * remaining)))
    remaining -= needed
    tau = end
  }
  return tau
}
