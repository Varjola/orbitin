import { expect, it } from 'vitest'
import {
  GROUND_TRACK_RECENTER_DENOMINATOR, GROUND_TRACK_REBUILD_MIN_INTERVAL_MS,
  groundTrackNeedsRecenter, groundTrackRebuildAllowed, selectGroundTrackEntry,
} from './groundTrackScheduling.ts'

const period = 6400
const cache = { centreInstant: { unixSeconds: 1000 }, nominalPeriodSeconds: period }
const threshold = period / GROUND_TRACK_RECENTER_DENOMINATOR

// Absolute displacement, so reverse behaves like forward.
it('recentres on absolute displacement and never trusts an unusable period', () => {
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 + threshold * 0.99 }, cache)).toBe(false)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 - threshold * 0.99 }, cache)).toBe(false)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 + threshold * 1.01 }, cache)).toBe(true)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 - threshold * 1.01 }, cache)).toBe(true)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 }, null)).toBe(true)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 }, { ...cache, nominalPeriodSeconds: 0 })).toBe(true)
  expect(groundTrackNeedsRecenter({ unixSeconds: 1000 }, { ...cache, nominalPeriodSeconds: Number.NaN })).toBe(true)
})

it('applies the real-time floor during playback and lets one forced refresh through', () => {
  expect(groundTrackRebuildAllowed(1000, 1000 - GROUND_TRACK_REBUILD_MIN_INTERVAL_MS, false)).toBe(true)
  expect(groundTrackRebuildAllowed(1000, 1000 - GROUND_TRACK_REBUILD_MIN_INTERVAL_MS + 1, false)).toBe(false)
  expect(groundTrackRebuildAllowed(1000, 1000 - GROUND_TRACK_REBUILD_MIN_INTERVAL_MS + 1, true)).toBe(true)
  expect(groundTrackRebuildAllowed(1000, -Infinity, false)).toBe(true)
})

const entry = (id: string, over: Partial<Parameters<typeof selectGroundTrackEntry>[0][number]> = {}) =>
  ({ id, dirty: true, visible: true, lastRebuildAtMs: 0, forced: false, ...over })

it('prefers the selected track, then the oldest window, and skips rate-limited entries', () => {
  const now = 10_000
  expect(selectGroundTrackEntry([entry('a'), entry('b')], 'b', now)!.id).toBe('b')
  // Without a selected candidate the oldest window wins, not insertion order.
  expect(selectGroundTrackEntry(
    [entry('a', { lastRebuildAtMs: 500 }), entry('b', { lastRebuildAtMs: 100 })], null, now)!.id).toBe('b')
  // An entry that never built one is the oldest of all.
  expect(selectGroundTrackEntry(
    [entry('a', { lastRebuildAtMs: 100 }), entry('b', { lastRebuildAtMs: -Infinity })], null, now)!.id).toBe('b')
  // Equal ages keep insertion order so the queue stays deterministic.
  expect(selectGroundTrackEntry([entry('a'), entry('b')], null, now)!.id).toBe('a')
  expect(selectGroundTrackEntry([entry('a', { dirty: false }), entry('b')], 'a', now)!.id).toBe('b')
  expect(selectGroundTrackEntry([entry('a', { visible: false }), entry('b')], 'a', now)!.id).toBe('b')
  expect(selectGroundTrackEntry([entry('a', { dirty: false }), entry('b', { visible: false })], null, now))
    .toBeUndefined()
})

// The defect this ordering exists to prevent: a rate-limited entry must not
// consume the frame's single rebuild slot while another track is starved.
it('does not let a rate-limited selected track block every other queued track', () => {
  const now = 10_000
  const blocked = entry('fast', { lastRebuildAtMs: now - 1 })
  const waiting = entry('slow', { lastRebuildAtMs: -Infinity })
  expect(selectGroundTrackEntry([blocked, waiting], 'fast', now)!.id).toBe('slow')
  expect(selectGroundTrackEntry([blocked], 'fast', now)).toBeUndefined()
  expect(selectGroundTrackEntry([{ ...blocked, forced: true }, waiting], 'fast', now)!.id).toBe('fast')
})
