import { afterEach, describe, expect, it, vi } from 'vitest'
import catalogueWorker, { runIngestion } from './index.ts'
import { CATALOGUE_SELECTION_IDS } from './catalogues.ts'
import { sha256Hex } from '../../src/data/catalogueSchema.ts'
import { curatedSupplementIds } from '../../src/data/curatedCatalogue.ts'
import type { R2BucketLike, R2ObjectLike, CatalogueWorkerEnv } from './types.ts'

interface Stored {
  readonly bytes: Uint8Array
  readonly etag: string
}

function fakeBucket() {
  const objects = new Map<string, Stored>()
  let nextEtag = 0
  const describe = async (stored: Stored): Promise<R2ObjectLike> => ({
    size: stored.bytes.byteLength,
    etag: stored.etag,
    httpEtag: stored.etag,
    checksums: { sha256: await sha256Hex(stored.bytes) },
    body: new Response(new Uint8Array(stored.bytes).buffer).body!,
  })
  const bucket: R2BucketLike = {
    async get(key) {
      const stored = objects.get(key)
      return stored ? describe(stored) : null
    },
    async head(key) {
      const stored = objects.get(key)
      return stored ? describe(stored) : null
    },
    async put(key, value, options) {
      const existing = objects.get(key)
      const onlyIf = (options as { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } } | undefined)?.onlyIf
      if (onlyIf?.etagDoesNotMatch === '*' && existing) return null
      if (onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== existing?.etag) return null
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value)
      const stored = { bytes, etag: `etag-${nextEtag++}` }
      objects.set(key, stored)
      return describe(stored)
    },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })) } },
  }
  return { bucket, objects }
}

function env(bucket: R2BucketLike, overrides: Partial<CatalogueWorkerEnv> = {}): CatalogueWorkerEnv {
  return {
    CATALOGUE_BUCKET: bucket,
    CATALOGUE_ENABLED: 'true',
    CATALOGUE_PROVIDER: 'fixture',
    CATALOGUE_CONFIG_REVISION: 'test-revision',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('exposes only fetch and scheduled from the catalogue Worker entry point', () => {
  expect(Object.keys(catalogueWorker).sort()).toEqual(['fetch', 'scheduled'])
})

it('has no named export the Workers runtime would refuse to load as an entry point', async () => {
  // workerd treats every named export of the entry module as an entrypoint and
  // refuses a string or number there (found in a local workerd run).
  for (const [name, value] of Object.entries(await import('./index.ts'))) expect(typeof value, name).toMatch(/^(?:function|object)$/)
})

it('returns a non-cacheable 404 without requiring frontend bindings', async () => {
  const response = await catalogueWorker.fetch()
  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ error: 'not_found' })
})

it('schedules one fixture ingestion promise per invocation and publishes after the supplement invocation', async () => {
  const { bucket, objects } = fakeBucket()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const waits: Promise<unknown>[] = []
  const context = { waitUntil(promise: Promise<unknown>) { waits.push(promise) } }
  const scheduled = catalogueWorker.scheduled(undefined, env(bucket, { CATALOGUE_RETRIEVAL: 'gp-sweep' }), context)
  expect(waits).toHaveLength(1)
  await scheduled
  await Promise.all(waits)
  // The terminal page stages the candidate; the next invocation
  // fetches the curated supplement and publishes.
  expect(objects.has('catalog/v1/current.json')).toBe(false)
  await catalogueWorker.scheduled(undefined, env(bucket, { CATALOGUE_RETRIEVAL: 'gp-sweep' }), context)
  await Promise.all(waits)
  expect(waits).toHaveLength(2)
  expect(objects.has('catalog/v1/current.json')).toBe(true)
})

it('does not write live-provider protection state for a fixture publication', async () => {
  const { bucket, objects } = fakeBucket()

  await runIngestion(env(bucket), '2026-09-10T00:17:00Z')

  expect(objects.has('catalog/v1/current.json')).toBe(true)
  expect(objects.has('catalog/v1/control/provider-state.json')).toBe(false)
})

it('persists provider cooldown state when the live provider fails', async () => {
  const { bucket, objects } = fakeBucket()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  await runIngestion(env(bucket, {
    CATALOGUE_PROVIDER: 'space-track',
    SPACETRACK_IDENTITY: 'operator@example.invalid',
    SPACETRACK_PASSWORD: 'not-a-real-password',
  }), '2026-09-10T00:17:00Z')

  const stored = objects.get('catalog/v1/control/provider-state.json')
  expect(stored).toBeDefined()
  const state = JSON.parse(new TextDecoder().decode(stored!.bytes))
  expect(state).toEqual({
    schemaVersion: 1,
    mode: 'cooldown',
    configurationRevision: 'test-revision',
    updatedAtUtc: '2026-09-10T00:17:00Z',
    retryAfterUtc: '2026-09-10T12:17:00.000Z',
    reason: 'transient:503',
  })
  expect(objects.has('catalog/v1/current.json')).toBe(false)
})

it('publishes an automatic snapshot from a one-page fixture sweep', async () => {
  const { bucket, objects } = fakeBucket()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)

  await runIngestion(env(bucket, { CATALOGUE_RETRIEVAL: 'gp-sweep' }), '2026-09-14T00:17:00Z')
  expect(objects.has('catalog/v1/current.json')).toBe(false)
  await runIngestion(env(bucket, { CATALOGUE_RETRIEVAL: 'gp-sweep' }), '2026-09-14T00:18:00Z')

  const pointer = JSON.parse(new TextDecoder().decode(objects.get('catalog/v1/current.json')!.bytes))
  const manifest = JSON.parse(new TextDecoder().decode(objects.get(pointer.manifestPath.slice(1))!.bytes))
  expect(manifest.catalogueProfile).toMatchObject({ kind: 'automatic-catalogue' })
  expect(manifest.shardCount).toBe(128)
  expect(manifest.sourceRun).toMatchObject({ providerId: 'fixture', retrievalStartedAtUtc: '2026-09-14T00:17:00Z', retrievedAtUtc: '2026-09-14T00:17:00Z' })
  // Every curated id is in the published fixture catalogue.
  expect(manifest.sourceRun.queryDescription).toContain('synthetic curated members')
  expect(manifest.automaticSummary.publishedCount).toBe(new Set([...CATALOGUE_SELECTION_IDS, ...curatedSupplementIds()]).size)
  expect(objects.has('catalog/v1/control/provider-state.json')).toBe(false)
})

/** Space-Track stand-in for sweep scheduling tests: login and GP answers are
 *  set per test; logout always succeeds. */
function sweepUpstream(login: () => Response, gp: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/ajaxauth/login')) return login()
    if (url.includes('/ajaxauth/logout')) return new Response('', { status: 200 })
    return gp(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { gpCalls: () => fetchMock.mock.calls.filter(([input]) => String(input).includes('/class/gp/')).length, loginCalls: () => fetchMock.mock.calls.filter(([input]) => String(input).includes('/ajaxauth/login')).length }
}
const loginOk = () => new Response('""', { status: 200, headers: { 'set-cookie': 'chocolatechip=session; path=/' } })
const readJson = (objects: Map<string, Stored>, key: string) => JSON.parse(new TextDecoder().decode(objects.get(key)!.bytes))
const sweepEnvFor = (bucket: R2BucketLike) => env(bucket, { CATALOGUE_RETRIEVAL: 'gp-sweep', CATALOGUE_PROVIDER: 'space-track', SPACETRACK_IDENTITY: 'operator@example.invalid', SPACETRACK_PASSWORD: 'not-a-real-password' })

describe('hourly sweep provider failure policy', () => {
  it.each([
    ['provider 5xx', () => new Response('', { status: 503 })],
    ['network failure', () => { throw new TypeError('network down') }],
    ['malformed successful page', () => new Response('{"error":"x"}', { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('a %s consumes the hourly slot, starts no cooldown and retries the same cursor at the next hour', async (_, gp) => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    const upstream = sweepUpstream(loginOk, gp)

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    expect(upstream.gpCalls()).toBe(1)
    expect(objects.has('catalog/v1/control/provider-state.json')).toBe(false)
    expect(readJson(objects, 'catalog/v1/control/gp-sweep/state.json')).toMatchObject({ lastGpRequestAtUtc: '2026-09-14T00:17:00Z', sweep: null, lastPageFailure: { afterCatalogId: '0', consecutiveFailures: 1 } })

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:47:00Z')
    expect(upstream.gpCalls()).toBe(1)
    await runIngestion(sweepEnvFor(bucket), '2026-09-14T01:17:00Z')
    expect(upstream.gpCalls()).toBe(2)
    expect(readJson(objects, 'catalog/v1/control/gp-sweep/state.json').lastPageFailure).toMatchObject({ afterCatalogId: '0', consecutiveFailures: 2 })
    expect(objects.has('catalog/v1/current.json')).toBe(false)
  })

  it.each([
    ['a rejected login', () => new Response('{"Login":"Failed"}', { status: 200 }), loginOk, 'authentication:200'],
    ['HTTP 403', loginOk, () => new Response('', { status: 403 }), 'authentication:403'],
    ['HTTP 429', loginOk, () => new Response('', { status: 429 }), 'rate-limit:429'],
  ])('%s backs off for 24 hours and latches for the operator when it repeats', async (_, login, gp, reason) => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    const upstream = sweepUpstream(login, gp)

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    expect(readJson(objects, 'catalog/v1/control/provider-state.json')).toMatchObject({ mode: 'cooldown', retryAfterUtc: '2026-09-15T00:17:00.000Z', reason })
    const logins = upstream.loginCalls()

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T12:17:00Z')
    expect(upstream.loginCalls()).toBe(logins)

    await runIngestion(sweepEnvFor(bucket), '2026-09-15T01:17:00Z')
    expect(upstream.loginCalls()).toBe(logins + 1)
    expect(readJson(objects, 'catalog/v1/control/provider-state.json')).toMatchObject({ mode: 'config-fault', retryAfterUtc: null, reason: `operator-required:${reason}` })

    await runIngestion(sweepEnvFor(bucket), '2026-09-20T01:17:00Z')
    expect(upstream.loginCalls()).toBe(logins + 1)
    // A new configuration revision is the operator's release.
    await runIngestion({ ...sweepEnvFor(bucket), CATALOGUE_CONFIG_REVISION: 'next-revision' }, '2026-09-20T02:17:00Z')
    expect(upstream.loginCalls()).toBe(logins + 2)
  })

  it('returns to healthy after a successful page following a cooldown', async () => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    let status = 429
    sweepUpstream(loginOk, () => status === 200 ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status }))
    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    status = 200
    await runIngestion(sweepEnvFor(bucket), '2026-09-15T01:17:00Z')
    expect(readJson(objects, 'catalog/v1/control/provider-state.json')).toMatchObject({ mode: 'healthy' })
  })
})

/** One synthetic Space-Track GP record, as in the sweep tests. */
function wire(id: number): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', CREATION_DATE: '2026-09-13T06:26:37', ORIGINATOR: '18 SPCS', OBJECT_NAME: `SYNTHETIC ${id}`, OBJECT_ID: `2020-${String(id).padStart(3, '0')}A`,
    CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4', EPOCH: '2026-09-12T22:41:08.689632',
    MEAN_MOTION: '15.49180977', ECCENTRICITY: '0.00016340', INCLINATION: '51.6446', RA_OF_ASC_NODE: String((id * 7) % 360), ARG_OF_PERICENTER: '35.3131', MEAN_ANOMALY: '60.2620',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: String(id), ELEMENT_SET_NO: '999', REV_AT_EPOCH: '47210', BSTAR: '0.00001654', MEAN_MOTION_DOT: '0.00000915', MEAN_MOTION_DDOT: '0',
    OBJECT_TYPE: 'PAYLOAD',
  }
}
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const isCurated = (url: string) => /\/class\/gp\/NORAD_CAT_ID\/\d/.test(url)
const SWEEP_STATE = 'catalog/v1/control/gp-sweep/state.json'
const PROVIDER_STATE = 'catalog/v1/control/provider-state.json'

describe('provider protection for the curated supplement', () => {
  it.each([
    ['HTTP 429', 429, { mode: 'cooldown', retryAfterUtc: '2026-09-15T01:17:00.000Z', reason: 'rate-limit:429' }],
    ['HTTP 403', 403, { mode: 'cooldown', retryAfterUtc: '2026-09-15T01:17:00.000Z', reason: 'authentication:403' }],
    ['HTTP 404', 404, { mode: 'config-fault', retryAfterUtc: null, reason: 'configuration:404' }],
  ])('a supplement %s is protected against after the candidate is built from the sweep alone', async (_, status, expected) => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    const upstream = sweepUpstream(loginOk, (url) => isCurated(url) ? new Response('', { status }) : jsonResponse([wire(101), wire(102), wire(103)]))

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    expect(readJson(objects, SWEEP_STATE).sweep.candidate).toMatchObject({ status: 'awaiting-publication' })
    expect(readJson(objects, PROVIDER_STATE)).toMatchObject({ mode: 'healthy', reason: 'candidate-staged' })

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T01:17:00Z')
    expect(upstream.gpCalls()).toBe(2)
    // The first live catalogue waits for bootstrap review; it was built in this run.
    const state = readJson(objects, SWEEP_STATE)
    expect(state.sweep.candidate).toMatchObject({ status: 'held-for-review' })
    expect(state.sweep.supplement).toMatchObject({ status: 'failed', failure: { kind: expected.reason.split(':')[0], status } })
    expect(readJson(objects, PROVIDER_STATE)).toMatchObject(expected)
  })

  it('a transient supplement failure changes no protection state and never records health', async () => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    sweepUpstream(loginOk, (url) => isCurated(url) ? new Response('', { status: 503 }) : jsonResponse([wire(101), wire(102), wire(103)]))
    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    // An expired cooldown from an earlier, unrelated failure.
    const earlier = { schemaVersion: 1, mode: 'cooldown', configurationRevision: 'test-revision', updatedAtUtc: '2026-09-13T00:00:00Z', retryAfterUtc: '2026-09-14T00:00:00.000Z', reason: 'rate-limit:429' }
    await bucket.put(PROVIDER_STATE, JSON.stringify(earlier))

    await runIngestion(sweepEnvFor(bucket), '2026-09-14T01:17:00Z')
    expect(readJson(objects, SWEEP_STATE).sweep.supplement).toMatchObject({ status: 'failed', failure: { kind: 'transient', status: 503 } })
    expect(readJson(objects, PROVIDER_STATE)).toEqual(earlier)
  })

  it('a successful supplement after an expired cooldown records health, like a page', async () => {
    const { bucket, objects } = fakeBucket()
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
    sweepUpstream(loginOk, (url) => jsonResponse(isCurated(url) ? [] : [wire(101), wire(102), wire(103)]))
    await runIngestion(sweepEnvFor(bucket), '2026-09-14T00:17:00Z')
    await bucket.put(PROVIDER_STATE, JSON.stringify({ schemaVersion: 1, mode: 'cooldown', configurationRevision: 'test-revision', updatedAtUtc: '2026-09-13T00:00:00Z', retryAfterUtc: '2026-09-14T00:00:00.000Z', reason: 'rate-limit:429' }))
    await runIngestion(sweepEnvFor(bucket), '2026-09-14T01:17:00Z')
    expect(readJson(objects, PROVIDER_STATE)).toMatchObject({ mode: 'healthy', reason: 'held-for-review' })
  })
})

it('refuses an unknown retrieval shape before any provider or storage work', async () => {
  const { bucket, objects } = fakeBucket()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await runIngestion(env(bucket, { CATALOGUE_RETRIEVAL: 'full-download' }), '2026-09-14T00:17:00Z')
  expect(objects.size).toBe(0)
})

it('refuses operator fault injection when a live provider is selected', async () => {
  const { bucket, objects } = fakeBucket()
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  await runIngestion(env(bucket, {
    CATALOGUE_PROVIDER: 'space-track',
    CATALOGUE_TEST_FAULT: 'before-pointer-write',
    SPACETRACK_IDENTITY: 'operator@example.invalid',
    SPACETRACK_PASSWORD: 'not-a-real-password',
  }), '2026-09-10T00:17:00Z')

  expect(fetchMock).not.toHaveBeenCalled()
  expect(objects.size).toBe(0)
})

it('keeps the published pointer and ETag when a live provider fails', async () => {
  const { bucket, objects } = fakeBucket()
  await runIngestion(env(bucket), '2026-09-10T00:17:00Z')
  const before = objects.get('catalog/v1/current.json')!
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  await runIngestion(env(bucket, {
    CATALOGUE_PROVIDER: 'space-track',
    SPACETRACK_IDENTITY: 'operator@example.invalid',
    SPACETRACK_PASSWORD: 'not-a-real-password',
  }), '2026-09-10T01:17:00Z')

  const after = objects.get('catalog/v1/current.json')!
  expect(after.etag).toBe(before.etag)
  expect(after.bytes).toEqual(before.bytes)
})

it('fails closed before provider or storage access when live credentials are absent', async () => {
  const { bucket } = fakeBucket()
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const gets = vi.spyOn(bucket, 'get')
  const puts = vi.spyOn(bucket, 'put')
  const deletes = vi.spyOn(bucket, 'delete')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  await runIngestion(env(bucket, { CATALOGUE_PROVIDER: 'space-track' }), '2026-09-10T00:17:00Z')

  expect(fetchMock).not.toHaveBeenCalled()
  expect(gets).not.toHaveBeenCalled()
  expect(puts).not.toHaveBeenCalled()
  expect(deletes).not.toHaveBeenCalled()
})
