/** Optional static basemap: the generalized Natural Earth 1:110m coastline.
 *
 * The asset is geographic context, not operational geometry, and it is
 * deliberately optional. The ocean fill, graticule and every orbital track are
 * procedural, so a missing or invalid file costs the map its coastlines and
 * nothing else. Provenance and the verified SHA-256 are recorded in
 * `assets-source/maps/README.md` and `docs/ground-track-map.md`.
 */

/** One generalized line as `[longitudeDeg, latitudeDeg]` pairs, east-positive. */
export type CoastlineLine = readonly (readonly [number, number])[]

export interface CoastlineData {
  readonly lines: readonly CoastlineLine[]
  readonly pointCount: number
}

export type CoastlineResult =
  | { readonly ok: true; readonly data: CoastlineData }
  | { readonly ok: false; readonly reason: string }

export const COASTLINE_ASSET_URL = 'assets/maps/ne_110m_coastline.geojson'

/** Same defensive rule the track sampler applies to orbital data: an adjacent
 *  pair more than 180 deg apart is a wrap, not a line across the whole map. */
const MAX_LONGITUDE_STEP_DEG = 180

/** Decode strictly. Anything that is not a line collection of finite
 *  longitude/latitude pairs in range is rejected rather than partially drawn. */
export function decodeCoastlineGeoJson(value: unknown): CoastlineResult {
  if (!isRecord(value)) return failure('Coastline data is not an object.')
  if (value.type !== 'FeatureCollection') return failure('Coastline data is not a GeoJSON FeatureCollection.')
  if (!Array.isArray(value.features)) return failure('Coastline FeatureCollection has no feature array.')
  const lines: CoastlineLine[] = []
  let pointCount = 0
  for (const feature of value.features) {
    if (!isRecord(feature)) return failure('A coastline feature is not an object.')
    const geometry = feature.geometry
    if (!isRecord(geometry)) return failure('A coastline feature has no geometry.')
    // Properties are ignored on purpose: the map draws no labels, borders or
    // ranked styling from them.
    if (geometry.type === 'LineString') {
      const line = decodeLine(geometry.coordinates)
      if (!line.ok) return line
      pointCount += appendSplitLines(lines, line.line)
    } else if (geometry.type === 'MultiLineString') {
      if (!Array.isArray(geometry.coordinates)) return failure('A MultiLineString has no coordinate array.')
      for (const part of geometry.coordinates) {
        const line = decodeLine(part)
        if (!line.ok) return line
        pointCount += appendSplitLines(lines, line.line)
      }
    } else {
      return failure(`Unsupported coastline geometry type "${String(geometry.type)}".`)
    }
  }
  return { ok: true, data: { lines: Object.freeze(lines), pointCount } }
}

/** Fetch the optional asset once. Never throws into application start-up. */
export async function loadCoastline(
  url: string = COASTLINE_ASSET_URL,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<CoastlineResult> {
  try {
    if (typeof fetchImpl !== 'function') return failure('No fetch implementation is available.')
    const response = await fetchImpl(url)
    if (!response.ok) return failure(`Coastline request failed with HTTP ${response.status}.`)
    return decodeCoastlineGeoJson(await response.json())
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'The coastline asset could not be read.')
  }
}

/** Split one decoded line wherever adjacent longitudes jump more than 180 deg,
 *  and drop anything that is no longer a drawable line. Returns points kept. */
export function appendSplitLines(target: CoastlineLine[], line: readonly (readonly [number, number])[]): number {
  let kept = 0
  let current: (readonly [number, number])[] = []
  const finish = (): void => {
    if (current.length >= 2) {
      target.push(Object.freeze(current) as CoastlineLine)
      kept += current.length
    }
    current = []
  }
  for (const coordinate of line) {
    const previous = current[current.length - 1]
    if (previous && Math.abs(coordinate[0] - previous[0]) > MAX_LONGITUDE_STEP_DEG) finish()
    current.push(coordinate)
  }
  finish()
  return kept
}

export function decodeLine(value: unknown): { ok: true; line: (readonly [number, number])[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return failure('A coastline geometry has no coordinate array.')
  const line: (readonly [number, number])[] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return failure('A coastline coordinate is not a longitude/latitude pair.')
    const [longitude, latitude] = entry
    if (typeof longitude !== 'number' || typeof latitude !== 'number') return failure('A coastline coordinate is not numeric.')
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return failure('A coastline coordinate is not finite.')
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return failure('A coastline coordinate is out of range.')
    line.push(Object.freeze([longitude, latitude]) as readonly [number, number])
  }
  return { ok: true, line }
}

function failure(reason: string): { ok: false; reason: string } {
  return { ok: false, reason }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
