import { expect, it } from 'vitest'
import { identityMat3 } from '../core/mat3.ts'
import type { EarthOrientation } from '../core/referenceFrames.ts'
import type { SimulationInstant } from '../core/time.ts'
import type { GroundTrackSegment } from '../simulation/groundTrack.ts'
import { GroundTrackHistoryRecorder } from '../simulation/groundTrackHistory.ts'
import { describe as describeDrawn, planHistoryDraw, type DrawnSegment } from './trackDrawPlan.ts'

const orientation = (instant: SimulationInstant): EarthOrientation => ({
  instant,
  gmstRad: 0,
  precessionToMeanOfDate: identityMat3(),
  projectInertialToEarthFixed: identityMat3(),
  earthFixedToProjectInertial: identityMat3(),
})

/** A circular equatorial motion in the Earth-fixed frame, so the recorder walks
 *  the seam at a known rate and its own segmentation drives the fixtures. */
function stateAt(longitudeRadPerSecond: number, phaseRad = 0) {
  return (instant: SimulationInstant) => ({
    positionProjectInertialKm: {
      x: Math.cos(phaseRad + instant.unixSeconds * longitudeRadPerSecond) * 7000,
      y: Math.sin(phaseRad + instant.unixSeconds * longitudeRadPerSecond) * 7000,
      z: 700,
    },
    velocityProjectInertialKmPerSecond: { x: 0, y: 0, z: 0 },
  })
}

function advance(recorder: GroundTrackHistoryRecorder, unixSeconds: number, rate = 0.02, phase = 0): void {
  recorder.advanceTo({ instant: { unixSeconds }, stateAt: stateAt(rate, phase), earthOrientationAt: orientation })
}

function segment(...longitudes: number[]): GroundTrackSegment {
  return {
    points: longitudes.map((longitudeRad, index) => ({
      instant: { unixSeconds: index },
      directionEarthFixed: { x: 1, y: 0, z: 0 },
      geocentricLatitudeRad: 0,
      geodeticLatitudeRad: 0,
      longitudeRad,
    })),
  }
}

it('appends only the suffix while the open segment grows', () => {
  const recorder = new GroundTrackHistoryRecorder(1)
  advance(recorder, 0)
  advance(recorder, 4)
  const first = recorder.segments
  expect(first).toHaveLength(1)
  const afterFirst = planHistoryDraw(first, null)
  expect(afterFirst.kind).toBe('full')
  if (afterFirst.kind !== 'full') return
  const drawnLength = first[0].points.length

  advance(recorder, 7)
  const grown = recorder.segments
  expect(grown[0].points.length).toBeGreaterThan(drawnLength)
  const plan = planHistoryDraw(grown, afterFirst.drawn)
  expect(plan.kind).toBe('append')
  if (plan.kind !== 'append') return
  expect(plan.pieces).toHaveLength(1)
  expect(plan.pieces[0].segment).toBe(grown[0])
  // The piece restarts at the last drawn point, so the stroke joins the line.
  expect(plan.pieces[0].fromIndex).toBe(drawnLength - 1)
  expect(plan.drawn[0].drawnPoints).toBe(grown[0].points.length)

  // A frame that records nothing costs one comparison and no drawing.
  expect(planHistoryDraw(recorder.segments, plan.drawn).kind).toBe('none')
})

it('closes the old segment and starts the new one separately across a seam', () => {
  // Start just short of the antimeridian so the recorder crosses it.
  const recorder = new GroundTrackHistoryRecorder(1)
  advance(recorder, 0, 0.02, Math.PI - 0.05)
  advance(recorder, 2, 0.02, Math.PI - 0.05)
  const before = recorder.segments
  expect(before).toHaveLength(1)
  const drawn = describeDrawn(before)
  const openArray = before[0].points

  advance(recorder, 8, 0.02, Math.PI - 0.05)
  const after = recorder.segments
  expect(after.length).toBeGreaterThan(1)
  // The closed segment reuses the array that was open, plus its seam endpoint.
  expect(after[0].points).toBe(openArray)
  expect(after[0].points.length).toBeGreaterThan(drawn[0].drawnPoints)

  const plan = planHistoryDraw(after, drawn)
  expect(plan.kind).toBe('append')
  if (plan.kind !== 'append') return
  expect(plan.pieces).toHaveLength(after.length)
  expect(plan.pieces[0]).toEqual({ segment: after[0], fromIndex: drawn[0].drawnPoints - 1 })
  // Everything after the break starts at its own first point, so no stroke ever
  // joins the closing seam endpoint to the opening one on the far edge.
  for (let index = 1; index < plan.pieces.length; index += 1) {
    expect(plan.pieces[index]).toEqual({ segment: after[index], fromIndex: 0 })
  }
  const closing = after[0].points.at(-1)!.longitudeRad!
  const opening = after[1].points[0].longitudeRad!
  expect(Math.abs(closing)).toBeCloseTo(Math.PI, 12)
  expect(opening).toBeCloseTo(-closing, 12)
})

it('redraws in full when the published structure is not an extension', () => {
  const a = segment(0, 0.1, 0.2)
  const b = segment(1, 1.1)
  const c = segment(2, 2.1)
  const drawn = describeDrawn([a, b])

  // A dropped leading segment at the retention cap.
  expect(planHistoryDraw([b, c], drawn).kind).toBe('full')
  // A replaced identity in place.
  expect(planHistoryDraw([segment(0, 0.1, 0.2), b], drawn).kind).toBe('full')
  // A shorter list.
  expect(planHistoryDraw([a], drawn).kind).toBe('full')
  // Reordering.
  expect(planHistoryDraw([b, a], drawn).kind).toBe('full')
  // A completed segment that changed length behind the newest one.
  const shortA: DrawnSegment[] = [{ points: a.points, drawnPoints: 2 }, { points: b.points, drawnPoints: 2 }]
  expect(planHistoryDraw([a, b], shortA).kind).toBe('full')
  // The newest drawn segment shrank in place, which the retention cap can do.
  const longB: DrawnSegment[] = [{ points: a.points, drawnPoints: 3 }, { points: b.points, drawnPoints: 5 }]
  expect(planHistoryDraw([a, b], longB).kind).toBe('full')
})

it('clears an emptied layer once and then stays quiet', () => {
  const drawn = describeDrawn([segment(0, 0.1)])
  const cleared = planHistoryDraw(null, drawn)
  expect(cleared).toEqual({ kind: 'full', drawn: [] })
  expect(planHistoryDraw(null, [])).toEqual({ kind: 'none' })
  expect(planHistoryDraw([], null)).toEqual({ kind: 'none' })
  // A first publication is a full draw onto an empty Canvas.
  const first = planHistoryDraw([segment(0, 0.1)], [])
  expect(first.kind).toBe('full')
})

it('falls back to a full redraw when the retention cap drops recorded segments', () => {
  const recorder = new GroundTrackHistoryRecorder(1, 12)
  advance(recorder, 0, 0.4, Math.PI - 0.05)
  advance(recorder, 40, 0.4, Math.PI - 0.05)
  const early = recorder.segments
  const drawn = describeDrawn(early)
  advance(recorder, 200, 0.4, Math.PI - 0.05)
  expect(recorder.pointCount).toBeLessThanOrEqual(12 + 2)
  expect(recorder.segments[0].points).not.toBe(early[0].points)
  expect(planHistoryDraw(recorder.segments, drawn).kind).toBe('full')
})
