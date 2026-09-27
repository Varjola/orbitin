import { afterEach, describe, expect, it, vi } from 'vitest'
import frontendWorker, { type FrontendWorkerEnv } from './index.ts'
import { browserFamily } from './usageEventSchema.ts'
import { CatalogueClient } from '../../src/data/CatalogueClient.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../../src/data/fixtures/automaticCatalogueSnapshot.ts'
import type { R2ReadableBucketLike, R2ObjectLike, WorkerAssets } from '../shared/types.ts'

const LEGACY_ID = '20260913T121711Z-8f039dc45340'
import currentText from '../catalogue/fixtures/legacy-snapshot/current.json?raw'
import manifestText from '../catalogue/fixtures/legacy-snapshot/manifest.json?raw'
import searchIndexText from '../catalogue/fixtures/legacy-snapshot/search-index.json?raw'
import records0Text from '../catalogue/fixtures/legacy-snapshot/records-0.json?raw'
import records1Text from '../catalogue/fixtures/legacy-snapshot/records-1.json?raw'
import records2Text from '../catalogue/fixtures/legacy-snapshot/records-2.json?raw'
import records3Text from '../catalogue/fixtures/legacy-snapshot/records-3.json?raw'
import records4Text from '../catalogue/fixtures/legacy-snapshot/records-4.json?raw'
import records5Text from '../catalogue/fixtures/legacy-snapshot/records-5.json?raw'
import records6Text from '../catalogue/fixtures/legacy-snapshot/records-6.json?raw'
import records7Text from '../catalogue/fixtures/legacy-snapshot/records-7.json?raw'

const LEGACY_TEXT: Readonly<Record<string, string>> = {
  'current.json': currentText, 'manifest.json': manifestText, 'search-index.json': searchIndexText,
  'records-0.json': records0Text, 'records-1.json': records1Text, 'records-2.json': records2Text,
  'records-3.json': records3Text, 'records-4.json': records4Text, 'records-5.json': records5Text,
  'records-6.json': records6Text, 'records-7.json': records7Text,
}

function bytes(path: string): Uint8Array {
  return new TextEncoder().encode(LEGACY_TEXT[path])
}

function legacyPayloads(): Map<string, Uint8Array> {
  const payloads = new Map<string, Uint8Array>()
  payloads.set('/catalog/v1/current.json', bytes('current.json'))
  payloads.set(`/catalog/v1/snapshots/${LEGACY_ID}/manifest.json`, bytes('manifest.json'))
  payloads.set(`/catalog/v1/snapshots/${LEGACY_ID}/search-index.json`, bytes('search-index.json'))
  for (let shard = 0; shard < 8; shard += 1) payloads.set(`/catalog/v1/snapshots/${LEGACY_ID}/records-${shard}.json`, bytes(`records-${shard}.json`))
  return payloads
}

function readableBucket(payloads: ReadonlyMap<string, Uint8Array>) {
  const calls: string[] = []
  const bucket: R2ReadableBucketLike = {
    async get(key): Promise<R2ObjectLike | null> {
      calls.push(key)
      const value = payloads.get(`/${key}`)
      if (!value) return null
      return { body: new Response(new Uint8Array(value).buffer).body!, size: value.byteLength, etag: `etag-${key}` }
    },
  }
  return { bucket, calls }
}

function environment(bucket: R2ReadableBucketLike, assetFetch: WorkerAssets['fetch'] = async () => new Response('asset')): FrontendWorkerEnv {
  return { ASSETS: { fetch: assetFetch }, CATALOGUE_BUCKET: bucket }
}

const context = { waitUntil: vi.fn() }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('exports only the fetch handler', async () => {
  expect(Object.keys(frontendWorker).sort()).toEqual(['fetch'])
  // workerd treats every named export of a Worker module as an entry point.
  expect(Object.keys(await import('./index.ts'))).toEqual(['default'])
})

it('delegates application requests to ASSETS but catalogue requests to R2', async () => {
  const payloads = new Map([['/catalog/v1/current.json', new TextEncoder().encode('{}')]])
  const { bucket, calls } = readableBucket(payloads)
  const assetFetch = vi.fn(async (request: Request) => new Response(request.url))
  const env = environment(bucket, assetFetch)
  const assetRequest = new Request('https://orbitin.test/index.html')

  const assetResponse = await frontendWorker.fetch(assetRequest, env, context)
  expect(assetFetch).toHaveBeenCalledWith(assetRequest)
  expect(await assetResponse.text()).toBe(assetRequest.url)

  await frontendWorker.fetch(new Request('https://orbitin.test/catalog/v1/current.json'), env, context)
  expect(calls).toEqual(['catalog/v1/current.json'])
  expect(assetFetch).toHaveBeenCalledTimes(1)
})

it('serves the retained legacy v1 snapshot through the frontend', async () => {
  const { bucket } = readableBucket(legacyPayloads())
  const env = environment(bucket)
  const response = await frontendWorker.fetch(new Request('https://orbitin.test/catalog/v1/current.json'), env, context)
  expect(response.status).toBe(200)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes('current.json'))

  const manifest = await frontendWorker.fetch(new Request(`https://orbitin.test/catalog/v1/snapshots/${LEGACY_ID}/manifest.json`), env, context)
  expect(new Uint8Array(await manifest.arrayBuffer())).toEqual(bytes('manifest.json'))
})

it.each(['orbitin.test', 'orbitin-dev.test'])('loads the same automatic snapshot through %s', async (host) => {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture())
  const { bucket } = readableBucket(payloads)
  const env = environment(bucket)
  const fetchImpl: typeof fetch = (input, init) => frontendWorker.fetch(new Request(new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString(), `https://${host}`), init), env, context)
  const client = new CatalogueClient({ fetch: fetchImpl, pointerSessionTtlMs: 0 })
  const loaded = await client.load()
  expect(loaded.manifest.snapshotId).toBe('20260914T001703Z-0123456789ab')
  expect((await client.loadRecord('900001')).NORAD_CAT_ID).toBe('900001')
  client.dispose()
})

it('uses an environment containing only ASSETS and the read-only catalogue binding', () => {
  const throwingBucket = new Proxy({ get: async () => null }, {
    get(target, property, receiver) {
      if (property === 'put' || property === 'delete' || property === 'list' || property === 'head') throw new Error(`Unexpected frontend bucket operation: ${String(property)}`)
      return Reflect.get(target, property, receiver)
    },
  }) as R2ReadableBucketLike
  const env = environment(throwingBucket)
  expect(Object.keys(env).sort()).toEqual(['ASSETS', 'CATALOGUE_BUCKET'])
})

it('rejects every private or malformed catalogue path without bucket access', async () => {
  const { bucket, calls } = readableBucket(new Map())
  const env = environment(bucket)
  const paths = [
    '/catalog/v1/', '/catalog/v1/current.json/', '/catalog/v2/current.json',
    '/catalog/v1/control/ingestion-lease.json', '/catalog/v1/control/provider-state.json',
    '/catalog/v1/control/gp-sweep/state.json', '/catalog/v1/control/gp-sweep/pages/20260914T001703Z-0123abcd/page-000.json',
    '/catalog/v1/control/gp-sweep/review.json', '/catalog/v1/control/gp-sweep/operator-action.json',
    '/catalog/v1/snapshots/../control/provider-state.json', '/catalog/v1/snapshots/%2e%2e/control/provider-state.json',
    `/catalog/v1/snapshots/${LEGACY_ID}/records-007.json`, `/catalog/v1/snapshots/${LEGACY_ID}/records-256.json`,
    `/catalog/v1/snapshots/${LEGACY_ID}/other.json`, '/catalog/v1/snapshots/bad-id/manifest.json',
  ]
  for (const path of paths) expect((await frontendWorker.fetch(new Request(`https://orbitin.test${path}`), env, context)).status).toBe(404)
  expect(calls).toEqual([])
})

it('reads retained legacy data for a rollback snapshot', async () => {
  const { bucket } = readableBucket(legacyPayloads())
  const env = environment(bucket)
  for (const part of ['manifest', 'search-index', 'records-0']) {
    const response = await frontendWorker.fetch(new Request(`https://orbitin-dev.test/catalog/v1/snapshots/${LEGACY_ID}/${part}.json`), env, context)
    expect(response.status).toBe(200)
  }
})

describe('the anonymous usage event sink', () => {
  function sink() {
    const points: { indexes?: readonly string[]; blobs?: readonly string[]; doubles?: readonly number[] }[] = []
    return { points, dataset: { writeDataPoint: (point: (typeof points)[number]) => { points.push(point) } } }
  }
  function post(body: string, headers: Record<string, string> = {}): Request {
    const request = new Request('https://orbitin.test/events/v1', { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36', ...headers } })
    Object.defineProperty(request, 'cf', { value: { country: 'FI', city: 'Helsinki' } })
    return request
  }

  it('writes one data point per allowlisted event with only the country and browser family added', async () => {
    const { points, dataset } = sink()
    const env = { ...environment(readableBucket(new Map()).bucket), USAGE_EVENTS: dataset }
    const body = JSON.stringify({ events: [
      { type: 'visit', presentation: 'mobile', locale: 'fi', entry: 'plain' },
      { type: 'object_added', source: 'quick-search', norad: '25544' },
      { type: 'object_added', source: 'group' },
    ] })
    const response = await frontendWorker.fetch(post(body), env, context)
    expect(response.status).toBe(204)
    expect(points).toEqual([
      { indexes: ['visit'], blobs: ['visit', 'FI', 'chrome', 'mobile', 'fi', 'plain'], doubles: [1] },
      { indexes: ['object_added'], blobs: ['object_added', 'FI', 'chrome', 'quick-search', '25544'], doubles: [1] },
      { indexes: ['object_added'], blobs: ['object_added', 'FI', 'chrome', 'group', ''], doubles: [1] },
    ])
    // Nothing identifying: no city, no user agent string, no address.
    expect(JSON.stringify(points)).not.toMatch(/Helsinki|Mozilla|Android/)
  })

  it('drops events that are not exactly on the allowlist', async () => {
    const { points, dataset } = sink()
    const env = { ...environment(readableBucket(new Map()).bucket), USAGE_EVENTS: dataset }
    const body = JSON.stringify({ events: [
      { type: 'search', results: '1', text: 'iss' },
      { type: 'search', results: 'many' },
      { type: 'unknown' },
      { type: 'object_added', source: 'group', norad: 'ISS' },
      { type: 'error', kind: 'frame' },
    ] })
    expect((await frontendWorker.fetch(post(body), env, context)).status).toBe(204)
    expect(points.map((point) => point.blobs?.[0])).toEqual(['error'])
  })

  it('refuses reads, cross-origin posts, oversized and malformed bodies without storing anything', async () => {
    const { points, dataset } = sink()
    const env = { ...environment(readableBucket(new Map()).bucket), USAGE_EVENTS: dataset }
    expect((await frontendWorker.fetch(new Request('https://orbitin.test/events/v1'), env, context)).status).toBe(405)
    expect((await frontendWorker.fetch(post('{"events":[]}', { Origin: 'https://elsewhere.test' }), env, context)).status).toBe(403)
    expect((await frontendWorker.fetch(post(`{"events":[${'{"type":"error","kind":"frame"},'.repeat(200)}{}]}`), env, context)).status).toBe(413)
    expect((await frontendWorker.fetch(post('not json'), env, context)).status).toBe(400)
    const tooMany = JSON.stringify({ events: Array.from({ length: 41 }, () => ({ type: 'mode', mode: 'orbitLab' })) })
    expect((await frontendWorker.fetch(post(tooMany), env, context)).status).toBe(400)
    expect(points).toEqual([])
  })

  it('accepts events and stores nothing where no dataset is bound', async () => {
    const env = environment(readableBucket(new Map()).bucket)
    const response = await frontendWorker.fetch(post(JSON.stringify({ events: [{ type: 'mode', mode: 'realObjects' }] })), env, context)
    expect(response.status).toBe(204)
  })

  it('reduces the user agent to a coarse browser family', () => {
    expect(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]')).toBe('linkedin-app')
    expect(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('safari-ios')
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('firefox')
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('edge')
    expect(browserFamily('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36')).toBe('android-webview')
    expect(browserFamily(null)).toBe('other')
  })
})
