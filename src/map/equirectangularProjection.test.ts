import { expect, it } from 'vitest'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import type { GroundTrackSegment, SubSatellitePoint } from '../simulation/groundTrack.ts'
import { segmentGroundTrackSamples, subSatellitePointFromEarthFixed } from '../simulation/groundTrack.ts'
import {
  isDrawableBounds,
  placeCurrentPoint,
  projectDegrees,
  projectGeodetic,
  projectGeodeticUnwrapped,
  projectGroundTrackSegment,
  projectGroundTrackSegments,
  type MapBounds,
} from './equirectangularProjection.ts'

const BOUNDS: MapBounds = { left: 0, top: 0, width: 768, height: 384 }

/** A synthetic point, so a fixture can set the two latitudes independently and
 *  catch a projection that reads the spherical value. */
function point(longitudeRad: number | null, geodeticLatitudeRad: number, geocentricLatitudeRad = geodeticLatitudeRad): SubSatellitePoint {
  return {
    instant: { unixSeconds: 0 },
    directionEarthFixed: { x: 1, y: 0, z: 0 } as EarthFixedVec3,
    geocentricLatitudeRad,
    geodeticLatitudeRad,
    longitudeRad,
  }
}

function segment(...points: SubSatellitePoint[]): GroundTrackSegment {
  return { points }
}

it('maps the seam, centre and poles to exact edges of the content rectangle', () => {
  expect(projectGeodetic(-Math.PI, 0, BOUNDS)).toEqual({ x: 0, y: 192 })
  expect(projectGeodetic(0, 0, BOUNDS)).toEqual({ x: 384, y: 192 })
  // A paired closing +PI belongs on the right border, not wrapped back to the left.
  expect(projectGeodetic(Math.PI, 0, BOUNDS)).toEqual({ x: 768, y: 192 })
  expect(projectGeodetic(0, Math.PI / 2, BOUNDS)).toEqual({ x: 384, y: 0 })
  expect(projectGeodetic(0, -Math.PI / 2, BOUNDS)).toEqual({ x: 384, y: 384 })
  expect(projectGeodetic(-Math.PI, Math.PI / 2, BOUNDS)).toEqual({ x: 0, y: 0 })
  expect(projectGeodetic(Math.PI, -Math.PI / 2, BOUNDS)).toEqual({ x: 768, y: 384 })
})

it('scales with arbitrary offsets and sizes without changing normalized position', () => {
  const offset: MapBounds = { left: 17.5, top: -4.25, width: 321, height: 160.5 }
  for (const [longitudeDeg, latitudeDeg] of [[-180, 90], [-90, 45], [0, 0], [90, -45], [180, -90]]) {
    const reference = projectDegrees(longitudeDeg, latitudeDeg, BOUNDS)!
    const scaled = projectDegrees(longitudeDeg, latitudeDeg, offset)!
    expect((scaled.x - offset.left) / offset.width).toBeCloseTo((reference.x - BOUNDS.left) / BOUNDS.width, 12)
    expect((scaled.y - offset.top) / offset.height).toBeCloseTo((reference.y - BOUNDS.top) / BOUNDS.height, 12)
  }
})

it('rejects non-finite, out-of-range and undrawable input instead of drawing NaN', () => {
  expect(projectGeodetic(Number.NaN, 0, BOUNDS)).toBeNull()
  expect(projectGeodetic(0, Number.NaN, BOUNDS)).toBeNull()
  expect(projectGeodetic(Number.POSITIVE_INFINITY, 0, BOUNDS)).toBeNull()
  expect(projectGeodetic(Math.PI + 1e-9, 0, BOUNDS)).toBeNull()
  expect(projectGeodetic(-Math.PI - 1e-9, 0, BOUNDS)).toBeNull()
  expect(projectGeodetic(0, Math.PI / 2 + 1e-9, BOUNDS)).toBeNull()
  expect(projectGeodetic(0, 0, { left: 0, top: 0, width: 0, height: 384 })).toBeNull()
  expect(projectGeodetic(0, 0, { left: 0, top: 0, width: 768, height: 0.5 })).toBeNull()
  expect(isDrawableBounds({ left: 0, top: 0, width: 1, height: 1 })).toBe(true)
  expect(isDrawableBounds({ left: Number.NaN, top: 0, width: 768, height: 384 })).toBe(false)
})

it('projects unwrapped longitudes beyond the visible world for clipped copies', () => {
  expect(projectGeodeticUnwrapped(-Math.PI, 0, BOUNDS)).toEqual({ x: 0, y: 192 })
  expect(projectGeodeticUnwrapped(Math.PI, 0, BOUNDS)).toEqual({ x: 768, y: 192 })
  expect(projectGeodeticUnwrapped(3 * Math.PI, 0, BOUNDS)).toEqual({ x: 1536, y: 192 })
  expect(projectGeodeticUnwrapped(Number.NaN, 0, BOUNDS)).toBeNull()
  expect(projectGeodeticUnwrapped(0, Math.PI / 2 + 1e-9, BOUNDS)).toBeNull()
})

it('draws a paired antimeridian crossing as two edge-ending paths and never one chord across the map', () => {
  const earthFixed = (x: number, y: number, z: number): EarthFixedVec3 => ({ x, y, z })
  for (const direction of [1, -1]) {
    // An eastward and a westward crossing of the +/-180 seam.
    const samples = [-0.25, -0.1, 0.1, 0.25].map((offset, index) =>
      subSatellitePointFromEarthFixed(
        earthFixed(
          Math.cos(Math.PI + direction * offset) * 7000,
          Math.sin(Math.PI + direction * offset) * 7000,
          800 * offset,
        ),
        { unixSeconds: index },
      )!)
    const segments = segmentGroundTrackSamples(samples)
    expect(segments).toHaveLength(2)
    const polylines = projectGroundTrackSegments(segments, BOUNDS)
    expect(polylines).toHaveLength(2)
    const edges = polylines.map((line) => [line.points[0].x, line.points.at(-1)!.x])
    // One path ends on an edge and the other starts on the opposite edge.
    expect(edges.flat()).toContain(0)
    expect(edges.flat()).toContain(768)
    for (const line of polylines) {
      for (let index = 1; index < line.points.length; index += 1) {
        expect(Math.abs(line.points[index].x - line.points[index - 1].x)).toBeLessThan(BOUNDS.width / 2)
      }
    }
  }
})

it('places incoming and outgoing polar endpoints from their own segment longitude', () => {
  const incoming = segment(point(Math.PI / 2, 1), point(null, Math.PI / 2))
  const outgoing = segment(point(null, Math.PI / 2), point(-Math.PI / 2, 1))
  const east = projectGeodetic(Math.PI / 2, 0, BOUNDS)!.x
  const west = projectGeodetic(-Math.PI / 2, 0, BOUNDS)!.x
  expect(projectGroundTrackSegment(incoming, BOUNDS)!.points.at(-1)).toEqual({ x: east, y: 0 })
  expect(projectGroundTrackSegment(outgoing, BOUNDS)!.points[0]).toEqual({ x: west, y: 0 })
  // Two consecutive polar samples still reach the first defined longitude.
  const doubled = segment(point(null, Math.PI / 2), point(null, Math.PI / 2), point(-Math.PI / 2, 1))
  expect(projectGroundTrackSegment(doubled, BOUNDS)!.points[0].x).toBe(west)
})

it('omits a segment whose longitude is undefined throughout', () => {
  expect(projectGroundTrackSegment(segment(point(null, Math.PI / 2), point(null, Math.PI / 2)), BOUNDS)).toBeNull()
  expect(projectGroundTrackSegments([segment(point(null, 0), point(null, 0)), segment(point(0, 0), point(1, 0))], BOUNDS)).toHaveLength(1)
  // A single point is not a line, and an undrawable rectangle produces nothing.
  expect(projectGroundTrackSegment(segment(point(0, 0)), BOUNDS)).toBeNull()
  expect(projectGroundTrackSegment(segment(point(0, 0), point(1, 0)), { left: 0, top: 0, width: 0, height: 0 })).toBeNull()
})

it('shows an exact polar current point as a map edge rather than a fabricated dot', () => {
  const north = placeCurrentPoint(point(null, Math.PI / 2), BOUNDS)
  expect(north).toEqual({ kind: 'poleEdge', y: 0, left: 0, right: 768 })
  const south = placeCurrentPoint(point(null, -Math.PI / 2), BOUNDS)
  expect(south).toEqual({ kind: 'poleEdge', y: 384, left: 0, right: 768 })
  expect(placeCurrentPoint(point(Math.PI / 4, 0), BOUNDS)).toEqual({ kind: 'point', x: 480, y: 192 })
  expect(placeCurrentPoint(point(0, 0), { left: 0, top: 0, width: 0, height: 0 })).toBeNull()
})

it('reads the geodetic latitude, so a spherical value cannot be substituted unnoticed', () => {
  // The two latitudes differ by about 0.19 deg at 45 deg; the fixture makes the
  // gap large so a swapped field cannot pass as rounding.
  const deliberate = segment(point(0, Math.PI / 4, 0), point(0.1, Math.PI / 4, 0))
  const projected = projectGroundTrackSegment(deliberate, BOUNDS)!
  expect(projected.points[0].y).toBeCloseTo(projectGeodetic(0, Math.PI / 4, BOUNDS)!.y, 12)
  expect(projected.points[0].y).not.toBeCloseTo(projectGeodetic(0, 0, BOUNDS)!.y, 6)
  expect(placeCurrentPoint(point(0, Math.PI / 4, 0), BOUNDS)).toEqual({ kind: 'point', x: 384, y: 96 })
})
