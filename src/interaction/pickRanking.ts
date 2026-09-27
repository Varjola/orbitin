import type { ScreenPoint } from '../core/screenGeometry.ts'

export { distanceToFlatPolylineCssPx, distanceToPolylineCssPx, pointNearRect, rectOfPoints, type ScreenPoint, type ScreenRect } from '../core/screenGeometry.ts'

/** Pure: no DOM and no three.js. */
export const CLICK_SLOP_CSS_PX = 5
export const MARKER_PICK_RADIUS_CSS_PX = 10
export const MARKER_PICK_MARGIN_CSS_PX = 4
export const PATH_PICK_RADIUS_CSS_PX = 6
export const AMBIGUITY_SEPARATION_CSS_PX = 4
export const CHOOSER_MAX_ENTRIES = 8

/** Pick tolerances by pointer. A finger is imprecise
 *  and covers what it touches, so touch and pen get larger ones; mouse keeps
 *  the values above in both presentations. */
export interface PickTolerances {
  readonly slopCssPx: number
  readonly markerMinimumCssPx: number
  readonly markerPadCssPx: number
  readonly pathCssPx: number
  readonly mapMarkerCssPx: number
  readonly mapTrackCssPx: number
}
export const MOUSE_PICK_TOLERANCES: PickTolerances = { slopCssPx: CLICK_SLOP_CSS_PX, markerMinimumCssPx: MARKER_PICK_RADIUS_CSS_PX, markerPadCssPx: MARKER_PICK_MARGIN_CSS_PX, pathCssPx: PATH_PICK_RADIUS_CSS_PX, mapMarkerCssPx: 8, mapTrackCssPx: 5 }
export const TOUCH_PICK_TOLERANCES: PickTolerances = { slopCssPx: 10, markerMinimumCssPx: 22, markerPadCssPx: 8, pathCssPx: 14, mapMarkerCssPx: 16, mapTrackCssPx: 12 }
export function pickTolerances(pointerType: string): PickTolerances {
  return pointerType === 'touch' || pointerType === 'pen' ? TOUCH_PICK_TOLERANCES : MOUSE_PICK_TOLERANCES
}

export type PickHitKind = 'marker' | 'path' | 'mapMarker' | 'mapTrack'
export interface PickHit {
  readonly objectId: string
  readonly kind: PickHitKind
  readonly distanceCssPx: number
  /** Camera distance for 3D hits; the neutral 0 for every map hit. */
  readonly depth: number
}
export interface RankedPick {
  readonly candidates: readonly PickHit[]
  readonly ambiguous: boolean
}

/** `marker` and `mapMarker` are marker-class; `path` and `mapTrack` are line-class. */
export function isMarkerClass(kind: PickHitKind): boolean { return kind === 'marker' || kind === 'mapMarker' }

/** The 3D marker hit radius: the pick floor or the drawn radius plus a margin. */
export function markerPickRadiusCssPx(renderedRadiusCssPx: number, tolerances: PickTolerances = MOUSE_PICK_TOLERANCES): number {
  return Math.max(tolerances.markerMinimumCssPx, (Number.isFinite(renderedRadiusCssPx) ? renderedRadiusCssPx : 0) + tolerances.markerPadCssPx)
}

/** Deterministic order: marker-class first, then screen distance, then depth
 *  (nearer first), then object id in ordinal string order. */
export function comparePickHits(a: PickHit, b: PickHit): number {
  const classOrder = Number(!isMarkerClass(a.kind)) - Number(!isMarkerClass(b.kind))
  if (classOrder !== 0) return classOrder
  if (a.distanceCssPx !== b.distanceCssPx) return a.distanceCssPx - b.distanceCssPx
  if (a.depth !== b.depth) return a.depth - b.depth
  return a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0
}

/** One entry per object (its best hit), ranked, with the ambiguity verdict. */
export function rankPickHits(hits: readonly PickHit[]): RankedPick {
  const best = new Map<string, PickHit>()
  for (const hit of hits) {
    const current = best.get(hit.objectId)
    if (!current || comparePickHits(hit, current) < 0) best.set(hit.objectId, hit)
  }
  const candidates = [...best.values()].sort(comparePickHits)
  return { candidates, ambiguous: isAmbiguous(candidates) }
}

function isAmbiguous(candidates: readonly PickHit[]): boolean {
  if (candidates.length <= 1) return false
  const [first] = candidates
  if (!isMarkerClass(first.kind)) return true
  // A clear nearest marker wins over line-class hits and far markers.
  return candidates.some((candidate, index) => index > 0 && isMarkerClass(candidate.kind) && candidate.distanceCssPx - first.distanceCssPx < AMBIGUITY_SEPARATION_CSS_PX)
}

/** A press and release within the slop is a click; anything more is camera
 *  navigation and never changes selection. */
export function isClick(down: ScreenPoint, up: ScreenPoint, tolerances: PickTolerances = MOUSE_PICK_TOLERANCES): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= tolerances.slopCssPx
}
