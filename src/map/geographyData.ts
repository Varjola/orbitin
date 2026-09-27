/** Optional geographic layers from unmodified Natural Earth files:
 * land and lake polygons for the Map Earth style, and admin-0 land boundary
 * lines for the country-borders layer on the globe and the 2D map.
 *
 * Like the coastline, these are context rather than operational geometry.
 * They load only when a learner first asks for them, and a missing or invalid
 * file costs that layer and nothing else. Provenance and the verified SHA-256
 * values are in `assets-source/maps/README.md`.
 */
import { appendSplitLines, decodeLine, isRecord, type CoastlineLine } from './coastlineData.ts'

/** A closed ring as `[longitudeDeg, latitudeDeg]` pairs; first equals last. */
export type GeographyRing = readonly (readonly [number, number])[]
/** Outer ring first, then holes. */
export type GeographyPolygon = readonly GeographyRing[]

export interface PolygonData {
  readonly polygons: readonly GeographyPolygon[]
  readonly pointCount: number
}

export interface BoundaryLine {
  readonly points: CoastlineLine
  /** Natural Earth marks the line disputed, indefinite, indeterminate or a
   *  line of control; drawn dashed. */
  readonly disputed: boolean
}

export interface BoundaryData {
  readonly lines: readonly BoundaryLine[]
  readonly pointCount: number
}

export type GeographyResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly reason: string }

export const LAND_ASSET_URL = 'assets/maps/ne_50m_land.geojson'
export const LAKES_ASSET_URL = 'assets/maps/ne_110m_lakes.geojson'
export const BOUNDARIES_ASSET_URL = 'assets/maps/ne_50m_admin_0_boundary_lines_land.geojson'

/** Every `FEATURECLA` other than an agreed international boundary. */
export function isDisputedBoundaryClass(featureClass: unknown): boolean {
  return typeof featureClass === 'string' && !featureClass.startsWith('International boundary')
}

/** Decode strictly: polygons of finite, in-range rings, or nothing. */
export function decodePolygonGeoJson(value: unknown): GeographyResult<PolygonData> {
  const features = featuresOf(value)
  if (!features.ok) return features
  const polygons: GeographyPolygon[] = []
  let pointCount = 0
  for (const feature of features.features) {
    const geometry = feature.geometry
    if (!isRecord(geometry)) return failure('A polygon feature has no geometry.')
    if (!Array.isArray(geometry.coordinates)) return failure('A polygon geometry has no coordinate array.')
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null
    if (!parts) return failure(`Unsupported polygon geometry type "${String(geometry.type)}".`)
    for (const part of parts) {
      if (!Array.isArray(part) || part.length === 0) return failure('A polygon has no rings.')
      const rings: GeographyRing[] = []
      for (const ringValue of part) {
        const ring = decodeLine(ringValue)
        if (!ring.ok) return ring
        if (ring.line.length < 4) return failure('A polygon ring has fewer than four positions.')
        rings.push(Object.freeze(ring.line))
        pointCount += ring.line.length
      }
      polygons.push(Object.freeze(rings))
    }
  }
  return { ok: true, data: { polygons: Object.freeze(polygons), pointCount } }
}

/** Decode boundary lines with their disputed flag; lines that jump across the
 *  antimeridian are split like coastlines. */
export function decodeBoundaryGeoJson(value: unknown): GeographyResult<BoundaryData> {
  const features = featuresOf(value)
  if (!features.ok) return features
  const lines: BoundaryLine[] = []
  let pointCount = 0
  for (const feature of features.features) {
    const geometry = feature.geometry
    if (!isRecord(geometry)) return failure('A boundary feature has no geometry.')
    const properties = isRecord(feature.properties) ? feature.properties : {}
    const disputed = isDisputedBoundaryClass(properties.FEATURECLA ?? properties.featurecla)
    let parts: unknown[]
    if (geometry.type === 'LineString') parts = [geometry.coordinates]
    else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) parts = geometry.coordinates
    else return failure(`Unsupported boundary geometry type "${String(geometry.type)}".`)
    for (const part of parts) {
      const line = decodeLine(part)
      if (!line.ok) return line
      const split: CoastlineLine[] = []
      pointCount += appendSplitLines(split, line.line)
      for (const points of split) lines.push(Object.freeze({ points, disputed }))
    }
  }
  return { ok: true, data: { lines: Object.freeze(lines), pointCount } }
}

/** Fetch and decode one optional asset. Never throws. */
export async function loadGeography<T>(
  url: string,
  decode: (value: unknown) => GeographyResult<T>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GeographyResult<T>> {
  try {
    if (typeof fetchImpl !== 'function') return failure('No fetch implementation is available.')
    const response = await fetchImpl(url)
    if (!response.ok) return failure(`Map data request failed with HTTP ${response.status}.`)
    return decode(await response.json())
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'The map data could not be read.')
  }
}

function featuresOf(value: unknown): { ok: true; features: Record<string, unknown>[] } | { ok: false; reason: string } {
  if (!isRecord(value)) return failure('Map data is not an object.')
  if (value.type !== 'FeatureCollection') return failure('Map data is not a GeoJSON FeatureCollection.')
  if (!Array.isArray(value.features)) return failure('Map FeatureCollection has no feature array.')
  const features: Record<string, unknown>[] = []
  for (const feature of value.features) {
    if (!isRecord(feature)) return failure('A map feature is not an object.')
    features.push(feature)
  }
  return { ok: true, features }
}

function failure(reason: string): { ok: false; reason: string } {
  return { ok: false, reason }
}
