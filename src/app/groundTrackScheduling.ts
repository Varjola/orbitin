import type { SimulationInstant } from '../core/time.ts'
import type { GroundTrackWindow } from '../simulation/groundTrack.ts'

export const GROUND_TRACK_RECENTER_DENOMINATOR = 128
export const GROUND_TRACK_REBUILD_MIN_INTERVAL_MS = 250

export interface GroundTrackCache {
  readonly window: GroundTrackWindow
  readonly centreInstant: SimulationInstant
  readonly nominalPeriodSeconds: number
  readonly revision: number
  readonly rebuiltAtMs: number
}

export function groundTrackCentreDistanceSeconds(a: SimulationInstant, b: SimulationInstant): number {
  return Math.abs(a.unixSeconds - b.unixSeconds)
}

export function groundTrackNeedsRecenter(
  instant: SimulationInstant,
  cache: Pick<GroundTrackCache, 'centreInstant' | 'nominalPeriodSeconds'> | null,
): boolean {
  if (!cache || !Number.isFinite(cache.nominalPeriodSeconds) || cache.nominalPeriodSeconds <= 0) return true
  return groundTrackCentreDistanceSeconds(instant, cache.centreInstant) > cache.nominalPeriodSeconds / GROUND_TRACK_RECENTER_DENOMINATOR
}

export function groundTrackRebuildAllowed(
  nowMs: number,
  lastRebuildAtMs: number,
  forced: boolean,
): boolean {
  return forced || nowMs - lastRebuildAtMs >= GROUND_TRACK_REBUILD_MIN_INTERVAL_MS
}

export interface GroundTrackQueueEntry {
  readonly id: string
  readonly dirty: boolean
  readonly visible: boolean
  /** `-Infinity` for an entry that has never produced a window. */
  readonly lastRebuildAtMs: number
  readonly forced: boolean
}

/** Selected-first ordering, then the entry whose window is oldest.
 *
 * The real-time floor is part of eligibility rather than a separate test at the
 * call site: a rate-limited entry must not consume the frame's single rebuild
 * slot, or a fast-recentring track at the head of the collection starves every
 * other visible track for as long as it keeps dirtying itself.
 */
export function selectGroundTrackEntry<T extends GroundTrackQueueEntry>(
  entries: readonly T[], selectedId: string | null, nowMs: number,
): T | undefined {
  const eligible = entries.filter((entry) =>
    entry.visible && entry.dirty && groundTrackRebuildAllowed(nowMs, entry.lastRebuildAtMs, entry.forced))
  const selected = eligible.find((entry) => entry.id === selectedId)
  if (selected) return selected
  // Ties keep insertion order, so the queue stays deterministic for tests.
  return eligible.reduce<T | undefined>(
    (oldest, entry) => oldest && oldest.lastRebuildAtMs <= entry.lastRebuildAtMs ? oldest : entry, undefined)
}

