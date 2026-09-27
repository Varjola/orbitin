import { afterEach, expect, it, vi } from 'vitest'
import { serveCatalogueRequest } from '../shared/serve.ts'
import { CatalogueClient } from '../../src/data/CatalogueClient.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../../src/data/fixtures/automaticCatalogueSnapshot.ts'
import { sha256Hex } from '../../src/data/catalogueSchema.ts'
import type { R2ObjectLike, R2ReadableBucketLike, WorkerExecutionContext } from '../shared/types.ts'

const SNAPSHOT_ID = '20260915T121735Z-488911569f14'
const LEGACY_ID = '20260913T121711Z-8f039dc45340'
import currentText from './fixtures/legacy-snapshot/current.json?raw'
import manifestText from './fixtures/legacy-snapshot/manifest.json?raw'
import searchIndexText from './fixtures/legacy-snapshot/search-index.json?raw'
import records0Text from './fixtures/legacy-snapshot/records-0.json?raw'
import records1Text from './fixtures/legacy-snapshot/records-1.json?raw'
import records2Text from './fixtures/legacy-snapshot/records-2.json?raw'
import records3Text from './fixtures/legacy-snapshot/records-3.json?raw'
import records4Text from './fixtures/legacy-snapshot/records-4.json?raw'
import records5Text from './fixtures/legacy-snapshot/records-5.json?raw'
import records6Text from './fixtures/legacy-snapshot/records-6.json?raw'
import records7Text from './fixtures/legacy-snapshot/records-7.json?raw'

const LEGACY_TEXT: Readonly<Record<string, string>> = {
  'current.json': currentText, 'manifest.json': manifestText, 'search-index.json': searchIndexText,
  'records-0.json': records0Text, 'records-1.json': records1Text, 'records-2.json': records2Text,
  'records-3.json': records3Text, 'records-4.json': records4Text, 'records-5.json': records5Text,
  'records-6.json': records6Text, 'records-7.json': records7Text,
}

interface Stored { readonly bytes: Uint8Array; readonly etag: string }

function bucketFor(objects: ReadonlyMap<string, Stored>) {
  const calls: string[] = []
  const bucket: R2ReadableBucketLike = {
    async get(key): Promise<R2ObjectLike | null> {
      calls.push(key)
      const stored = objects.get(key)
      if (!stored) return null
      return { body: new Response(new Uint8Array(stored.bytes).buffer).body!, size: stored.bytes.byteLength, etag: stored.etag, httpEtag: stored.etag }
    },
  }
  return { bucket, calls }
}

function payloads(entries: readonly [string, string][]): Map<string, Stored> {
  return new Map(entries.map(([key, value]) => [key, { bytes: new TextEncoder().encode(value), etag: `etag-${key}` }]))
}

function context() {
  const waits: Promise<unknown>[] = []
  const value: WorkerExecutionContext = { waitUntil(promise) { waits.push(promise) } }
  return { value, waits }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('serves allowlisted objects with contract headers and cache lifetimes', async () => {
  const objects = payloads([
    ['catalog/v1/current.json', '{}'],
    [`catalog/v1/snapshots/${SNAPSHOT_ID}/manifest.json`, '{}'],
    [`catalog/v1/snapshots/${SNAPSHOT_ID}/search-index.json`, '{}'],
    [`catalog/v1/snapshots/${SNAPSHOT_ID}/records-0.json`, '{}'],
    [`catalog/v1/snapshots/${SNAPSHOT_ID}/records-255.json`, '{}'],
  ])
  const { bucket } = bucketFor(objects)
  const expected = new Map([
    ['/catalog/v1/current.json', 'public, max-age=60'],
    [`/catalog/v1/snapshots/${SNAPSHOT_ID}/manifest.json`, 'public, max-age=31536000, immutable'],
    [`/catalog/v1/snapshots/${SNAPSHOT_ID}/search-index.json`, 'public, max-age=31536000, immutable'],
    [`/catalog/v1/snapshots/${SNAPSHOT_ID}/records-0.json`, 'public, max-age=31536000, immutable'],
    [`/catalog/v1/snapshots/${SNAPSHOT_ID}/records-255.json`, 'public, max-age=31536000, immutable'],
  ])
  for (const [path, cacheControl] of expected) {
    const response = await serveCatalogueRequest(new Request(`https://example.invalid${path}`), bucket, context().value)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{}')
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('ETag')).toBe(`etag-${path.slice(1)}`)
    expect(response.headers.get('Cache-Control')).toBe(cacheControl)
  }
})

it('serves HEAD with the GET status and headers but no body', async () => {
  const objects = payloads([['catalog/v1/current.json', '{"ok":true}']])
  const { bucket } = bucketFor(objects)
  const response = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json', { method: 'HEAD' }), bucket, context().value)
  expect(response.status).toBe(200)
  expect(response.headers.get('ETag')).toBe('etag-catalog/v1/current.json')
  expect(await response.text()).toBe('')
})

it('returns 304 with contract headers for a matching ETag', async () => {
  const objects = payloads([['catalog/v1/current.json', '{}']])
  const { bucket } = bucketFor(objects)
  const response = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json', { headers: { 'If-None-Match': 'etag-catalog/v1/current.json' } }), bucket, context().value)
  expect(response.status).toBe(304)
  expect(response.headers.get('ETag')).toBe('etag-catalog/v1/current.json')
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
  expect(await response.text()).toBe('')
})

it('rejects private, malformed and traversal paths without bucket access', async () => {
  const { bucket, calls } = bucketFor(new Map())
  const paths = [
    '/catalog/v1/', '/catalog/v1/current.json/', '/catalog/v2/current.json',
    '/catalog/v1/control/ingestion-lease.json', '/catalog/v1/control/provider-state.json',
    '/catalog/v1/control/gp-sweep/state.json', '/catalog/v1/control/gp-sweep/pages/20260914T001703Z-0123abcd/page-000.json',
    '/catalog/v1/control/gp-sweep/review.json', '/catalog/v1/control/gp-sweep/operator-action.json',
    '/catalog/v1/snapshots/../control/provider-state.json', '/catalog/v1/snapshots/%2e%2e/control/provider-state.json',
    `/catalog/v1/snapshots/${LEGACY_ID}/records-007.json`, `/catalog/v1/snapshots/${LEGACY_ID}/records-256.json`,
    `/catalog/v1/snapshots/${LEGACY_ID}/other.json`, '/catalog/v1/snapshots/bad-id/manifest.json',
  ]
  for (const path of paths) {
    const response = await serveCatalogueRequest(new Request(`https://example.invalid${path}`), bucket, context().value)
    expect(response.status, path).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }
  expect(calls).toEqual([])
})

it('rejects mutating methods before reading R2', async () => {
  const { bucket, calls } = bucketFor(new Map())
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json', { method }), bucket, context().value)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, HEAD')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }
  expect(calls).toEqual([])
})

it('returns 503 when an allowlisted object is missing', async () => {
  const { bucket, calls } = bucketFor(new Map())
  const response = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json'), bucket, context().value)
  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(calls).toEqual(['catalog/v1/current.json'])
})

it('uses the Cache API without reading R2 on a hit and stores misses through waitUntil', async () => {
  const cacheEntries = new Map<string, Response>()
  const cache: Pick<Cache, 'match' | 'put'> = {
    async match(request) { return cacheEntries.get(request instanceof Request ? request.url : request.toString()) ?? undefined },
    async put(request, response) { cacheEntries.set(request instanceof Request ? request.url : request.toString(), response) },
  }
  vi.stubGlobal('caches', { default: cache })
  const objects = payloads([['catalog/v1/current.json', 'from-r2']])
  const first = bucketFor(objects)
  const firstContext = context()
  const firstResponse = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json'), first.bucket, firstContext.value)
  expect(await firstResponse.text()).toBe('from-r2')
  expect(first.calls).toEqual(['catalog/v1/current.json'])
  expect(firstContext.waits).toHaveLength(1)
  await Promise.all(firstContext.waits)

  const second = bucketFor(new Map())
  const cachedResponse = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json'), second.bucket, context().value)
  expect(await cachedResponse.text()).toBe('from-r2')
  expect(second.calls).toEqual([])
})

it('never caches a HEAD response, and keys the cache on the path alone', async () => {
  const cacheEntries = new Map<string, Response>()
  const cache: Pick<Cache, 'match' | 'put'> = {
    async match(request) { return cacheEntries.get(request instanceof Request ? request.url : request.toString()) ?? undefined },
    async put(request, response) { cacheEntries.set(request instanceof Request ? request.url : request.toString(), response) },
  }
  vi.stubGlobal('caches', { default: cache })
  const objects = payloads([['catalog/v1/current.json', 'pointer-bytes']])
  const head = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json', { method: 'HEAD' }), bucketFor(objects).bucket, context().value)
  expect(head.status).toBe(200)
  expect(cacheEntries.size).toBe(0)
  // A later GET still receives the whole body.
  const getContext = context()
  const get = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json'), bucketFor(objects).bucket, getContext.value)
  expect(await get.text()).toBe('pointer-bytes')
  await Promise.all(getContext.waits)
  expect([...cacheEntries.keys()]).toEqual(['https://example.invalid/catalog/v1/current.json'])
  // A query string reads the same cache entry instead of the bucket.
  const busting = bucketFor(new Map())
  const again = await serveCatalogueRequest(new Request('https://example.invalid/catalog/v1/current.json?v=2'), busting.bucket, context().value)
  expect(await again.text()).toBe('pointer-bytes')
  expect(busting.calls).toEqual([])
})

it('serves the legacy snapshot bytes and verifies its manifest hash chain', async () => {
  const objects = new Map<string, Stored>()
  for (const name of Object.keys(LEGACY_TEXT)) {
    const key = name === 'current.json'
      ? 'catalog/v1/current.json'
      : `catalog/v1/snapshots/${LEGACY_ID}/${name}`
    objects.set(key, { bytes: new TextEncoder().encode(LEGACY_TEXT[name]), etag: `etag-${name}` })
  }
  const { bucket } = bucketFor(objects)
  for (const [key, stored] of objects) {
    const response = await serveCatalogueRequest(new Request(`https://example.invalid/${key}`), bucket, context().value)
    expect(new Uint8Array(await response.arrayBuffer()), key).toEqual(stored.bytes)
  }
  const manifest = JSON.parse(new TextDecoder().decode(objects.get(`catalog/v1/snapshots/${LEGACY_ID}/manifest.json`)!.bytes))
  expect(await sha256Hex(objects.get('catalog/v1/snapshots/' + LEGACY_ID + '/manifest.json')!.bytes)).toBe(manifest.index ? JSON.parse(new TextDecoder().decode(objects.get('catalog/v1/current.json')!.bytes)).manifestSha256 : '')
  for (const descriptor of [manifest.index, ...manifest.shards]) {
    const stored = objects.get(descriptor.path.slice(1))!
    expect(stored.bytes.byteLength).toBe(descriptor.byteLength)
    expect(await sha256Hex(stored.bytes)).toBe(descriptor.sha256)
  }
})

it('serves automatic fixture bytes and loads them through CatalogueClient', async () => {
  const fixture = buildAutomaticSnapshotFixture()
  const served = await servedSnapshotPayloads(fixture)
  const objects = new Map([...served].map(([path, bytes]) => [path.slice(1), { bytes, etag: `etag-${path}` }]))
  const { bucket } = bucketFor(objects)
  const waits = context()
  const fetchImpl: typeof fetch = (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    return serveCatalogueRequest(new Request(new URL(path, 'https://example.invalid'), init), bucket, waits.value)
  }
  const client = new CatalogueClient({ fetch: fetchImpl, pointerSessionTtlMs: 0 })
  const loaded = await client.load()
  expect(loaded.manifest.snapshotId).toBe(fixture.manifest.snapshotId)
  expect((await client.loadRecord('900001')).NORAD_CAT_ID).toBe('900001')
  client.dispose()
})
