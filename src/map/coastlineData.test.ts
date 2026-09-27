import { expect, it, vi } from 'vitest'
// The deployed file itself, so the check covers what ships rather than a copy.
import committedAsset from '../../public/assets/maps/ne_110m_coastline.geojson?raw'
import { COASTLINE_ASSET_URL, decodeCoastlineGeoJson, loadCoastline } from './coastlineData.ts'

/** The exact upstream file recorded in `assets-source/maps/README.md`. */
const COMMITTED_ASSET_SHA256 = '851f581ff5ffb844deed8ae1a9ce22e3c4bb3d74fa342cadb5d8e39b41ae7c3c'
const COMMITTED_ASSET_BYTES = 139907

function collection(...geometries: unknown[]): unknown {
  return { type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', properties: { scalerank: 1 }, geometry })) }
}

function ok(result: ReturnType<typeof decodeCoastlineGeoJson>) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result.data
}

it('decodes LineString and MultiLineString features into immutable line arrays', () => {
  const data = ok(decodeCoastlineGeoJson(collection(
    { type: 'LineString', coordinates: [[0, 0], [10, 5], [20, 10]] },
    { type: 'MultiLineString', coordinates: [[[-30, -1], [-25, -2]], [[40, 60], [45, 62], [50, 63]]] },
  )))
  expect(data.lines.map((line) => line.length)).toEqual([3, 2, 3])
  expect(data.pointCount).toBe(8)
  expect(data.lines[0][1]).toEqual([10, 5])
  expect(Object.isFrozen(data.lines)).toBe(true)
  expect(Object.isFrozen(data.lines[0])).toBe(true)
  expect(Object.isFrozen(data.lines[0][0])).toBe(true)
  // Properties are read but never published.
  expect(Object.keys(data)).toEqual(['lines', 'pointCount'])
})

it('rejects every malformed shape rather than drawing part of it', () => {
  const rejected: unknown[] = [
    null,
    [],
    'not json',
    { type: 'Feature' },
    { type: 'FeatureCollection' },
    { type: 'FeatureCollection', features: {} },
    collection({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [0, 0]]] }),
    collection({ type: 'LineString' }),
    collection({ type: 'LineString', coordinates: [[0]] }),
    collection({ type: 'LineString', coordinates: [[0, 0, 0], [1, 1, 1]] }),
    collection({ type: 'LineString', coordinates: [['0', '0']] }),
    collection({ type: 'LineString', coordinates: [[0, 0], [Number.NaN, 1]] }),
    collection({ type: 'LineString', coordinates: [[0, 0], [181, 1]] }),
    collection({ type: 'LineString', coordinates: [[0, 0], [10, -90.5]] }),
    collection({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], 'x'] }),
    { type: 'FeatureCollection', features: [null] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] },
  ]
  for (const value of rejected) {
    const result = decodeCoastlineGeoJson(value)
    expect(result.ok, `expected rejection for ${JSON.stringify(value)}`).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  }
})

it('splits a coastline line where adjacent longitudes jump more than 180 degrees', () => {
  const data = ok(decodeCoastlineGeoJson(collection(
    { type: 'LineString', coordinates: [[170, 10], [179, 11], [-179, 12], [-170, 13]] },
  )))
  expect(data.lines.map((line) => line.map(([longitude]) => longitude))).toEqual([[170, 179], [-179, -170]])
  // A one-point remainder is not a drawable line and is dropped, not padded.
  const trailing = ok(decodeCoastlineGeoJson(collection({ type: 'LineString', coordinates: [[170, 10], [179, 11], [-179, 12]] })))
  expect(trailing.lines).toHaveLength(1)
  expect(trailing.pointCount).toBe(2)
})

it('returns one unavailable result for a failed request without throwing', async () => {
  const httpFailure = await loadCoastline('assets/maps/missing.geojson', vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)
  expect(httpFailure.ok).toBe(false)

  const network = vi.fn(async () => { throw new Error('offline') })
  const networkFailure = await loadCoastline(COASTLINE_ASSET_URL, network as unknown as typeof fetch)
  expect(networkFailure).toEqual({ ok: false, reason: 'offline' })
  expect(network).toHaveBeenCalledTimes(1)

  const badJson = await loadCoastline(COASTLINE_ASSET_URL, (async () => new Response('{ not json', { status: 200 })) as unknown as typeof fetch)
  expect(badJson.ok).toBe(false)

  const badContent = await loadCoastline(COASTLINE_ASSET_URL, (async () => new Response(JSON.stringify({ type: 'Topology' }), { status: 200 })) as unknown as typeof fetch)
  expect(badContent.ok).toBe(false)

  expect((await loadCoastline(COASTLINE_ASSET_URL, undefined as unknown as typeof fetch)).ok).toBe(false)
})

it('accepts the committed Natural Earth asset and matches its recorded hash', async () => {
  const bytes = new TextEncoder().encode(committedAsset)
  expect(bytes.byteLength).toBe(COMMITTED_ASSET_BYTES)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(hex).toBe(COMMITTED_ASSET_SHA256)
  const data = ok(decodeCoastlineGeoJson(JSON.parse(committedAsset)))
  expect(data.lines.length).toBeGreaterThanOrEqual(134)
  expect(data.pointCount).toBe(5128)
  for (const line of data.lines) {
    expect(line.length).toBeGreaterThanOrEqual(2)
    for (const [longitude, latitude] of line) {
      expect(Math.abs(longitude)).toBeLessThanOrEqual(180)
      expect(Math.abs(latitude)).toBeLessThanOrEqual(90)
    }
  }
})
