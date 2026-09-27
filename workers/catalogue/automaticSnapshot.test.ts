import { describe, expect, it } from 'vitest'
import { AUTOMATIC_SHARD_COUNT, buildAutomaticCatalogueSnapshot, type BuiltAutomaticSnapshot } from './automaticSnapshot.ts'
import { createSpaceTrackDialectSweepNormalizer } from './provider/spaceTrackSourceRecord.ts'
import { SPACE_TRACK_GP_SWEEP_DESCRIPTOR } from './provider/spaceTrack.ts'
import { catalogueProfileMode, indexEntryMatchesRecord } from '../../src/data/catalogueProfile.ts'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCatalogueShard, sha256Hex, stableJson } from '../../src/data/catalogueSchema.ts'
import * as legacySchema from '../../src/data/fixtures/legacyCatalogueSchema.ts'

const RETRIEVAL = { retrievalStartedAtUtc: '2026-09-14T00:17:02.000Z', retrievedAtUtc: '2026-09-14T07:17:03.000Z' }
const BUILD = { nowUtc: '2026-09-14T07:17:09.000Z', configurationRevision: 'test-revision', shardCount: 4 }

/** Synthetic Space-Track-dialect GP record; no provider record is copied. */
function wire(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', CREATION_DATE: '2026-09-13T06:26:37', ORIGINATOR: '18 SPCS', OBJECT_NAME: `SYNTHETIC ${id}`, OBJECT_ID: `2020-${String(id % 1000).padStart(3, '0')}A`,
    CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4', EPOCH: '2026-09-12T22:41:08.689632',
    MEAN_MOTION: '15.49180977', ECCENTRICITY: '0.00016340', INCLINATION: '51.6446', RA_OF_ASC_NODE: String((id * 7) % 360), ARG_OF_PERICENTER: '35.3131', MEAN_ANOMALY: '60.2620',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: String(id), ELEMENT_SET_NO: '999', REV_AT_EPOCH: '47210', BSTAR: '0.00001654', MEAN_MOTION_DOT: '0.00000915', MEAN_MOTION_DDOT: '0',
    OBJECT_TYPE: 'PAYLOAD', COUNTRY_CODE: 'US', LAUNCH_DATE: '2020-01-07', ...overrides,
  }
}

const catalogue = (count: number, overrides: (id: number) => Record<string, unknown> = () => ({})) => Array.from({ length: count }, (_, position) => wire(position + 1, overrides(position + 1)))

/** Feeds records through the sweep normalizer as consecutive keyset pages. */
function normalizedPages(records: readonly Record<string, unknown>[], pageLimit: number) {
  const normalizer = createSpaceTrackDialectSweepNormalizer(SPACE_TRACK_GP_SWEEP_DESCRIPTOR)
  let after = '0'
  for (let start = 0; start <= records.length; start += pageLimit) {
    const page = records.slice(start, start + pageLimit)
    normalizer.addPage(new TextEncoder().encode(JSON.stringify(page)), after, pageLimit)
    if (page.length > 0) after = String(page.at(-1)!.NORAD_CAT_ID)
    if (page.length < pageLimit) break
  }
  const result = normalizer.finish({ ...RETRIEVAL, supplemented: false })
  if (!result.ok) throw new Error(`normalization failed: ${result.failure}`)
  return result
}

async function build(records: readonly Record<string, unknown>[], options: Partial<Parameters<typeof buildAutomaticCatalogueSnapshot>[1]> = {}, pageLimit = 1_000) {
  const { batch, report } = normalizedPages(records, pageLimit)
  return buildAutomaticCatalogueSnapshot({ providerName: SPACE_TRACK_GP_SWEEP_DESCRIPTOR.providerName, providerHomepage: SPACE_TRACK_GP_SWEEP_DESCRIPTOR.providerHomepage, batch, report }, { ...BUILD, ...options })
}

async function decodeBuilt(snapshot: BuiltAutomaticSnapshot, decoders: { decodeCatalogueManifest: typeof decodeCatalogueManifest; decodeCatalogueIndex: typeof decodeCatalogueIndex; decodeCatalogueShard: typeof decodeCatalogueShard } = { decodeCatalogueManifest, decodeCatalogueIndex, decodeCatalogueShard }) {
  const read = (key: string) => JSON.parse(new TextDecoder().decode(snapshot.bytes.get(key)!))
  const root = `catalog/v1/snapshots/${snapshot.snapshotId}/`
  const manifest = decoders.decodeCatalogueManifest(read(`${root}manifest.json`))
  for (const part of [manifest.index, ...manifest.shards]) {
    const bytes = snapshot.bytes.get(part.path.slice(1))!
    expect(bytes.byteLength).toBe(part.byteLength)
    expect(await sha256Hex(bytes)).toBe(part.sha256)
  }
  const index = decoders.decodeCatalogueIndex(read(`${root}search-index.json`), manifest)
  const shards = manifest.shards.map((part) => decoders.decodeCatalogueShard(read(part.path.slice(1)), manifest, part.shard))
  return { manifest, index, shards }
}

describe('automatic snapshot construction', () => {
  it('builds a complete automatic profile the current and pinned legacy decoders accept', async () => {
    const snapshot = await build(catalogue(25), { shardCount: undefined }, 10)
    expect(snapshot.snapshotId).toMatch(/^20260914T071709Z-[0-9a-f]{12}$/)
    expect(snapshot.bytes.size).toBe(AUTOMATIC_SHARD_COUNT + 2)

    const { manifest, index, shards } = await decodeBuilt(snapshot)
    expect(catalogueProfileMode(manifest)).toBe('automatic')
    expect(manifest.shardCount).toBe(AUTOMATIC_SHARD_COUNT)
    expect(manifest.groups).toEqual([])
    expect(manifest.sourceRun).toMatchObject({ providerId: 'space-track', retrievalStartedAtUtc: RETRIEVAL.retrievalStartedAtUtc, retrievedAtUtc: RETRIEVAL.retrievedAtUtc, ommVersion: '3.0', originator: '18 SPCS' })
    expect(manifest.provider.retrievedAtUtc).toBe(RETRIEVAL.retrievedAtUtc)
    expect(manifest.automaticSummary).toMatchObject({ receivedCount: 25, rejectedCount: 0, publishedCount: 25, optionalFieldCoverage: { 'object.type': 25, 'object.decayDate': 0 } })
    expect(index.entries).toHaveLength(25)
    for (const entry of index.entries) {
      const record = shards[entry.shard].records[entry.catalogId]
      expect(indexEntryMatchesRecord(entry, record)).toBe(true)
      expect(record.provenance).toMatchObject({ kind: 'catalogue', providerId: 'space-track', providerRetrievedAtUtc: RETRIEVAL.retrievedAtUtc, snapshotId: snapshot.snapshotId, groups: [] })
    }

    const pinned = await decodeBuilt(snapshot, legacySchema)
    expect(pinned.index.entries).toHaveLength(25)
  })

  it('streams byte-identical canonical parts: the chunked index equals the canonical JSON of its content', async () => {
    const snapshot = await build(catalogue(4_321), {}, 1_000)
    const indexBytes = snapshot.bytes.get(`catalog/v1/snapshots/${snapshot.snapshotId}/search-index.json`)!
    const text = new TextDecoder().decode(indexBytes)
    expect(text).toBe(stableJson(JSON.parse(text)))
    expect(JSON.parse(text).entries).toHaveLength(4_321)
    for (const [key, bytes] of snapshot.bytes) { const partText = new TextDecoder().decode(bytes); expect(partText, key).toBe(stableJson(JSON.parse(partText))) }
  })

  it('gives the same bytes and digest whatever the page boundaries and provider order', async () => {
    const records = catalogue(23)
    const onePage = await build(records, {}, 1_000)
    const manyPages = await build(records, {}, 5)
    expect(manyPages.contentDigest).toBe(onePage.contentDigest)
    expect(manyPages.snapshotId).toBe(onePage.snapshotId)
    for (const [key, bytes] of onePage.bytes) expect(manyPages.bytes.get(key)).toEqual(bytes)
  })

  it('changes identity for source-only metadata and retrieval provenance changes', async () => {
    const base = await build(catalogue(12))
    const sourceOnly = await build(catalogue(12, (id) => (id === 7 ? { COUNTRY_CODE: 'FR' } : {})))
    expect(sourceOnly.contentDigest).not.toBe(base.contentDigest)
    expect(sourceOnly.snapshotId).not.toBe(base.snapshotId)

    const { batch, report } = normalizedPages(catalogue(12), 1_000)
    const laterStart = await buildAutomaticCatalogueSnapshot(
      { providerName: 'Space-Track.org', providerHomepage: 'https://example.invalid/', batch: { ...batch, run: { ...batch.run, retrievalStartedAtUtc: '2026-09-14T00:17:03.000Z' } }, report },
      BUILD,
    )
    expect(laterStart.contentDigest).not.toBe(base.contentDigest)
    // Publication time is carried by the id's timestamp, not the digest.
    expect((await build(catalogue(12), { nowUtc: '2026-09-14T08:17:09.000Z' })).contentDigest).toBe(base.contentDigest)
  })

  it('holds a candidate over the rejected-record ratio for review and counts accepted rejections by reason', async () => {
    const over = await build(catalogue(10, (id) => (id === 4 ? { MEAN_MOTION: 'fast' } : {})))
    expect(over.findings).toEqual([{ kind: 'rejected-ratio-exceeded', receivedCount: 10, rejectedCount: 1 }])
    const within = await build(catalogue(400, (id) => (id === 4 ? { MEAN_MOTION: 'fast' } : {})), {}, 100)
    expect(within.findings).toEqual([])
    expect(within.manifest.automaticSummary).toMatchObject({ receivedCount: 400, rejectedCount: 1, acceptedBeforeDeduplicationCount: 399, publishedCount: 399, rejectedByReason: { 'omm-number': 1 } })
  })

  it('holds a drop of more than 10 percent for review and refuses a catastrophic collapse outright', async () => {
    const previous = await build(catalogue(20))
    expect((await build(catalogue(18), { previousManifest: previous.manifest })).findings).toEqual([])
    expect((await build(catalogue(17), { previousManifest: previous.manifest })).findings).toEqual([{ kind: 'published-count-drop', previousCount: 20, publishedCount: 17 }])
    await expect(build(catalogue(9), { previousManifest: previous.manifest })).rejects.toThrow('collapsed')
    // A structural refusal is not softened by being also over the ratio.
    await expect(build(catalogue(9, (id) => (id === 2 ? { MEAN_MOTION: 'fast' } : {})), { previousManifest: previous.manifest })).rejects.toThrow('collapsed')
  })

  it('requires bootstrap review only for a live first automatic snapshot, against the same provider', async () => {
    expect((await build(catalogue(12), { requireBootstrapReview: true })).findings).toEqual([{ kind: 'bootstrap-first-automatic-snapshot' }])
    expect((await build(catalogue(12), { requireBootstrapReview: false })).findings).toEqual([])
    const previous = await build(catalogue(12))
    expect((await build(catalogue(12), { requireBootstrapReview: true, previousManifest: previous.manifest })).findings).toEqual([])
    // A previous automatic snapshot from another provider is not a baseline.
    const otherProvider = { ...previous.manifest, sourceRun: { ...previous.manifest.sourceRun!, providerId: 'fixture' } }
    expect((await build(catalogue(12), { requireBootstrapReview: true, previousManifest: otherProvider })).findings).toEqual([{ kind: 'bootstrap-first-automatic-snapshot' }])
  })

  it('summarizes bounded review evidence: distributions and an id-ordered sample', async () => {
    const snapshot = await build(catalogue(60, (id) => (id % 3 === 0 ? { OBJECT_TYPE: 'DEBRIS' } : id % 5 === 0 ? { OBJECT_TYPE: null } : {})), { requireBootstrapReview: true }, 100)
    const evidence = snapshot.reviewEvidence
    expect(evidence.contentDigest).toBe(snapshot.contentDigest)
    expect(evidence.previousAutomaticCount).toBeNull()
    expect(evidence.typeCategories).toEqual({ '(absent)': 8, debris: 20, payload: 32 })
    expect(evidence.primaryOrbitClasses).toEqual({ 'low-earth': 60 })
    expect(evidence.representativeRecords).toHaveLength(24)
    expect(evidence.representativeRecords[0]).toMatchObject({ catalogId: '1', name: 'SYNTHETIC 1', type: 'PAYLOAD', primaryOrbitClass: 'low-earth' })
    expect(JSON.stringify(evidence)).not.toMatch(/MEAN_MOTION|NORAD_CAT_ID|TLE_LINE/)
  })
})
