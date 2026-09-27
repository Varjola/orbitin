import type { GroundTrackSegment, SubSatellitePoint } from '../simulation/groundTrack.ts'

/** The map's content rectangle in CSS pixels. Drawing applies the clamped
 *  device-pixel-ratio transform separately, so nothing here is a backing-store
 *  coordinate. */
export interface MapBounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface MapPoint {
  readonly x: number
  readonly y: number
}

/** A drawable polyline in map coordinates, produced from exactly one domain
 *  segment. Two segments are never joined here: the antimeridian, pole and
 *  failure breaks are decided in `simulation/groundTrack.ts` and this module
 *  only honours them. */
export interface MapPolyline {
  readonly points: readonly MapPoint[]
}

/** Where the exact current sub-satellite point belongs on the map.
 *
 * `poleEdge` exists because longitude is undefined at a pole while an
 * equirectangular map expands that one physical point into an entire edge. A
 * centred dot there would be an invented longitude, so the view draws the edge
 * instead. */
export type CurrentPointPlacement =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'poleEdge'; readonly y: number; readonly left: number; readonly right: number }

export const MAP_ASPECT_RATIO = 2

/** True when the rectangle can hold at least one pixel in each direction. */
export function isDrawableBounds(bounds: MapBounds): boolean {
  return Number.isFinite(bounds.left) && Number.isFinite(bounds.top) &&
    Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
    bounds.width >= 1 && bounds.height >= 1
}

/** Project one east-positive longitude and geodetic latitude onto the map.
 *
 * `-PI` lands exactly on the left edge and a paired closing `+PI` exactly on
 * the right edge, so a seam-split pair terminates on opposite borders instead
 * of wrapping back across the map. Out-of-range or non-finite input returns
 * null rather than a NaN coordinate the Canvas would silently swallow.
 */
export function projectGeodetic(longitudeRad: number, geodeticLatitudeRad: number, bounds: MapBounds): MapPoint | null {
  if (!isDrawableBounds(bounds)) return null
  if (!Number.isFinite(longitudeRad) || !Number.isFinite(geodeticLatitudeRad)) return null
  if (longitudeRad < -Math.PI || longitudeRad > Math.PI) return null
  if (geodeticLatitudeRad < -Math.PI / 2 || geodeticLatitudeRad > Math.PI / 2) return null
  return projectGeodeticUnwrapped(longitudeRad, geodeticLatitudeRad, bounds)
}

/** Like projectGeodetic, but longitude may lie outside -PI..PI so a translated
 * copy of a shape can extend past a map edge and be clipped by the caller. */
export function projectGeodeticUnwrapped(longitudeRad: number, geodeticLatitudeRad: number, bounds: MapBounds): MapPoint | null {
  if (!isDrawableBounds(bounds)) return null
  if (!Number.isFinite(longitudeRad) || !Number.isFinite(geodeticLatitudeRad)) return null
  if (geodeticLatitudeRad < -Math.PI / 2 || geodeticLatitudeRad > Math.PI / 2) return null
  return {
    x: bounds.left + (longitudeRad + Math.PI) / (2 * Math.PI) * bounds.width,
    y: bounds.top + (Math.PI / 2 - geodeticLatitudeRad) / Math.PI * bounds.height,
  }
}

/** Degrees convenience used by the static basemap, which is geographic data. */
export function projectDegrees(longitudeDeg: number, latitudeDeg: number, bounds: MapBounds): MapPoint | null {
  return projectGeodetic(longitudeDeg * Math.PI / 180, latitudeDeg * Math.PI / 180, bounds)
}

/** Project one domain segment, or null when it cannot be drawn honestly.
 *
 * The map reads `geodeticLatitudeRad`, not the spherical `geocentricLatitudeRad`
 * the 3D globe uses, because the basemap is geographic data.
 *
 * A point whose longitude is undefined is a pole. It is placed on the map edge
 * using the nearest defined longitude **inside its own segment**, so the
 * duplicated outgoing pole follows its outgoing segment rather than the
 * incoming one. A segment with no defined longitude at all is omitted, since
 * every edge position would be an invention.
 */
export function projectGroundTrackSegment(segment: GroundTrackSegment, bounds: MapBounds): MapPolyline | null {
  const points = segment.points
  if (points.length < 2 || !isDrawableBounds(bounds)) return null
  const projected: MapPoint[] = []
  for (let index = 0; index < points.length; index += 1) {
    const longitude = longitudeForPoint(points, index)
    if (longitude === null) return null
    const point = projectGeodetic(longitude, points[index].geodeticLatitudeRad, bounds)
    if (!point) return null
    projected.push(point)
  }
  return { points: projected }
}

/** Project a whole product side - trailing, leading or recorded history. */
export function projectGroundTrackSegments(
  segments: readonly GroundTrackSegment[],
  bounds: MapBounds,
): MapPolyline[] {
  const output: MapPolyline[] = []
  for (const segment of segments) {
    const polyline = projectGroundTrackSegment(segment, bounds)
    if (polyline) output.push(polyline)
  }
  return output
}

/** Place the exact current point, or report the pole edge it belongs to. */
export function placeCurrentPoint(point: SubSatellitePoint, bounds: MapBounds): CurrentPointPlacement | null {
  if (!isDrawableBounds(bounds)) return null
  if (point.longitudeRad === null) {
    const latitude = point.geodeticLatitudeRad
    if (!Number.isFinite(latitude)) return null
    const edge = projectGeodetic(0, latitude >= 0 ? Math.PI / 2 : -Math.PI / 2, bounds)
    if (!edge) return null
    return { kind: 'poleEdge', y: edge.y, left: bounds.left, right: bounds.left + bounds.width }
  }
  const projected = projectGeodetic(point.longitudeRad, point.geodeticLatitudeRad, bounds)
  return projected ? { kind: 'point', x: projected.x, y: projected.y } : null
}

/** Nearest defined longitude within the segment, used only to place a polar
 *  endpoint on an edge. Returns null when the segment defines none. */
function longitudeForPoint(points: readonly SubSatellitePoint[], index: number): number | null {
  const own = points[index].longitudeRad
  if (own !== null) return own
  for (let offset = 1; offset < points.length; offset += 1) {
    const before = index - offset
    if (before >= 0 && points[before].longitudeRad !== null) return points[before].longitudeRad
    const after = index + offset
    if (after < points.length && points[after].longitudeRad !== null) return points[after].longitudeRad
  }
  return null
}
