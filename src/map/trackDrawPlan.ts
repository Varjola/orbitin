import type { GroundTrackSegment, SubSatellitePoint } from '../simulation/groundTrack.ts'

/** What has already been drawn into one object's track Canvas.
 *
 * Identity is the **point array**, not the wrapping segment object. The
 * ground-track recorder publishes one open segment whose array grows in place
 * and then wraps that same array in a fresh completed-segment object when a
 * seam or pole closes it. Keying on the array therefore recognizes the final growth step across
 * that close, while a new segment after the break stays correctly distinct.
 */
export interface DrawnSegment {
  readonly points: readonly SubSatellitePoint[]
  readonly drawnPoints: number
}

/** One polyline piece to add without clearing the Canvas. `fromIndex` is the
 *  last already-drawn point, so the new stroke joins the existing line rather
 *  than starting a visible gap. */
export interface TrackAppendPiece {
  readonly segment: GroundTrackSegment
  readonly fromIndex: number
}

export type TrackDrawPlan =
  /** Nothing changed; the Canvas already shows the current data. */
  | { readonly kind: 'none' }
  /** Add the listed pieces to the existing image. */
  | { readonly kind: 'append'; readonly pieces: readonly TrackAppendPiece[]; readonly drawn: readonly DrawnSegment[] }
  /** Clear and redraw every segment: the published structure is not an
   *  extension of what is on the Canvas. */
  | { readonly kind: 'full'; readonly drawn: readonly DrawnSegment[] }

/** Decide how to bring an object's recorded-history layer up to date.
 *
 * A full redraw of twenty thousand points is affordable but not every frame, so
 * the common case - the open segment gained a few points - appends only the new
 * suffix. Anything that is not a strict extension (a dropped segment at the
 * retention cap, a shrunk open array, a replaced identity, a shorter list)
 * falls back to one full redraw instead of guessing at continuity.
 */
export function planHistoryDraw(
  segments: readonly GroundTrackSegment[] | null,
  drawn: readonly DrawnSegment[] | null,
): TrackDrawPlan {
  const next = segments ?? []
  if (next.length === 0) return drawn && drawn.length > 0 ? { kind: 'full', drawn: [] } : { kind: 'none' }
  if (!drawn || drawn.length === 0) return { kind: 'full', drawn: describe(next) }
  if (next.length < drawn.length) return { kind: 'full', drawn: describe(next) }
  const lastPrevious = drawn.length - 1
  for (let index = 0; index < drawn.length; index += 1) {
    if (next[index].points !== drawn[index].points) return { kind: 'full', drawn: describe(next) }
    const length = next[index].points.length
    // Only the most recently drawn segment may still grow. An earlier one that
    // changed length means the structure was rewritten, not extended.
    if (index < lastPrevious ? length !== drawn[index].drawnPoints : length < drawn[index].drawnPoints) {
      return { kind: 'full', drawn: describe(next) }
    }
  }
  const pieces: TrackAppendPiece[] = []
  if (next[lastPrevious].points.length > drawn[lastPrevious].drawnPoints) {
    pieces.push({ segment: next[lastPrevious], fromIndex: Math.max(0, drawn[lastPrevious].drawnPoints - 1) })
  }
  for (let index = drawn.length; index < next.length; index += 1) pieces.push({ segment: next[index], fromIndex: 0 })
  if (pieces.length === 0) return { kind: 'none' }
  return { kind: 'append', pieces, drawn: describe(next) }
}

/** Snapshot the published structure as the new drawn state. */
export function describe(segments: readonly GroundTrackSegment[]): DrawnSegment[] {
  return segments.map((segment) => ({ points: segment.points, drawnPoints: segment.points.length }))
}
