import { expect, it } from 'vitest'
import { AMBIGUITY_SEPARATION_CSS_PX, CLICK_SLOP_CSS_PX, comparePickHits, distanceToPolylineCssPx, isClick, isMarkerClass, markerPickRadiusCssPx, rankPickHits, type PickHit } from './pickRanking.ts'

const hit = (objectId: string, kind: PickHit['kind'], distanceCssPx: number, depth = 0): PickHit => ({ objectId, kind, distanceCssPx, depth })

it('classes map markers with markers and map tracks with paths', () => {
  expect(['marker', 'mapMarker', 'path', 'mapTrack'].map((kind) => isMarkerClass(kind as PickHit['kind']))).toEqual([true, true, false, false])
})

it('ranks marker-class before line-class, then distance, then depth, then id', () => {
  const ranked = rankPickHits([
    hit('path-near', 'path', 0.5, 1),
    hit('marker-far', 'marker', 8, 5),
    hit('marker-near-deep', 'marker', 3, 9),
    hit('marker-near-shallow', 'marker', 3, 2),
    hit('b', 'marker', 20, 1),
    hit('a', 'marker', 20, 1),
  ])
  expect(ranked.candidates.map((candidate) => candidate.objectId)).toEqual(['marker-near-shallow', 'marker-near-deep', 'marker-far', 'a', 'b', 'path-near'])
  // Map hits carry the neutral depth 0, so ties fall straight to the id.
  expect(rankPickHits([hit('m2', 'mapTrack', 2), hit('m1', 'mapTrack', 2)]).candidates.map((candidate) => candidate.objectId)).toEqual(['m1', 'm2'])
  expect(comparePickHits(hit('x', 'mapMarker', 9), hit('y', 'mapTrack', 0))).toBeLessThan(0)
})

it('keeps one entry per object, its best hit', () => {
  const ranked = rankPickHits([hit('a', 'path', 1, 1), hit('a', 'marker', 7, 1), hit('b', 'path', 0.5, 1)])
  expect(ranked.candidates).toEqual([hit('a', 'marker', 7, 1), hit('b', 'path', 0.5, 1)])
})

it('applies every ambiguity rule', () => {
  expect(rankPickHits([]).ambiguous).toBe(false)
  // Exactly one distinct object.
  expect(rankPickHits([hit('a', 'marker', 3), hit('a', 'path', 1)]).ambiguous).toBe(false)
  // A clear nearest marker; line-class hits do not make it ambiguous.
  expect(rankPickHits([hit('a', 'marker', 1), hit('b', 'marker', 1 + AMBIGUITY_SEPARATION_CSS_PX), hit('c', 'path', 0)]).ambiguous).toBe(false)
  // Two markers closer than the separation.
  expect(rankPickHits([hit('a', 'marker', 1), hit('b', 'marker', 1 + AMBIGUITY_SEPARATION_CSS_PX - 0.01)]).ambiguous).toBe(true)
  // No markers and exactly one path: not ambiguous; two paths (a shared plane): ambiguous.
  expect(rankPickHits([hit('a', 'path', 2)]).ambiguous).toBe(false)
  expect(rankPickHits([hit('a', 'path', 2), hit('b', 'path', 2.5)]).ambiguous).toBe(true)
  expect(rankPickHits([hit('a', 'mapTrack', 2), hit('b', 'mapTrack', 4)]).ambiguous).toBe(true)
  expect(rankPickHits([hit('a', 'mapMarker', 1), hit('b', 'mapMarker', 6)]).ambiguous).toBe(false)
})

it('treats a press and release within the slop as a click and anything more as a drag', () => {
  expect(isClick({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true)
  expect(isClick({ x: 10, y: 10 }, { x: 10 + CLICK_SLOP_CSS_PX, y: 10 })).toBe(true)
  expect(isClick({ x: 10, y: 10 }, { x: 10 + CLICK_SLOP_CSS_PX + 0.1, y: 10 })).toBe(false)
})

it('uses the pick floor or the drawn radius plus a margin for markers', () => {
  expect(markerPickRadiusCssPx(4)).toBe(10)
  expect(markerPickRadiusCssPx(9)).toBe(13)
  expect(markerPickRadiusCssPx(Number.NaN)).toBe(10)
})

it('measures the distance to a polyline, including its end caps', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
  expect(distanceToPolylineCssPx({ x: 5, y: 3 }, line)).toBe(3)
  expect(distanceToPolylineCssPx({ x: 13, y: 14 }, line)).toBe(5)
  expect(distanceToPolylineCssPx({ x: 1, y: 1 }, [{ x: 0, y: 0 }])).toBe(Infinity)
})
