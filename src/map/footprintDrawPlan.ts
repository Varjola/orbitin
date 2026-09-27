import type { SubSatellitePoint } from '../simulation/groundTrack.ts'
import type { SphericalSensorCap, SensorSurfacePoint } from '../simulation/sensorFootprint.ts'

export interface FootprintMapCoordinate {
  readonly longitudeRad: number
  readonly geodeticLatitudeRad: number
}

export interface FootprintDrawPlan {
  /** Closed fill polygon in continuous (unwrapped) longitude. Longitudes may
   * lie outside -PI..PI; draw one translated copy per offset. */
  readonly fill: readonly FootprintMapCoordinate[]
  /** The boundary ring in the same unwrapped longitudes. */
  readonly outline: readonly FootprintMapCoordinate[]
  /** Ordinary caps close their outline; pole caps leave it open so the
   * artificial pole edge is never stroked. */
  readonly outlineClosed: boolean
  /** Multiples of 2*PI whose translated copies overlap the visible map. */
  readonly longitudeOffsetsRad: readonly number[]
  readonly northPoleIncluded: boolean
  readonly southPoleIncluded: boolean
}

/** Plan a spherical-cap ring for an equirectangular Canvas. This is
 * presentation-only geometry: it unwraps the already-computed Earth-fixed
 * boundary and lets the Canvas clip translated copies at the map edges. */
export function planFootprintDraw(
  centre: SubSatellitePoint,
  cap: Pick<SphericalSensorCap, 'angularRadiusRad' | 'boundary'>,
): FootprintDrawPlan {
  const boundary = cap.boundary
  const empty = { fill: [], outline: [], outlineClosed: true, longitudeOffsetsRad: [], northPoleIncluded: false, southPoleIncluded: false } as const
  if (boundary.length < 3 || cap.angularRadiusRad <= 0 || !Number.isFinite(cap.angularRadiusRad)) return empty
  const northPoleIncluded = containsPole(centre.directionEarthFixed, 1, cap.angularRadiusRad)
  const southPoleIncluded = containsPole(centre.directionEarthFixed, -1, cap.angularRadiusRad)
  if (northPoleIncluded && southPoleIncluded) return empty
  const coordinates = unwrapBoundary(boundary, centre.longitudeRad ?? 0)
  const outlineClosed = !northPoleIncluded && !southPoleIncluded
  const fill = outlineClosed ? coordinates : [
    ...coordinates,
    { longitudeRad: coordinates[coordinates.length - 1].longitudeRad, geodeticLatitudeRad: northPoleIncluded ? Math.PI / 2 : -Math.PI / 2 },
    { longitudeRad: coordinates[0].longitudeRad, geodeticLatitudeRad: northPoleIncluded ? Math.PI / 2 : -Math.PI / 2 },
  ]
  const longitudes = fill.map((point) => point.longitudeRad)
  const min = Math.min(...longitudes)
  const max = Math.max(...longitudes)
  const period = Math.PI * 2
  const firstOffset = Math.ceil((-Math.PI - max) / period)
  const lastOffset = Math.floor((Math.PI - min) / period)
  const longitudeOffsetsRad: number[] = []
  for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
    const translated = offset * period
    longitudeOffsetsRad.push(translated === 0 ? 0 : translated)
  }
  return { fill, outline: coordinates, outlineClosed, longitudeOffsetsRad, northPoleIncluded, southPoleIncluded }
}

function unwrapBoundary(boundary: readonly SensorSurfacePoint[], centreLongitude: number): FootprintMapCoordinate[] {
  const output: FootprintMapCoordinate[] = []
  let previous = centreLongitude
  for (const point of boundary) {
    const raw = point.longitudeRad ?? previous
    let longitude = raw
    while (longitude - previous > Math.PI) longitude -= Math.PI * 2
    while (longitude - previous < -Math.PI) longitude += Math.PI * 2
    output.push({ longitudeRad: longitude, geodeticLatitudeRad: point.geodeticLatitudeRad })
    previous = longitude
  }
  return output
}

function containsPole(direction: { x: number; y: number; z: number }, sign: 1 | -1, radius: number): boolean {
  const dot = Math.min(1, Math.max(-1, direction.z * sign))
  return Math.acos(dot) <= radius + 1e-12
}
