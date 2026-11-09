import { describe, expect, it } from 'vitest'
import type { Route } from './routeModel.ts'
import { adjacentBurn, advancePlayback, INITIAL_PLAYBACK, ROUTE_CONSTANT_BURN_SECONDS, seekPlayback, showBurn, togglePlaying, type RoutePlaybackState } from './routePlayback.ts'
import { buildAutomaticTimeline, burnSegments, ROUTE_BURN_HOLD_SECONDS, ROUTE_MIN_RATE, ROUTE_PLAYBACK_MAX_SECONDS, ROUTE_SHORT_BURN_HOLD_SECONDS, secondsAtTau, tauAtSeconds, timelinePoint } from './routeTimeline.ts'

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400

/** Only the times matter to a timeline. */
function route(stretches: readonly (readonly ['wait' | 'transfer', number])[]): Route {
  const legs: { kind: 'wait' | 'transfer'; fromSeconds: number; toSeconds: number }[] = []
  const burns: { atSeconds: number }[] = []
  let at = 0
  for (const [kind, length] of stretches) {
    if (kind === 'transfer') burns.push({ atSeconds: at })
    legs.push({ kind, fromSeconds: at, toSeconds: at + length })
    at += length
  }
  burns.push({ atSeconds: at })
  return { legs, burns, arrivalSeconds: at } as unknown as Route
}

const ROUTES = {
  'leave at once': route([['transfer', 45 * MINUTE]]),
  'wait, then a transfer': route([['wait', 6 * HOUR], ['transfer', 50 * MINUTE]]),
  'a long-flight phasing': route([['wait', 2 * HOUR], ['transfer', 3 * DAY]]),
  'four months of drift': route([['wait', 120 * DAY], ['transfer', 50 * MINUTE]]),
  'a year': route([['wait', 300 * DAY], ['transfer', 2 * HOUR], ['wait', 60 * DAY], ['transfer', 5 * DAY]]),
  'a brief arc': route([['wait', 5 * MINUTE], ['transfer', 6 * MINUTE]]),
  'many burns': route(Array.from({ length: 10 }, (_, index) => [index % 2 === 0 ? 'wait' : 'transfer', (index + 1) * HOUR] as const)),
}

describe('buildAutomaticTimeline', () => {
  for (const [name, example] of Object.entries(ROUTES)) {
    describe(name, () => {
      const timeline = buildAutomaticTimeline(example)

      it('plays within a minute and ends at arrival', () => {
        expect(timeline.durationTau).toBeLessThanOrEqual(ROUTE_PLAYBACK_MAX_SECONDS + 1e-9)
        expect(secondsAtTau(timeline, timeline.durationTau)).toBe(example.arrivalSeconds)
        expect(secondsAtTau(timeline, 0)).toBe(0)
      })

      it('is monotonic, and its stretches follow each other', () => {
        for (let index = 1; index < timeline.taus.length; index += 1) {
          expect(timeline.taus[index]!).toBeGreaterThan(timeline.taus[index - 1]!)
          expect(timeline.seconds[index]!).toBeGreaterThanOrEqual(timeline.seconds[index - 1]!)
        }
        timeline.segments.forEach((segment, index) => {
          const previous = timeline.segments[index - 1]
          if (previous) { expect(segment.fromTau).toBe(previous.toTau); expect(segment.fromSeconds).toBe(previous.toSeconds) }
          expect(secondsAtTau(timeline, segment.toTau)).toBeCloseTo(segment.toSeconds, 6)
        })
      })

      it('holds each burn at its instant', () => {
        const holds = burnSegments(timeline)
        expect(holds.map((segment) => segment.burnIndex)).toEqual(example.burns.map((_, index) => index))
        const hold = example.burns.length > 8 ? ROUTE_SHORT_BURN_HOLD_SECONDS : ROUTE_BURN_HOLD_SECONDS
        holds.forEach((segment, index) => {
          expect(segment.toTau - segment.fromTau).toBeCloseTo(hold, 12)
          const middle = (segment.fromTau + segment.toTau) / 2
          expect(secondsAtTau(timeline, middle)).toBe(example.burns[index]!.atSeconds)
          expect(timelinePoint(timeline, middle)).toMatchObject({ burnIndex: index, burnProgress: 0.5, rate: 0 })
        })
      })

      it('turns playback time into simulated time and back', () => {
        for (let step = 0; step <= 200; step += 1) {
          const seconds = example.arrivalSeconds * step / 200
          expect(secondsAtTau(timeline, tauAtSeconds(timeline, seconds))).toBeCloseTo(seconds, 3)
          const tau = timeline.durationTau * step / 200
          const point = timelinePoint(timeline, tau)
          // Where a hold ends, the same instant is also where it began.
          if (!example.burns.some((burn) => burn.atSeconds === point.seconds)) expect(tauAtSeconds(timeline, point.seconds)).toBeCloseTo(tau, 6)
        }
      })

      it('never plays slower than the minimum rate, and eases between rates', () => {
        for (const segment of timeline.segments) {
          if (segment.kind === 'burn') continue
          let previous: number | null = null
          for (let tau = segment.fromTau + 0.005; tau < segment.toTau; tau += 0.01) {
            const { rate } = timelinePoint(timeline, tau)
            expect(rate).toBeGreaterThanOrEqual(ROUTE_MIN_RATE * (1 - 1e-9))
            if (previous !== null) expect(Math.max(rate / previous, previous / rate)).toBeLessThan(2)
            previous = rate
          }
        }
      })
    })
  }

  it('gives transfers most of the time and waits the rest, a month never swamping an arc', () => {
    const timeline = buildAutomaticTimeline(ROUTES['four months of drift'])
    const [wait, , transfer] = timeline.segments
    expect(transfer!.toTau - transfer!.fromTau).toBeGreaterThan(wait!.toTau - wait!.fromTau)
    expect(wait!.toTau - wait!.fromTau).toBeGreaterThanOrEqual(1.5)
  })

  it('takes less than a minute for a brief route rather than playing it slowly', () => {
    const timeline = buildAutomaticTimeline(ROUTES['a brief arc'])
    expect(timeline.durationTau).toBeLessThan(2 * ROUTE_BURN_HOLD_SECONDS + 11 * MINUTE / ROUTE_MIN_RATE + 1e-9)
  })

  it('slows towards a burn', () => {
    const timeline = buildAutomaticTimeline(ROUTES['a long-flight phasing'])
    const transfer = timeline.segments[2]!
    const middle = timelinePoint(timeline, (transfer.fromTau + transfer.toTau) / 2).rate
    expect(timelinePoint(timeline, transfer.toTau - 0.01).rate).toBeLessThan(middle / 2)
  })
})

describe('playback', () => {
  const example = ROUTES['wait, then a transfer']
  const timeline = buildAutomaticTimeline(example)
  const playing = (fields: Partial<RoutePlaybackState> = {}): RoutePlaybackState => ({ ...INITIAL_PLAYBACK, playing: true, ...fields })
  const run = (state: RoutePlaybackState, seconds: number) => {
    let next = state
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) next = advancePlayback(next, timeline, Math.min(1 / 60, seconds - elapsed))
    return next
  }

  it('plays the whole route at 1× in its timeline’s length, and pauses at the end', () => {
    const ended = run(playing(), timeline.durationTau + 1)
    expect(ended).toMatchObject({ tau: timeline.durationTau, playing: false })
    expect(run(playing(), timeline.durationTau / 2).tau).toBeCloseTo(timeline.durationTau / 2, 9)
  })

  it('plays forward and back the same, at every timeline speed', () => {
    for (const factor of [0.25, 0.5, 1, 2, 4] as const) {
      const start = playing({ tau: 10, speed: { kind: 'timeline', factor } })
      const forward = run(start, 2)
      expect(forward.tau).toBeCloseTo(10 + 2 * factor, 9)
      expect(run({ ...forward, reversed: true }, 2).tau).toBeCloseTo(10, 9)
    }
  })

  it('runs simulated time evenly at a constant rate, and back the same', () => {
    const start = playing({ tau: 1, speed: { kind: 'constant', rate: 1000 } })
    const from = secondsAtTau(timeline, 1)
    const forward = run(start, 3)
    expect(secondsAtTau(timeline, forward.tau) - from).toBeCloseTo(3000, 3)
    const back = run({ ...forward, reversed: true }, 3)
    expect(back.tau).toBeCloseTo(1, 6)
  })

  it('still holds a burn on screen at a constant rate', () => {
    const [first] = burnSegments(timeline)
    const state = playing({ tau: first!.fromTau, speed: { kind: 'constant', rate: 10 } })
    expect(timelinePoint(timeline, run(state, ROUTE_CONSTANT_BURN_SECONDS - 0.1).tau).burnIndex).toBe(0)
    expect(timelinePoint(timeline, run(state, ROUTE_CONSTANT_BURN_SECONDS + 0.1).tau).burnIndex).toBeNull()
    // However fast the rate, it stops for the hold.
    const fast = playing({ tau: tauAtSeconds(timeline, first!.fromSeconds - 1000), speed: { kind: 'constant', rate: 100_000 } })
    expect(timelinePoint(timeline, run(fast, 0.5).tau).burnIndex).toBe(0)
    const reversed = run({ ...state, tau: first!.toTau + 0.001, reversed: true }, ROUTE_CONSTANT_BURN_SECONDS - 0.1)
    expect(timelinePoint(timeline, reversed.tau).burnIndex).toBe(0)
  })

  it('plays on through every burn with autoplay, as it starts', () => {
    expect(INITIAL_PLAYBACK.autoplay).toBe(true)
    expect(run(playing(), timeline.durationTau + 1)).toMatchObject({ tau: timeline.durationTau, playing: false })
  })

  it('without autoplay, pauses in each burn it comes to with its arrows drawn, and plays on from there', () => {
    const [first, second] = burnSegments(timeline)
    const stopped = run(playing({ autoplay: false }), timeline.durationTau + 1)
    expect(stopped.playing).toBe(false)
    expect(timelinePoint(timeline, stopped.tau)).toMatchObject({ burnIndex: 0 })
    expect(timelinePoint(timeline, stopped.tau).burnProgress).toBeGreaterThan(0.8)
    expect(stopped.tau).toBeLessThan(first!.toTau)
    const next = run({ ...stopped, playing: true }, timeline.durationTau + 1)
    expect(timelinePoint(timeline, next.tau)).toMatchObject({ burnIndex: 1 })
    expect(next.tau).toBeLessThan(second!.toTau)
    // Coming back the other way, it stops in the earlier burn again.
    const back = run({ ...next, playing: true, reversed: true }, timeline.durationTau + 1)
    expect(timelinePoint(timeline, back.tau)).toMatchObject({ burnIndex: 0 })
    expect(back.playing).toBe(false)
  })

  it('never pauses at a burn by hand-set rate, with or without autoplay', () => {
    const state = playing({ autoplay: false, speed: { kind: 'constant', rate: 100_000 } })
    expect(run(state, 60)).toMatchObject({ tau: timeline.durationTau, playing: false })
  })

  it('pauses on reaching the start in reverse, and plays again from the far end', () => {
    const back = run(playing({ tau: 1, reversed: true }), 2)
    expect(back).toMatchObject({ tau: 0, playing: false })
    expect(togglePlaying(back, timeline)).toMatchObject({ tau: timeline.durationTau, playing: true })
    expect(togglePlaying({ ...back, reversed: false }, timeline)).toMatchObject({ tau: 0, playing: true })
  })

  it('steps between burns, and shows a burn with its arrows drawn while paused', () => {
    const holds = burnSegments(timeline)
    const paused = seekPlayback(INITIAL_PLAYBACK, timeline, 0)
    expect(adjacentBurn(paused, timeline, 1)).toBe(0)
    expect(adjacentBurn(paused, timeline, -1)).toBeNull()
    const shown = showBurn(paused, timeline, 0)
    expect(timelinePoint(timeline, shown.tau)).toMatchObject({ burnIndex: 0 })
    expect(timelinePoint(timeline, shown.tau).burnProgress).toBeGreaterThan(0.8)
    expect(adjacentBurn(shown, timeline, 1)).toBe(1)
    expect(adjacentBurn(shown, timeline, -1)).toBeNull()
    expect(showBurn(playing(), timeline, 1).tau).toBe(holds[1]!.fromTau)
    expect(adjacentBurn(seekPlayback(paused, timeline, timeline.durationTau), timeline, -1)).toBe(0)
  })
})
