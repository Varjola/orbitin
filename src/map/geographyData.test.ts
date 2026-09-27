import { expect, it, vi } from 'vitest'
// The deployed files themselves, so the checks cover what ships.
import landAsset from '../../public/assets/maps/ne_50m_land.geojson?raw'
import lakesAsset from '../../public/assets/maps/ne_110m_lakes.geojson?raw'
import boundariesAsset from '../../public/assets/maps/ne_50m_admin_0_boundary_lines_land.geojson?raw'
import { decodeBoundaryGeoJson, decodePolygonGeoJson, isDisputedBoundaryClass, loadGeography, type GeographyResult } from './geographyData.ts'

/** The exact upstream files recorded in `assets-source/maps/README.md`. */
const ASSETS = [
  { name: 'land', text: landAsset, bytes: 1636166, sha256: 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b' },
  { name: 'lakes', text: lakesAsset, bytes: 36648, sha256: 'eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9' },
  { name: 'boundaries', text: boundariesAsset, bytes: 760189, sha256: '2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48' },
]

function collection(...features: { geometry: unknown; properties?: unknown }[]): unknown {
  return { type: 'FeatureCollection', features: features.map((feature) => ({ type: 'Feature', properties: feature.properties ?? {}, geometry: feature.geometry })) }
}

function ok<T>(result: GeographyResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result.data
}

const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
const hole = [[2, 2], [4, 2], [4, 4], [2, 2]]

it('decodes Polygon and MultiPolygon features with their holes', () => {
  const data = ok(decodePolygonGeoJson(collection(
    { geometry: { type: 'Polygon', coordinates: [square, hole] } },
    { geometry: { type: 'MultiPolygon', coordinates: [[square], [square]] } },
  )))
  expect(data.polygons.map((polygon) => polygon.length)).toEqual([2, 1, 1])
  expect(data.pointCount).toBe(19)
  expect(Object.isFrozen(data.polygons[0])).toBe(true)
})

it('rejects malformed polygons rather than filling part of them', () => {
  const rejected = [
    null,
    { type: 'FeatureCollection' },
    collection({ geometry: { type: 'LineString', coordinates: square } }),
    collection({ geometry: { type: 'Polygon', coordinates: [] } }),
    collection({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } }),
    collection({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [200, 0]]] } }),
    collection({ geometry: null }),
  ]
  for (const value of rejected) expect(decodePolygonGeoJson(value).ok, JSON.stringify(value)).toBe(false)
})

it('marks every boundary class other than an international boundary as disputed', () => {
  expect(isDisputedBoundaryClass('International boundary (verify)')).toBe(false)
  for (const featureClass of ['Disputed (please verify)', 'Indefinite (please verify)', 'Line of control (please verify)', 'Indeterminant frontier']) {
    expect(isDisputedBoundaryClass(featureClass)).toBe(true)
  }
  const data = ok(decodeBoundaryGeoJson(collection(
    { properties: { FEATURECLA: 'International boundary (verify)' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { properties: { FEATURECLA: 'Line of control (please verify)' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } },
  )))
  expect(data.lines.map((line) => line.disputed)).toEqual([false, true, true])
})

it('splits boundary lines at the antimeridian and rejects malformed ones', () => {
  const data = ok(decodeBoundaryGeoJson(collection({ geometry: { type: 'LineString', coordinates: [[170, 1], [179, 2], [-179, 3], [-170, 4]] } })))
  expect(data.lines).toHaveLength(2)
  expect(decodeBoundaryGeoJson(collection({ geometry: { type: 'Polygon', coordinates: [square] } })).ok).toBe(false)
  expect(decodeBoundaryGeoJson(collection({ geometry: { type: 'LineString', coordinates: [[0, 0], [0, 95]] } })).ok).toBe(false)
})

it('returns a failure for a failed request without throwing', async () => {
  const notFound = await loadGeography('missing.geojson', decodePolygonGeoJson, vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)
  expect(notFound.ok).toBe(false)
  const offline = await loadGeography('x', decodePolygonGeoJson, (async () => { throw new Error('offline') }) as unknown as typeof fetch)
  expect(offline).toEqual({ ok: false, reason: 'offline' })
})

it('accepts the committed Natural Earth assets and matches their recorded hashes', async () => {
  for (const asset of ASSETS) {
    const bytes = new TextEncoder().encode(asset.text)
    expect(bytes.byteLength, asset.name).toBe(asset.bytes)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(hex, asset.name).toBe(asset.sha256)
  }
  expect(ok(decodePolygonGeoJson(JSON.parse(landAsset))).pointCount).toBe(60669)
  expect(ok(decodePolygonGeoJson(JSON.parse(lakesAsset))).polygons.length).toBeGreaterThanOrEqual(24)
  const boundaries = ok(decodeBoundaryGeoJson(JSON.parse(boundariesAsset)))
  expect(boundaries.lines.filter((line) => line.disputed).length).toBeGreaterThanOrEqual(35)
})
