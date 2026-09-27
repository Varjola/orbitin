import { afterEach, describe, expect, it, vi } from 'vitest'
import { GP_SWEEP_MAX_PAGES, GP_SWEEP_OPERATOR_ACTION_KEY, GP_SWEEP_PAGE_PREFIX, GP_SWEEP_REVIEW_KEY, GP_SWEEP_STATE_KEY, readGpSweepState, runGpSweepStep, supplementKey, type GpSweepCuratedSelection, type GpSweepState, type GpSweepStepOptions, type GpSweepStepResult } from './gpSweep.ts'
import { FixtureProvider } from './provider/fixture.ts'
import { SpaceTrackProvider, SPACE_TRACK_GP_SWEEP_DESCRIPTOR } from './provider/spaceTrack.ts'
import type { ProviderFetchError } from './provider/types.ts'
import { serveCatalogueRequest } from '../shared/serve.ts'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCataloguePointer, sha256Hex, type CatalogueManifestV1 } from '../../src/data/catalogueSchema.ts'
import type { R2BucketLike, R2ObjectLike } from './types.ts'

interface Stored { readonly bytes: Uint8Array; readonly etag: string }

function fakeBucket() {
  const objects = new Map<string, Stored>()
  const failPuts: { pattern: RegExp; remaining: number }[] = []
  let nextEtag = 0
  const describe = async (stored: Stored): Promise<R2ObjectLike> => ({
    size: stored.bytes.byteLength, etag: stored.etag, httpEtag: stored.etag,
    checksums: { sha256: await sha256Hex(stored.bytes) },
    body: new Response(new Uint8Array(stored.bytes).buffer).body!,
  })
  const bucket: R2BucketLike = {
    async get(key) { const stored = objects.get(key); return stored ? describe(stored) : null },
    async head(key) { const stored = objects.get(key); return stored ? describe(stored) : null },
    async put(key, value, options) {
      const failure = failPuts.find((candidate) => candidate.remaining > 0 && candidate.pattern.test(key))
      if (failure) { failure.remaining -= 1; throw new Error('Injected R2 put failure.') }
      const existing = objects.get(key)
      const onlyIf = (options as { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string } } | undefined)?.onlyIf
      if (onlyIf?.etagDoesNotMatch === '*' && existing) return null
      if (onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== existing?.etag) return null
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value)
      const stored = { bytes, etag: `etag-${nextEtag++}` }
      objects.set(key, stored)
      return describe(stored)
    },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })) } },
  }
  return { bucket, objects, failPuts }
}

const T0 = '2026-09-14T00:17:00.000Z'
const at = (hours: number, minutes = 0) => new Date(Date.parse(T0) + hours * 3_600_000 + minutes * 60_000).toISOString()
const stagedKeys = (objects: Map<string, Stored>) => [...objects.keys()].filter((key) => key.startsWith(GP_SWEEP_PAGE_PREFIX))
const text = (stored: Stored | undefined) => new TextDecoder().decode(stored!.bytes)

async function live(objects: Map<string, Stored>): Promise<{ manifest: CatalogueManifestV1; etag: string } | null> {
  const pointerObject = objects.get('catalog/v1/current.json')
  if (!pointerObject) return null
  const pointer = decodeCataloguePointer(JSON.parse(text(pointerObject)))
  return { manifest: decodeCatalogueManifest(JSON.parse(text(objects.get(pointer.manifestPath.slice(1))))), etag: pointerObject.etag }
}

/** Published search index entries by catalogue id. */
async function publishedEntries(objects: Map<string, Stored>): Promise<Map<string, { name: string; epochUtc: string }>> {
  const { manifest } = (await live(objects))!
  const index = decodeCatalogueIndex(JSON.parse(text(objects.get(manifest.index.path.replace(/^\/+/, '')))), manifest)
  return new Map(index.entries.map((entry) => [entry.catalogId, { name: entry.name, epochUtc: entry.epochUtc }]))
}

/** Synthetic Space-Track GP catalogue served by keyset cursor and limit. */
function wire(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', CREATION_DATE: '2026-09-13T06:26:37', ORIGINATOR: '18 SPCS', OBJECT_NAME: `SYNTHETIC ${id}`, OBJECT_ID: `2020-${String(id).padStart(3, '0')}A`,
    CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4', EPOCH: '2026-09-12T22:41:08.689632',
    MEAN_MOTION: '15.49180977', ECCENTRICITY: '0.00016340', INCLINATION: '51.6446', RA_OF_ASC_NODE: String((id * 7) % 360), ARG_OF_PERICENTER: '35.3131', MEAN_ANOMALY: '60.2620',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: String(id), ELEMENT_SET_NO: '999', REV_AT_EPOCH: '47210', BSTAR: '0.00001654', MEAN_MOTION_DOT: '0.00000915', MEAN_MOTION_DDOT: '0',
    OBJECT_TYPE: 'PAYLOAD', ...overrides,
  }
}

const json = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const CURATED_QUERY = /\/class\/gp\/NORAD_CAT_ID\/([\d,]+)\//
const PAGE_QUERY = /\/NORAD_CAT_ID\/%3E(\d+)\//

/** Space-Track stand-in: keyset pages from `records`, and the curated query
 *  answered from `curatedRecords` for the requested ids, as the provider would. */
function spaceTrack(records: readonly Record<string, unknown>[], curatedRecords: readonly Record<string, unknown>[] = records) {
  const gpUrls: string[] = []
  const state = { gpStatus: 200, total: 0, malformed: false, curatedStatus: 200, curatedBody: null as string | null }
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    state.total += 1
    if (url.includes('/ajaxauth/login')) return new Response('""', { status: 200, headers: { 'set-cookie': 'chocolatechip=session; path=/' } })
    if (url.includes('/ajaxauth/logout')) return new Response('', { status: 200 })
    gpUrls.push(url)
    const curated = CURATED_QUERY.exec(url)
    if (curated) {
      if (state.curatedStatus !== 200) return new Response('', { status: state.curatedStatus })
      if (state.curatedBody !== null) return json(state.curatedBody)
      const ids = new Set(curated[1].split(','))
      return json(curatedRecords.filter((record) => ids.has(String(record.NORAD_CAT_ID))).sort((a, b) => Number(a.NORAD_CAT_ID) - Number(b.NORAD_CAT_ID)))
    }
    if (state.gpStatus !== 200) return new Response('', { status: state.gpStatus })
    if (state.malformed) return json('{"error":"maintenance"}')
    const after = Number(PAGE_QUERY.exec(url)![1])
    const limit = Number(/\/limit\/(\d+)\//.exec(url)![1])
    return json(records.filter((record) => Number(record.NORAD_CAT_ID) > after).slice(0, limit))
  }) as unknown as typeof globalThis.fetch
  const provider = new SpaceTrackProvider({ credentials: { identity: 'operator@example.invalid', password: 'not-a-real-password' }, fetchImpl })
  return { provider, gpUrls, state }
}
const pageCursors = (urls: readonly string[]) => urls.filter((url) => PAGE_QUERY.test(url)).map((url) => PAGE_QUERY.exec(url)![1])
const curatedUrls = (urls: readonly string[]) => urls.filter((url) => CURATED_QUERY.test(url))

/** Small, predictable curated selection: id 1 is in every fixture sweep and in
 *  none of the Space-Track stand-in catalogues (ids from 101). */
const TEST_CURATED: GpSweepCuratedSelection = { catalogIds: ['1'], maxEpochAgeDays: 30, featuredIds: ['1'], groupMemberIds: ['1'] }

/** Bootstrap review is off by default here; the review tests turn it on. */
function step(bucket: R2BucketLike, provider: GpSweepStepOptions['provider'], nowUtc: string, overrides: Partial<GpSweepStepOptions> = {}) {
  return runGpSweepStep({ bucket, provider, usesUpstream: provider.id !== 'fixture', configurationRevision: 'test-revision', nowUtc, runId: '0b3a7c1e-0000-4000-8000-000000000000', live: null, pageLimit: 10, shardCount: 4, requireBootstrapReview: false, curated: TEST_CURATED, ...overrides })
}

/** Runs hourly steps from `hour` until the candidate is advanced: past its
 *  pages and its staged hour. */
async function completeSweep(bucket: R2BucketLike, objects: Map<string, Stored>, provider: GpSweepStepOptions['provider'], hour: number, overrides: Partial<GpSweepStepOptions> = {}): Promise<{ result: GpSweepStepResult; hour: number }> {
  for (let current = hour; ; current += 1) {
    const result = await step(bucket, provider, at(current), { live: await live(objects), ...overrides })
    if (result.kind !== 'page-staged' && result.kind !== 'candidate-staged') return { result, hour: current }
  }
}

function operatorAction(bucket: R2BucketLike, action: Record<string, unknown>) {
  return bucket.put(GP_SWEEP_OPERATOR_ACTION_KEY, JSON.stringify({ schemaVersion: 1, operator: 'maintainer', ...action }))
}

async function writeState(bucket: R2BucketLike, edit: (state: GpSweepState) => unknown) {
  await bucket.put(GP_SWEEP_STATE_KEY, JSON.stringify(edit((await readGpSweepState(bucket))!)))
}

const quiet = () => { for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined) }

afterEach(() => { vi.restoreAllMocks() })

describe('hourly persistent keyset sweep', () => {
  it('stages full pages privately and publishes only after the hour that follows the terminal short page', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const provider = new FixtureProvider({ sweepRecordCount: 25 })

    expect(await step(bucket, provider, at(0))).toMatchObject({ kind: 'page-staged', pageIndex: 0, recordCount: 10 })
    expect(await step(bucket, provider, at(1))).toMatchObject({ kind: 'page-staged', pageIndex: 1, recordCount: 10 })
    // Incomplete-sweep pages are staging data only: nothing is published or served.
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    expect([...objects.keys()].some((key) => key.startsWith('catalog/v1/snapshots/'))).toBe(false)
    expect(stagedKeys(objects)).toHaveLength(2)
    const context = { waitUntil: () => undefined }
    for (const path of [`/${GP_SWEEP_STATE_KEY}`, `/${stagedKeys(objects)[0]}`]) {
      expect((await serveCatalogueRequest(new Request(`https://example.invalid${path}`), bucket, context)).status).toBe(404)
    }
    expect((await readGpSweepState(bucket))!.sweep!.pages.map((page) => [page.afterCatalogId, page.lastCatalogId])).toEqual([['0', '10'], ['10', '20']])

    // The terminal page completes the candidate but does not build it.
    expect(await step(bucket, provider, at(2))).toEqual({ kind: 'candidate-staged', sweepId: expect.any(String), pageCount: 3, recordCount: 25, upstreamRequestCount: 0 })
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    expect((await readGpSweepState(bucket))!.sweep).toMatchObject({ completedAtUtc: at(2), candidate: { status: 'awaiting-publication', publicationAttempts: 0 } })
    expect((await readGpSweepState(bucket))!.sweep!.supplement).toBeUndefined()

    const published = await step(bucket, provider, at(3))
    expect(published).toMatchObject({ kind: 'published', pageCount: 3, records: 25, upstreamRequestCount: 0, supplement: { status: 'staged', failureKind: null, added: 0 } })
    const current = await live(objects)
    expect(current!.manifest.sourceRun).toMatchObject({ retrievalStartedAtUtc: at(0), retrievedAtUtc: at(2) })
    expect(current!.manifest.generatedAtUtc).toBe(at(3))
    expect(stagedKeys(objects)).toEqual([])
    expect(await readGpSweepState(bucket)).toMatchObject({ sweep: null, lastOutcome: { kind: 'published', reason: 'published' } })

    // After publication the next permitted retrieval starts again from zero.
    expect(await step(bucket, provider, at(4), { live: current })).toMatchObject({ kind: 'page-staged', pageIndex: 0 })
    expect((await readGpSweepState(bucket))!.sweep!.pages[0]).toMatchObject({ afterCatalogId: '0', retrievedAtUtc: at(4) })
  })

  it('makes at most one provider request per hour: pages with the approved predicates and persisted cursor, then the supplement', async () => {
    quiet()
    const { bucket } = fakeBucket()
    const { provider, gpUrls, state } = spaceTrack(Array.from({ length: 25 }, (_, position) => wire(position + 101)))

    await step(bucket, provider, at(0))
    expect(gpUrls).toHaveLength(1)
    expect(gpUrls[0]).toContain('/class/gp/decay_date/null-val/epoch/%3Enow-10/NORAD_CAT_ID/%3E0/orderby/norad_cat_id%20asc/limit/10/format/json')
    expect(state.total).toBe(3)

    expect(await step(bucket, provider, at(0, 10))).toEqual({ kind: 'paced', nextRequestNotBeforeUtc: at(0, 55) })
    expect(await step(bucket, provider, at(0, 54))).toMatchObject({ kind: 'paced' })
    expect(state.total).toBe(3)

    await step(bucket, provider, at(1))
    expect(gpUrls[1]).toContain('/NORAD_CAT_ID/%3E110/')
    expect(await step(bucket, provider, at(2))).toMatchObject({ kind: 'candidate-staged', pageCount: 3, recordCount: 25, upstreamRequestCount: 3 })
    // The supplement waits for the next permitted hour, like a page.
    expect(await step(bucket, provider, at(2, 40))).toEqual({ kind: 'paced', nextRequestNotBeforeUtc: at(2, 55) })
    expect(gpUrls).toHaveLength(3)

    expect(await step(bucket, provider, at(3))).toMatchObject({ kind: 'published', records: 25, upstreamRequestCount: 3, supplement: { status: 'staged' } })
    expect(gpUrls).toHaveLength(4)
    expect(gpUrls[3]).toContain('/class/gp/NORAD_CAT_ID/1/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id%20asc/format/json')
    expect((await readGpSweepState(bucket))!.lastGpRequestAtUtc).toBe(at(3))
  })

  it('leaves the cursor and the previous public snapshot intact after a failed page, without rapid retries', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider, gpUrls, state } = spaceTrack(Array.from({ length: 15 }, (_, position) => wire(position + 101)))
    await completeSweep(bucket, objects, provider, 0)
    const pointerBefore = text(objects.get('catalog/v1/current.json'))

    await step(bucket, provider, at(3), { live: await live(objects) })
    state.gpStatus = 503
    await expect(step(bucket, provider, at(4), { live: await live(objects) })).rejects.toMatchObject({ name: 'ProviderFetchError', kind: 'transient' })
    expect(text(objects.get('catalog/v1/current.json'))).toBe(pointerBefore)
    expect((await readGpSweepState(bucket))!.sweep!.pages).toHaveLength(1)
    expect((await readGpSweepState(bucket))!.lastGpRequestAtUtc).toBe(at(4))
    expect((await readGpSweepState(bucket))!.lastPageFailure).toEqual({ atUtc: at(4), afterCatalogId: '110', kind: 'transient', status: 503, consecutiveFailures: 1 })

    // The failed request still counts: no retry inside the same hour.
    expect(await step(bucket, provider, at(4, 20))).toMatchObject({ kind: 'paced' })
    expect(gpUrls).toHaveLength(5)

    await expect(step(bucket, provider, at(5), { live: await live(objects) })).rejects.toMatchObject({ kind: 'transient' })
    expect((await readGpSweepState(bucket))!.lastPageFailure).toMatchObject({ consecutiveFailures: 2, afterCatalogId: '110' })

    state.gpStatus = 200
    await step(bucket, provider, at(6), { live: await live(objects) })
    expect(gpUrls[6]).toContain('/NORAD_CAT_ID/%3E110/')
    expect((await readGpSweepState(bucket))!.lastPageFailure).toBeNull()
  })

  it('fails a malformed successful page closed without advancing the cursor', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider, gpUrls, state } = spaceTrack(Array.from({ length: 15 }, (_, position) => wire(position + 101)))
    await step(bucket, provider, at(0))
    const before = await readGpSweepState(bucket)

    state.malformed = true
    await expect(step(bucket, provider, at(1))).rejects.toMatchObject({ name: 'ProviderFetchError', kind: 'data', status: 200 })
    const after = await readGpSweepState(bucket)
    expect(after!.sweep).toEqual(before!.sweep)
    expect(after!.lastPageFailure).toMatchObject({ kind: 'data', afterCatalogId: '110', consecutiveFailures: 1 })
    expect(stagedKeys(objects)).toHaveLength(1)

    state.malformed = false
    expect(await step(bucket, provider, at(2))).toMatchObject({ kind: 'candidate-staged', recordCount: 15 })
    expect(await step(bucket, provider, at(3))).toMatchObject({ kind: 'published', records: 15 })
    expect(pageCursors(gpUrls)).toEqual(['0', '110', '110'])
  })

  it('discards an invalid complete candidate, keeps the public catalogue and restarts from zero', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const records = Array.from({ length: 15 }, (_, position) => wire(position + 101, position === 13 ? { CCSDS_OMM_VERS: '2.0' } : {}))
    const { provider, gpUrls } = spaceTrack(records)
    await step(bucket, provider, at(0))
    await step(bucket, provider, at(1))

    expect(await step(bucket, provider, at(2))).toMatchObject({ kind: 'discarded', reason: expect.stringContaining('mixed-omm-version') })
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    expect(stagedKeys(objects)).toEqual([])
    expect(await readGpSweepState(bucket)).toMatchObject({ sweep: null, lastOutcome: { kind: 'discarded' } })

    await step(bucket, provider, at(3))
    expect(gpUrls[3]).toContain('/NORAD_CAT_ID/%3E0/')
  })

  it('retries publication of a complete sweep without another provider request', async () => {
    quiet()
    const { bucket, objects, failPuts } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    failPuts.push({ pattern: /\/snapshots\//, remaining: 1 })

    expect(await step(bucket, provider, at(0))).toMatchObject({ kind: 'candidate-staged' })
    await expect(step(bucket, provider, at(1))).rejects.toThrow('Injected R2 put failure')
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    expect((await readGpSweepState(bucket))!.sweep).toMatchObject({ completedAtUtc: at(0), candidate: { status: 'awaiting-publication', publicationAttempts: 1, lastPublicationError: { atUtc: at(1) } }, supplement: { status: 'staged' } })

    expect(await step(bucket, provider, at(2))).toMatchObject({ kind: 'published', upstreamRequestCount: 0, supplement: { status: 'staged' } })
    expect(gpUrls).toHaveLength(2)
    expect((await live(objects))!.manifest.sourceRun).toMatchObject({ retrievalStartedAtUtc: at(0), retrievedAtUtc: at(0) })
  })

  it('marks a valid candidate publication-failed after bounded retries, keeps it and the public snapshot, and never asks the provider again', async () => {
    quiet()
    const { bucket, objects, failPuts } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    failPuts.push({ pattern: /\/snapshots\//, remaining: 3 })

    await step(bucket, provider, at(0))
    await expect(step(bucket, provider, at(1))).rejects.toThrow('Injected R2 put failure')
    await expect(step(bucket, provider, at(2))).rejects.toThrow('Injected R2 put failure')
    expect(await step(bucket, provider, at(3))).toMatchObject({ kind: 'publication-failed', publicationAttempts: 3, upstreamRequestCount: 0, supplement: { status: 'staged' }, curated: { featuredAbsent: ['1'] } })
    const failed = await readGpSweepState(bucket)
    expect(failed!.sweep!.candidate).toMatchObject({ status: 'publication-failed', publicationAttempts: 3, lastPublicationError: { atUtc: at(3), reason: 'Injected R2 put failure.' } })
    expect(stagedKeys(objects)).toEqual([expect.stringMatching(/page-000\.json$/), supplementKey(failed!.sweep!.sweepId)])
    expect(objects.has('catalog/v1/current.json')).toBe(false)

    // Nothing happens on its own: no provider request and no publication retry.
    expect(await step(bucket, provider, at(7))).toMatchObject({ kind: 'publication-failed', upstreamRequestCount: 0, curated: null })
    expect((await readGpSweepState(bucket))!.sweep!.candidate!.publicationAttempts).toBe(3)

    // An action for another sweep is removed and ignored.
    await operatorAction(bucket, { action: 'retry-publication', sweepId: '20260101T000000Z-0badc0de' })
    expect(await step(bucket, provider, at(8))).toMatchObject({ kind: 'publication-failed' })
    expect(objects.has(GP_SWEEP_OPERATOR_ACTION_KEY)).toBe(false)

    await operatorAction(bucket, { action: 'retry-publication', sweepId: failed!.sweep!.sweepId })
    expect(await step(bucket, provider, at(9))).toMatchObject({ kind: 'published', records: 5, upstreamRequestCount: 0 })
    expect(objects.has(GP_SWEEP_OPERATOR_ACTION_KEY)).toBe(false)
    expect(stagedKeys(objects)).toEqual([])
    expect(gpUrls).toHaveLength(2)
  })

  it('discards a publication-failed candidate only at the maximum sweep age', async () => {
    quiet()
    const { bucket, failPuts } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    failPuts.push({ pattern: /\/snapshots\//, remaining: 3 })
    await step(bucket, provider, at(0))
    for (const hour of [1, 2]) await expect(step(bucket, provider, at(hour))).rejects.toThrow()
    await step(bucket, provider, at(3))

    expect(await step(bucket, provider, at(47))).toMatchObject({ kind: 'publication-failed' })
    expect(gpUrls).toHaveLength(2)
    expect(await step(bucket, provider, at(49))).toMatchObject({ kind: 'candidate-staged' })
    expect((await readGpSweepState(bucket))!.lastOutcome).toMatchObject({ kind: 'discarded', reason: 'expired' })
    expect(gpUrls[2]).toContain('/NORAD_CAT_ID/%3E0/')
    expect(await step(bucket, provider, at(50))).toMatchObject({ kind: 'published' })
  })

  it('discards a sweep whose configuration changed or that has grown too old', async () => {
    quiet()
    const { bucket } = fakeBucket()
    const provider = new FixtureProvider({ sweepRecordCount: 25 })
    await step(bucket, provider, at(0))

    expect(await step(bucket, provider, at(1), { configurationRevision: 'next-revision' })).toMatchObject({ kind: 'page-staged', pageIndex: 0 })
    expect((await readGpSweepState(bucket))!.lastOutcome).toMatchObject({ kind: 'discarded', reason: 'configuration-changed' })

    expect(await step(bucket, provider, at(50), { configurationRevision: 'next-revision' })).toMatchObject({ kind: 'page-staged', pageIndex: 0 })
    expect((await readGpSweepState(bucket))!.lastOutcome).toMatchObject({ kind: 'discarded', reason: 'expired' })
  })
})

describe('curated member supplement', () => {
  const SWEEP = Array.from({ length: 15 }, (_, position) => wire(position + 101))
  /** 105 and 900 are curated; 105 is also in the sweep with different
   *  content; 900 has left the ten-day window; 901 is decayed or too old, so
   *  the provider does not return it. */
  const CURATED: GpSweepCuratedSelection = { catalogIds: ['105', '900', '901'], maxEpochAgeDays: 30, featuredIds: ['900', '901'], groupMemberIds: ['105', '900', '901'] }
  const CURATED_RECORDS = [wire(105, { OBJECT_NAME: 'SUPPLEMENT 105' }), wire(900, { OBJECT_NAME: 'ASBM 2', EPOCH: '2026-08-30T13:47:00.000000' })]

  it('fills curated ids the sweep lacks, keeps the sweep record for ids it has, and names the supplement in the run', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
    const options = { curated: CURATED }
    await step(bucket, provider, at(0), options)
    expect(await step(bucket, provider, at(1), options)).toMatchObject({ kind: 'candidate-staged', recordCount: 15 })
    const staged = await readGpSweepState(bucket)

    const published = await step(bucket, provider, at(2), options)
    expect(published).toEqual(expect.objectContaining({
      kind: 'published', records: 16, upstreamRequestCount: 3,
      supplement: { status: 'staged', failureKind: null, added: 1 },
      curated: { featuredAbsent: ['901'], featuredEpochs: { 900: '2026-08-30' }, groupMembersAbsent: 1, supplemented: 1 },
    }))
    expect(curatedUrls(gpUrls)).toEqual([expect.stringContaining('/class/gp/NORAD_CAT_ID/105,900,901/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id%20asc/format/json')])
    const entries = await publishedEntries(objects)
    expect(entries.get('105')!.name).toBe('SYNTHETIC 105')
    expect(entries.get('900')).toMatchObject({ name: 'ASBM 2', epochUtc: expect.stringMatching(/^2026-08-30T13:47:00/) })
    expect(entries.has('901')).toBe(false)
    const manifest = (await live(objects))!.manifest
    expect(manifest.sourceRun!.queryDescription).toBe(`${SPACE_TRACK_GP_SWEEP_DESCRIPTOR.queryDescription}${SPACE_TRACK_GP_SWEEP_DESCRIPTOR.supplementDescription}`)
    expect(manifest.sourceRun!.queryDescription).toContain('within the last 30 days')
    // The supplement goes with the page prefix.
    expect(objects.has(supplementKey(staged!.sweep!.sweepId))).toBe(false)
  })

  it.each([
    ['provider 5xx', 503, 'transient', 503],
    ['rate limit', 429, 'rate-limit', 429],
    ['refused session', 403, 'authentication', 403],
    ['moved endpoint', 404, 'configuration', 404],
  ] as const)('a supplement %s publishes the sweep alone in the same run and keeps the failure for the operator', async (_, status, kind, recorded) => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider, gpUrls, state } = spaceTrack(SWEEP, CURATED_RECORDS)
    const failures: ProviderFetchError[] = []
    const options = { curated: CURATED, onSupplementProviderFailure: (error: ProviderFetchError) => { failures.push(error) } }
    await step(bucket, provider, at(0), options)
    await step(bucket, provider, at(1), options)
    state.curatedStatus = status

    expect(await step(bucket, provider, at(2), options)).toMatchObject({ kind: 'published', records: 15, upstreamRequestCount: 0, supplement: { status: 'failed', failureKind: kind, added: 0 }, curated: { featuredAbsent: ['900', '901'], supplemented: 0 } })
    expect(failures.map((error) => [error.kind, error.status])).toEqual([[kind, recorded]])
    expect((await live(objects))!.manifest.sourceRun!.queryDescription).toBe(SPACE_TRACK_GP_SWEEP_DESCRIPTOR.queryDescription)
    expect((await readGpSweepState(bucket))!.lastGpRequestAtUtc).toBe(at(2))
    expect(curatedUrls(gpUrls)).toHaveLength(1)
    // The next sweep tries again.
    state.curatedStatus = 200
    expect((await completeSweep(bucket, objects, provider, 3, options)).result).toMatchObject({ kind: 'published', records: 16, supplement: { status: 'staged' } })
  })

  it('refuses a malformed or unrequested supplement response as data and publishes the sweep alone', async () => {
    quiet()
    for (const body of ['{"error":"x"}', JSON.stringify([wire(902)]), JSON.stringify([wire(900), wire(105)])]) {
      const { bucket } = fakeBucket()
      const { provider, state } = spaceTrack(SWEEP, CURATED_RECORDS)
      await step(bucket, provider, at(0), { curated: CURATED })
      await step(bucket, provider, at(1), { curated: CURATED })
      state.curatedBody = body
      expect(await step(bucket, provider, at(2), { curated: CURATED }), body).toMatchObject({ kind: 'published', records: 15, supplement: { status: 'failed', failureKind: 'data' } })
    }
  })

  it('refuses an invalid curated list before any traffic, as a configuration failure', async () => {
    quiet()
    const { bucket } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
    const failures: ProviderFetchError[] = []
    const options = { curated: { ...CURATED, catalogIds: ['900', '105'] }, onSupplementProviderFailure: (error: ProviderFetchError) => { failures.push(error) } }
    await step(bucket, provider, at(0), options)
    await step(bucket, provider, at(1), options)
    expect(await step(bucket, provider, at(2), options)).toMatchObject({ kind: 'published', supplement: { status: 'failed', failureKind: 'configuration' } })
    expect(curatedUrls(gpUrls)).toEqual([])
    expect(failures.map((error) => error.kind)).toEqual(['configuration'])
  })

  it('records an interrupted supplement request as failed and never repeats it', async () => {
    quiet()
    const { bucket } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
    await step(bucket, provider, at(0), { curated: CURATED })
    await step(bucket, provider, at(1), { curated: CURATED })
    // As left by a run killed after writing the request and before its result.
    await writeState(bucket, (state) => ({ ...state, lastGpRequestAtUtc: at(2), sweep: { ...state.sweep!, supplement: { requestedAtUtc: at(2), status: 'requested', staged: null, failure: null } } }))

    expect(await step(bucket, provider, at(3), { curated: CURATED })).toMatchObject({ kind: 'published', records: 15, upstreamRequestCount: 0, supplement: { status: 'failed', failureKind: 'interrupted' } })
    expect(curatedUrls(gpUrls)).toEqual([])
  })

  it('records a supplement that cannot be staged as failed and publishes the sweep alone', async () => {
    quiet()
    const { bucket, failPuts } = fakeBucket()
    const { provider } = spaceTrack(SWEEP, CURATED_RECORDS)
    await step(bucket, provider, at(0), { curated: CURATED })
    await step(bucket, provider, at(1), { curated: CURATED })
    failPuts.push({ pattern: /supplement\.json$/, remaining: 1 })
    expect(await step(bucket, provider, at(2), { curated: CURATED })).toMatchObject({ kind: 'published', records: 15, supplement: { status: 'failed', failureKind: 'staging' } })
  })

  it.each([
    ['missing', (objects: Map<string, Stored>, key: string) => { objects.delete(key) }],
    ['altered', (objects: Map<string, Stored>, key: string) => { const bytes = new Uint8Array(objects.get(key)!.bytes); bytes[bytes.length - 2] ^= 1; objects.set(key, { bytes, etag: 'tampered' }) }],
  ])('builds from the sweep alone when the staged supplement is %s at a publication retry', async (_, tamper) => {
    quiet()
    const { bucket, objects, failPuts } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
    await step(bucket, provider, at(0), { curated: CURATED })
    await step(bucket, provider, at(1), { curated: CURATED })
    failPuts.push({ pattern: /\/snapshots\//, remaining: 1 })
    await expect(step(bucket, provider, at(2), { curated: CURATED })).rejects.toThrow('Injected R2 put failure')
    const sweepId = (await readGpSweepState(bucket))!.sweep!.sweepId
    tamper(objects, supplementKey(sweepId))

    expect(await step(bucket, provider, at(3), { curated: CURATED })).toMatchObject({ kind: 'published', records: 15, upstreamRequestCount: 0, supplement: { status: 'failed', failureKind: 'build' } })
    expect(curatedUrls(gpUrls)).toHaveLength(1)
  })

  it('builds from the sweep alone when the supplement breaks whole-run normalization', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider } = spaceTrack(SWEEP, [wire(900, { CCSDS_OMM_VERS: '2.0' })])
    await step(bucket, provider, at(0), { curated: CURATED })
    await step(bucket, provider, at(1), { curated: CURATED })
    expect(await step(bucket, provider, at(2), { curated: CURATED })).toMatchObject({ kind: 'published', records: 15, supplement: { status: 'failed', failureKind: 'build' } })
    expect((await publishedEntries(objects)).has('900')).toBe(false)
  })

  it('reuses the staged supplement for review approval with no request, and re-holds when it fails between hold and approval', async () => {
    quiet()
    const review = { requireBootstrapReview: true, curated: CURATED }
    for (const failBetween of [false, true]) {
      const { bucket, objects } = fakeBucket()
      const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
      await step(bucket, provider, at(0), review)
      await step(bucket, provider, at(1), review)
      const held = await step(bucket, provider, at(2), review)
      expect(held).toMatchObject({ kind: 'held-for-review', upstreamRequestCount: 3, supplement: { status: 'staged', added: 1 } })
      if (held.kind !== 'held-for-review') throw new Error('expected a hold')
      expect(JSON.parse(text(objects.get(GP_SWEEP_REVIEW_KEY)))).toMatchObject({ supplement: { status: 'staged', added: 1 }, curated: { supplemented: 1 }, summary: { publishedCount: 16 } })
      if (failBetween) objects.delete(supplementKey(held.sweepId))

      await operatorAction(bucket, { action: 'approve-publication', sweepId: held.sweepId, contentDigest: held.contentDigest })
      const next = await step(bucket, provider, at(3), review)
      expect(curatedUrls(gpUrls)).toHaveLength(1)
      if (!failBetween) {
        expect(next).toMatchObject({ kind: 'published', records: 16, upstreamRequestCount: 0, approvedFindings: ['bootstrap-first-automatic-snapshot'] })
        continue
      }
      // The content changed, so the approval no longer applies.
      expect(next).toMatchObject({ kind: 'held-for-review', supplement: { status: 'failed', failureKind: 'build' } })
      if (next.kind !== 'held-for-review') throw new Error('expected a hold')
      expect(next.contentDigest).not.toBe(held.contentDigest)
      await operatorAction(bucket, { action: 'approve-publication', sweepId: next.sweepId, contentDigest: next.contentDigest })
      expect(await step(bucket, provider, at(4), review)).toMatchObject({ kind: 'published', records: 15 })
    }
  })

  it('requests the supplement first when an operator discard waits in the supplement hour', async () => {
    quiet()
    const { bucket } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(SWEEP, CURATED_RECORDS)
    await step(bucket, provider, at(0), { curated: CURATED })
    const staged = await step(bucket, provider, at(1), { curated: CURATED })
    await operatorAction(bucket, { action: 'discard-candidate', sweepId: (staged as { sweepId: string }).sweepId })
    expect(await step(bucket, provider, at(2), { curated: CURATED })).toMatchObject({ kind: 'discarded', reason: 'operator-discard', upstreamRequestCount: 3 })
    expect(curatedUrls(gpUrls)).toHaveLength(1)
  })

  it('publishes a fixture candidate one invocation after the terminal page, with synthetic curated members', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const provider = new FixtureProvider({ sweepRecordCount: 8 })
    const curated = { catalogIds: ['3', '25544'], maxEpochAgeDays: 30, featuredIds: ['25544'], groupMemberIds: ['3', '25544'] }
    expect(await step(bucket, provider, at(0), { curated })).toMatchObject({ kind: 'candidate-staged', recordCount: 8 })
    expect(await step(bucket, provider, at(0, 1), { curated })).toMatchObject({ kind: 'published', records: 9, supplement: { status: 'staged', added: 1 }, curated: { featuredAbsent: [], groupMembersAbsent: 0 } })
    expect((await publishedEntries(objects)).get('3')!.name).toBe('FIXTURE OBJECT 3')
    expect((await live(objects))!.manifest.sourceRun!.queryDescription).toContain('synthetic curated members')
  })

  it('keeps every supplemented query description inside the public contract bound', () => {
    for (const descriptor of [SPACE_TRACK_GP_SWEEP_DESCRIPTOR, new FixtureProvider().sweepDescriptor]) {
      expect(`${descriptor.queryDescription}${descriptor.supplementDescription}`.length).toBeLessThanOrEqual(500)
      expect(descriptor.supplementDescription.startsWith('; ')).toBe(true)
    }
  })
})

/** `validState` of the producer before the curated supplement, verbatim apart
 *  from being wrapped here: the rollback target reads states the new producer
 *  writes. */
function previousProducerValidState(value: unknown): boolean {
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
  const CATALOG_ID = /^[1-9]\d{0,8}$/
  const SWEEP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/
  const DIGEST = /^[0-9a-f]{64}$/
  const OPERATOR = /^[A-Za-z0-9 ._@-]{1,80}$/
  const FAILURE_KINDS: readonly unknown[] = ['configuration', 'authentication', 'rate-limit', 'transient', 'data']
  const FINDING_KINDS: readonly unknown[] = ['bootstrap-first-automatic-snapshot', 'published-count-drop', 'rejected-ratio-exceeded']
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
  const isTime = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value)
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const isCursor = (value: unknown): boolean => value === '0' || (typeof value === 'string' && CATALOG_ID.test(value))
  function validCandidate(value: unknown): boolean {
    if (!isObject(value) || !['awaiting-publication', 'held-for-review', 'publication-failed'].includes(value.status as string) || !isCount(value.publicationAttempts)) return false
    const error = value.lastPublicationError
    if (error !== null && !(isObject(error) && isTime(error.atUtc) && typeof error.reason === 'string')) return false
    const review = value.review
    if (review !== null && !(isObject(review) && isTime(review.heldAtUtc) && typeof review.contentDigest === 'string' && DIGEST.test(review.contentDigest) && Array.isArray(review.findings) && review.findings.every((kind) => FINDING_KINDS.includes(kind)))) return false
    if ((value.status === 'held-for-review') !== (review !== null)) return false
    const approval = value.approval
    return approval === null || (isObject(approval) && typeof approval.contentDigest === 'string' && DIGEST.test(approval.contentDigest) && typeof approval.operator === 'string' && OPERATOR.test(approval.operator) && isTime(approval.approvedAtUtc))
  }
  if (!isObject(value) || value.schemaVersion !== 1 || !(value.lastGpRequestAtUtc === null || isTime(value.lastGpRequestAtUtc))) return false
  const failure = value.lastPageFailure
  if (failure !== null && !(isObject(failure) && isTime(failure.atUtc) && isCursor(failure.afterCatalogId) && FAILURE_KINDS.includes(failure.kind) && (failure.status === null || isCount(failure.status)) && isCount(failure.consecutiveFailures) && failure.consecutiveFailures >= 1)) return false
  const outcome = value.lastOutcome
  if (outcome !== null && !(isObject(outcome) && (outcome.kind === 'published' || outcome.kind === 'discarded') && typeof outcome.sweepId === 'string' && isTime(outcome.atUtc) && typeof outcome.reason === 'string')) return false
  const sweep = value.sweep
  if (sweep === null) return true
  if (!isObject(sweep) || typeof sweep.sweepId !== 'string' || !SWEEP_ID.test(sweep.sweepId) || typeof sweep.providerId !== 'string' || typeof sweep.configurationRevision !== 'string' || !isCount(sweep.pageLimit) || sweep.pageLimit < 1 || !isTime(sweep.startedAtUtc) || !(sweep.completedAtUtc === null || isTime(sweep.completedAtUtc)) || !Array.isArray(sweep.pages) || sweep.pages.length === 0 || sweep.pages.length > GP_SWEEP_MAX_PAGES) return false
  if ((sweep.completedAtUtc === null) !== (sweep.candidate === null) || (sweep.candidate !== null && !validCandidate(sweep.candidate))) return false
  return sweep.pages.every((page) => isObject(page) && isCount(page.index) && isCursor(page.afterCatalogId) && (page.firstCatalogId === null || (typeof page.firstCatalogId === 'string' && CATALOG_ID.test(page.firstCatalogId))) && (page.lastCatalogId === null || (typeof page.lastCatalogId === 'string' && CATALOG_ID.test(page.lastCatalogId))) && isCount(page.recordCount) && isCount(page.byteLength) && typeof page.sha256 === 'string' && DIGEST.test(page.sha256) && isTime(page.retrievedAtUtc))
}

describe('rollback to the producer before the curated supplement', () => {
  it('writes states with every supplement status that the previous producer still accepts, and that this producer checks', async () => {
    quiet()
    const { bucket, objects, failPuts } = fakeBucket()
    const { provider, state: upstream } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    const raw = () => JSON.parse(text(objects.get(GP_SWEEP_STATE_KEY)))
    await step(bucket, provider, at(0))
    const candidate = raw()
    expect(previousProducerValidState(candidate)).toBe(true)

    const statuses: unknown[] = []
    failPuts.push({ pattern: /\/snapshots\//, remaining: 1 })
    await expect(step(bucket, provider, at(1))).rejects.toThrow()
    statuses.push(raw())
    await writeState(bucket, () => candidate)
    upstream.curatedStatus = 429
    failPuts.push({ pattern: /\/snapshots\//, remaining: 1 })
    await expect(step(bucket, provider, at(2))).rejects.toThrow()
    statuses.push(raw())
    const requested = { ...candidate, sweep: { ...candidate.sweep, supplement: { requestedAtUtc: at(3), status: 'requested', staged: null, failure: null } } }
    statuses.push(requested)
    expect(statuses.map((state) => (state as GpSweepState).sweep!.supplement!.status)).toEqual(['staged', 'failed', 'requested'])
    for (const state of statuses) {
      expect(previousProducerValidState(state)).toBe(true)
      await writeState(bucket, () => state)
      await expect(readGpSweepState(bucket)).resolves.toBeTruthy()
    }

    // Inconsistent supplements fail closed here, as any invalid state does.
    const staged = statuses[0] as GpSweepState
    for (const broken of [
      { ...staged.sweep!.supplement!, staged: null },
      { ...staged.sweep!.supplement!, status: 'failed' },
      { ...staged.sweep!.supplement!, staged: { ...staged.sweep!.supplement!.staged!, sha256: 'no' } },
    ]) {
      await bucket.put(GP_SWEEP_STATE_KEY, JSON.stringify({ ...staged, sweep: { ...staged.sweep, supplement: broken } }))
      await expect(readGpSweepState(bucket)).rejects.toThrow('invalid')
    }
    await bucket.put(GP_SWEEP_STATE_KEY, JSON.stringify({ ...staged, sweep: { ...staged.sweep, candidate: null, completedAtUtc: null } }))
    await expect(readGpSweepState(bucket)).rejects.toThrow('invalid')
  })
})

describe('publication policy review', () => {
  it('holds the first live automatic candidate privately for bootstrap review and publishes only the approved digest', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider, gpUrls } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    const review = { requireBootstrapReview: true }

    expect(await step(bucket, provider, at(0), review)).toMatchObject({ kind: 'candidate-staged', upstreamRequestCount: 3 })
    const held = await step(bucket, provider, at(1), review)
    expect(held).toMatchObject({ kind: 'held-for-review', findings: ['bootstrap-first-automatic-snapshot'], upstreamRequestCount: 3 })
    if (held.kind !== 'held-for-review') throw new Error('expected a hold')
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    const evidence = JSON.parse(text(objects.get(GP_SWEEP_REVIEW_KEY)))
    expect(evidence).toMatchObject({ sweepId: held.sweepId, contentDigest: held.contentDigest, pageCount: 1, findings: [{ kind: 'bootstrap-first-automatic-snapshot' }], summary: { publishedCount: 5, rejectedCount: 0 }, typeCategories: { payload: 5 } })
    expect(evidence.representativeRecords).toHaveLength(5)

    const context = { waitUntil: () => undefined }
    await operatorAction(bucket, { action: 'approve-publication', sweepId: held.sweepId, contentDigest: '0'.repeat(64) })
    for (const key of [GP_SWEEP_REVIEW_KEY, GP_SWEEP_OPERATOR_ACTION_KEY, supplementKey(held.sweepId)]) {
      expect((await serveCatalogueRequest(new Request(`https://example.invalid/${key}`), bucket, context)).status).toBe(404)
    }

    // A wrong digest is consumed and changes nothing; no provider request while held.
    expect(await step(bucket, provider, at(3), review)).toMatchObject({ kind: 'held-for-review', upstreamRequestCount: 0 })
    expect(objects.has(GP_SWEEP_OPERATOR_ACTION_KEY)).toBe(false)
    expect(gpUrls).toHaveLength(2)

    await operatorAction(bucket, { action: 'approve-publication', sweepId: held.sweepId, contentDigest: held.contentDigest })
    expect(await step(bucket, provider, at(4), review)).toMatchObject({ kind: 'published', approvedFindings: ['bootstrap-first-automatic-snapshot'], upstreamRequestCount: 0 })
    expect((await readGpSweepState(bucket))!.lastOutcome).toMatchObject({ kind: 'published', reason: 'published; approved by maintainer' })
    expect(objects.has(GP_SWEEP_REVIEW_KEY)).toBe(false)
    expect(gpUrls).toHaveLength(2)

    // The next sweep compares against that snapshot and needs no bootstrap review.
    expect((await completeSweep(bucket, objects, provider, 5, review)).result).toMatchObject({ kind: 'published' })
  })

  it('never lets an approval mask a structural failure', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider } = spaceTrack(Array.from({ length: 5 }, (_, position) => wire(position + 101)))
    await step(bucket, provider, at(0), { requireBootstrapReview: true })
    const held = await step(bucket, provider, at(1), { requireBootstrapReview: true })
    if (held.kind !== 'held-for-review') throw new Error('expected a hold')
    const pageKey = stagedKeys(objects).find((key) => key.endsWith('page-000.json'))!
    const tampered = new Uint8Array(objects.get(pageKey)!.bytes)
    tampered[tampered.length - 2] ^= 1
    objects.set(pageKey, { bytes: tampered, etag: 'tampered' })

    await operatorAction(bucket, { action: 'approve-publication', sweepId: held.sweepId, contentDigest: held.contentDigest })
    expect(await step(bucket, provider, at(2), { requireBootstrapReview: true })).toMatchObject({ kind: 'discarded', reason: expect.stringContaining('does not match its recorded digest') })
    expect(objects.has('catalog/v1/current.json')).toBe(false)
    expect(objects.has(GP_SWEEP_REVIEW_KEY)).toBe(false)
    expect(stagedKeys(objects)).toEqual([])
  })

  it('holds a drop of more than 10 percent, publishes ordinary churn, and discards a collapse', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    let { hour } = await completeSweep(bucket, objects, new FixtureProvider({ sweepRecordCount: 50 }), 0)
    const baseline = (await live(objects))!.manifest.snapshotId

    ;({ hour } = await completeSweep(bucket, objects, new FixtureProvider({ sweepRecordCount: 46 }), hour + 1))
    expect((await live(objects))!.manifest.automaticSummary!.publishedCount).toBe(46)

    const drop = await completeSweep(bucket, objects, new FixtureProvider({ sweepRecordCount: 41 }), hour + 1)
    expect(drop.result).toMatchObject({ kind: 'held-for-review', findings: ['published-count-drop'] })
    expect((await live(objects))!.manifest.automaticSummary!.publishedCount).toBe(46)
    await operatorAction(bucket, { action: 'discard-candidate', sweepId: (drop.result as { sweepId: string }).sweepId })
    expect(await step(bucket, new FixtureProvider({ sweepRecordCount: 41 }), at(drop.hour + 1), { live: await live(objects) })).toMatchObject({ kind: 'discarded', reason: 'operator-discard' })

    const collapse = await completeSweep(bucket, objects, new FixtureProvider({ sweepRecordCount: 20 }), drop.hour + 2)
    expect(collapse.result).toMatchObject({ kind: 'discarded', reason: expect.stringContaining('collapsed') })
    expect((await live(objects))!.manifest.automaticSummary!.publishedCount).toBe(46)
    expect((await live(objects))!.manifest.snapshotId).not.toBe(baseline)
  })

  it('holds a candidate over the rejected-record ratio until approved', async () => {
    quiet()
    const { bucket, objects } = fakeBucket()
    const { provider } = spaceTrack(Array.from({ length: 15 }, (_, position) => wire(position + 101, position === 3 ? { MEAN_MOTION: 'fast' } : {})))
    await step(bucket, provider, at(0))
    await step(bucket, provider, at(1))
    const held = await step(bucket, provider, at(2))
    expect(held).toMatchObject({ kind: 'held-for-review', findings: ['rejected-ratio-exceeded'] })
    expect(JSON.parse(text(objects.get(GP_SWEEP_REVIEW_KEY)))).toMatchObject({ summary: { receivedCount: 15, rejectedCount: 1, rejectedByReason: { 'omm-number': 1 } } })

    await operatorAction(bucket, { action: 'approve-publication', sweepId: (held as { sweepId: string }).sweepId, contentDigest: (held as { contentDigest: string }).contentDigest })
    expect(await step(bucket, provider, at(3))).toMatchObject({ kind: 'published', records: 14 })
  })
})
