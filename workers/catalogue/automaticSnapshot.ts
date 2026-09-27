import { CATALOGUE_ENRICHMENT_RULES_VERSION, deriveCatalogueMetadata, type DerivedCatalogueMetadata } from '../../src/data/catalogueEnrichment.ts'
import { catalogueProfileFor, encodeAutomaticRecordSource, encodeAutomaticSearchProjection, type AutomaticCatalogueSummaryV1, type CatalogueProfileV1 } from '../../src/data/catalogueProfile.ts'
import {
  MAX_SHARD_COUNT, normalizeSearchText, serializeCatalogueRecord, sha256Hex, stableJson,
  type CatalogueManifestV1, type CatalogueRecordV1, type CatalogueSearchEntryV1,
} from '../../src/data/catalogueSchema.ts'
import type { CatalogueSourceBatch, CatalogueSourceRecord } from '../../src/data/catalogueSourceRecord.ts'
import { analyzeSgp4ForCatalogue } from '../../src/orbital/sgp4CatalogueAnalysis.ts'
import { basicTimestamp, CatalogueIntegrityError, fnv1a } from './ingest.ts'
import type { PublishableCatalogueSnapshot, SnapshotPart, StreamedCatalogueSnapshot } from './publish.ts'
import type { CatalogueSourceReport } from './provider/types.ts'

/** Automatic-profile snapshot construction.
 *
 * Input is one complete, provider-neutral source batch. Output is an immutable
 * `/catalog/v1/` snapshot in the complete automatic profile,
 * ready for the unchanged publish-last publisher. Nothing here knows which
 * provider, or how many provider requests, produced the batch.
 *
 * Construction is split for Worker memory. `prepare`
 * validates the candidate and computes its content identity, publication
 * findings and review evidence without encoding any published part, so a
 * candidate held for review never builds bytes. `parts()` then encodes one shard
 * at a time, then the index in chunks, then the manifest, so publication never
 * holds every part at once. */

/** Adopted static shard count. */
export const AUTOMATIC_SHARD_COUNT = 128
/** The public index decoder guard. */
export const MAX_AUTOMATIC_PUBLISHED_RECORDS = 100_000
/** Rejected-record ratio above which publication waits for operator review.
 *  Provisional until two real sweeps. */
export const MAX_REJECTED_RATIO = 0.005
/** Published-count drop against the previous automatic snapshot above which
 *  publication waits for operator review. Provisional until two real sweeps. */
export const PUBLISHED_DROP_REVIEW_RATIO = 0.1
/** Catastrophic guard: a candidate that lost more than half of the previous
 *  automatic snapshot is a collapsed retrieval, refused outright and never
 *  offered for review. */
export const PUBLISHED_COLLAPSE_REFUSAL_RATIO = 0.5
/** Representative records in the private bootstrap/review evidence. */
const REVIEW_SAMPLE_SIZE = 24
/** Index entries encoded per chunk, so the index is never one large string. */
const INDEX_CHUNK_ENTRIES = 2_000

const MODEL_NOTES = ['SGP4/SDP4 source data; no covariance or error bound.', 'Snapshot freshness is distinct from element epoch.'] as const

/** Optional source values counted for the manifest coverage summary, by
 *  domain name. */
const COVERAGE: readonly (readonly [string, (record: CatalogueSourceRecord) => unknown])[] = [
  ['identity.internationalDesignator', (record) => record.identity.internationalDesignator],
  ['identity.classification', (record) => record.identity.classification],
  ['object.type', (record) => record.object.type],
  ['object.countryOrSourceCode', (record) => record.object.countryOrSourceCode],
  ['object.launchDate', (record) => record.object.launchDate],
  ['object.launchSiteCode', (record) => record.object.launchSiteCode],
  ['object.decayDate', (record) => record.object.decayDate],
  ['object.rcsSizeCategory', (record) => record.object.rcsSizeCategory],
  ['gp.sourceSemimajorAxisKm', (record) => record.gp.sourceSemimajorAxisKm],
  ['gp.sourcePeriodMinutes', (record) => record.gp.sourcePeriodMinutes],
  ['gp.sourceApogeeAltitudeKm', (record) => record.gp.sourceApogeeAltitudeKm],
  ['gp.sourcePerigeeAltitudeKm', (record) => record.gp.sourcePerigeeAltitudeKm],
  ['recordProvenance.createdAtUtc', (record) => record.recordProvenance?.createdAtUtc],
  ['recordProvenance.originator', (record) => record.recordProvenance?.originator],
]

export interface AutomaticSnapshotInput {
  readonly providerName: string
  readonly providerHomepage: string
  readonly batch: CatalogueSourceBatch
  readonly report: CatalogueSourceReport
}

export interface AutomaticSnapshotBuildOptions {
  readonly nowUtc: string
  readonly configurationRevision: string
  readonly shardCount?: number
  readonly previousManifest?: CatalogueManifestV1 | null
  /** True for a live provider: with no previous automatic snapshot from the
   *  same provider, the first publication waits for operator review (the
   *  bootstrap rule). */
  readonly requireBootstrapReview?: boolean
}

/** A provisional publication-policy threshold that a structurally valid
 *  candidate crossed. Any finding holds the candidate for operator review;
 *  structural failures never become findings, they throw. */
export type AutomaticPublicationFinding =
  | { readonly kind: 'bootstrap-first-automatic-snapshot' }
  | { readonly kind: 'published-count-drop'; readonly previousCount: number; readonly publishedCount: number }
  | { readonly kind: 'rejected-ratio-exceeded'; readonly receivedCount: number; readonly rejectedCount: number }

/** Bounded private evidence for operator review. Stored only under the private
 *  control prefix, never published. */
export interface AutomaticReviewEvidence {
  readonly contentDigest: string
  readonly previousAutomaticCount: number | null
  readonly summary: AutomaticCatalogueSummaryV1
  readonly typeCategories: Readonly<Record<string, number>>
  readonly sourceTypes: Readonly<Record<string, number>>
  readonly primaryOrbitClasses: Readonly<Record<string, number>>
  readonly sgp4Regimes: Readonly<Record<string, number>>
  readonly sharedInternationalDesignatorCount: number
  readonly representativeRecords: readonly {
    readonly catalogId: string; readonly name: string; readonly internationalDesignator?: string; readonly type?: string
    readonly countryOrSourceCode?: string; readonly launchDate?: string; readonly epochUtc: string
    readonly primaryOrbitClass: string; readonly perigeeAltitudeKm: number; readonly apogeeAltitudeKm: number
  }[]
}

export interface PreparedAutomaticSnapshot extends StreamedCatalogueSnapshot {
  readonly contentDigest: string
  readonly findings: readonly AutomaticPublicationFinding[]
  readonly reviewEvidence: AutomaticReviewEvidence
  readonly summary: AutomaticCatalogueSummaryV1
  readonly publishedCount: number
  readonly shardCount: number
  readonly sharedInternationalDesignatorCount: number
}

export interface BuiltAutomaticSnapshot extends PublishableCatalogueSnapshot {
  readonly contentDigest: string
  readonly findings: readonly AutomaticPublicationFinding[]
  readonly reviewEvidence: AutomaticReviewEvidence
  readonly sharedInternationalDesignatorCount: number
}

type AcceptedRecord = { readonly record: CatalogueSourceRecord; readonly derived: DerivedCatalogueMetadata; readonly shard: number }

export async function prepareAutomaticCatalogueSnapshot(input: AutomaticSnapshotInput, options: AutomaticSnapshotBuildOptions): Promise<PreparedAutomaticSnapshot> {
  const shardCount = options.shardCount ?? AUTOMATIC_SHARD_COUNT
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > MAX_SHARD_COUNT) throw new CatalogueIntegrityError('Shard count is outside the public contract.')
  const { report } = input
  const run = input.batch.run
  const providerName = input.providerName
  const providerHomepage = input.providerHomepage
  const nowUtc = options.nowUtc
  const configurationRevision = options.configurationRevision

  // SGP4 initialization is part of catalogue validity. A record
  // that parsed but cannot initialize is a bounded rejection, not a failure.
  const rejectedByReason: Record<string, number> = { ...report.rejectedByReason }
  let rejectedCount = report.rejectedCount
  const accepted: AcceptedRecord[] = []
  for (const record of input.batch.records) {
    const elements = record.gp.definition.meanElements
    let derived: DerivedCatalogueMetadata
    try {
      derived = deriveCatalogueMetadata({ eccentricity: elements.eccentricity, inclinationDeg: elements.inclinationRad * 180 / Math.PI, launchDate: record.object.launchDate, analysis: analyzeSgp4ForCatalogue(elements) })
    } catch {
      rejectedCount += 1
      rejectedByReason['sgp4-analysis'] = (rejectedByReason['sgp4-analysis'] ?? 0) + 1
      continue
    }
    accepted.push({ record, derived, shard: fnv1a(record.identity.catalogId) % shardCount })
  }

  const publishedCount = accepted.length
  const receivedCount = report.receivedCount
  // Structural refusals come first and are never masked by the provisional
  // policy thresholds below.
  if (publishedCount === 0) throw new CatalogueIntegrityError('The automatic catalogue candidate has no publishable record.')
  if (publishedCount > MAX_AUTOMATIC_PUBLISHED_RECORDS) throw new CatalogueIntegrityError('The automatic catalogue candidate exceeds the public index bound.')
  const previous = options.previousManifest
  // Only an automatic snapshot from the same provider is a comparable baseline.
  const previousCount = previous?.automaticSummary && previous.sourceRun?.providerId === run.providerId ? previous.automaticSummary.publishedCount : undefined
  if (previousCount !== undefined && publishedCount < previousCount * (1 - PUBLISHED_COLLAPSE_REFUSAL_RATIO)) throw new CatalogueIntegrityError('The automatic catalogue published count collapsed against the previous snapshot.')
  const findings: AutomaticPublicationFinding[] = []
  if (previousCount === undefined && options.requireBootstrapReview) findings.push({ kind: 'bootstrap-first-automatic-snapshot' })
  if (previousCount !== undefined && publishedCount < previousCount * (1 - PUBLISHED_DROP_REVIEW_RATIO)) findings.push({ kind: 'published-count-drop', previousCount, publishedCount })
  if (receivedCount > 0 && rejectedCount / receivedCount > MAX_REJECTED_RATIO) findings.push({ kind: 'rejected-ratio-exceeded', receivedCount, rejectedCount })

  const coverage: Record<string, number> = {}
  for (const [name, read] of COVERAGE) coverage[name] = accepted.reduce((count, { record }) => (read(record) === undefined ? count : count + 1), 0)
  const summary: AutomaticCatalogueSummaryV1 = {
    receivedCount,
    rejectedCount,
    acceptedBeforeDeduplicationCount: receivedCount - rejectedCount,
    identicalDuplicateCount: report.identicalDuplicateCount,
    publishedCount,
    rejectedByReason: sortedCounts(rejectedByReason),
    optionalFieldErrors: sortedCounts(report.optionalFieldErrors),
    optionalFieldCoverage: coverage,
  }
  if (summary.acceptedBeforeDeduplicationCount !== publishedCount + summary.identicalDuplicateCount) throw new CatalogueIntegrityError('The automatic catalogue counts do not add up.')
  const profile = catalogueProfileFor(run.normalizationRulesVersion, CATALOGUE_ENRICHMENT_RULES_VERSION)

  // Canonical content identity: every catalogue-visible value
  // except the publication timestamp, which the snapshot id already carries.
  // Records are hashed one shard at a time so the whole catalogue is never
  // held as one canonical string; shard membership is a pure function of id,
  // so provider order and page boundaries cannot change the digest.
  const byShard: AcceptedRecord[][] = Array.from({ length: shardCount }, () => [])
  for (const item of accepted) byShard[item.shard].push(item)
  for (const items of byShard) items.sort((a, b) => compareIds(a.record.identity.catalogId, b.record.identity.catalogId))
  const shardContentDigests: string[] = []
  for (const items of byShard) {
    const canonical = items.map(({ record, derived }) => {
      const { provenance: _provenance, ...definition } = record.gp.definition
      return { id: record.identity.catalogId, definition, source: encodeAutomaticRecordSource(record), derived }
    })
    shardContentDigests.push(await sha256Hex(new TextEncoder().encode(stableJson(canonical))))
  }
  const header = { profile, sourceRun: run, summary, shardCount, configurationRevision, provider: { name: providerName, homepage: providerHomepage }, modelNotes: MODEL_NOTES }
  const contentDigest = await sha256Hex(new TextEncoder().encode(stableJson({ header, shardContentDigests })))
  const snapshotId = `${basicTimestamp(nowUtc)}-${contentDigest.slice(0, 12)}`
  if (!/^\d{8}T\d{6}Z-[0-9a-f]{12}$/.test(snapshotId)) throw new CatalogueIntegrityError('Snapshot id is not in the public format.')

  const reviewEvidence = buildReviewEvidence(accepted, summary, contentDigest, previousCount ?? null, report.sharedInternationalDesignatorCount)
  // `byShard` now holds every accepted record; release the flat list.
  accepted.length = 0

  async function* parts(): AsyncGenerator<SnapshotPart, { readonly manifest: CatalogueManifestV1; readonly manifestBytes: Uint8Array }, undefined> {
    const root = `catalog/v1/snapshots/${snapshotId}/`
    const provenance = { kind: 'catalogue' as const, providerId: run.providerId, groups: [] as string[], providerRetrievedAtUtc: run.retrievedAtUtc, snapshotId, cataloguePublishedAtUtc: nowUtc }
    const indexItems: { readonly sortName: string; readonly catalogId: string; readonly json: string }[] = []
    const shardDescriptors: CatalogueManifestV1['shards'][number][] = []
    for (const [shard, items] of byShard.entries()) {
      const records: Record<string, CatalogueRecordV1> = {}
      for (const { record, derived } of items) {
        const definition = record.gp.definition
        const source = encodeAutomaticRecordSource(record)
        const catalogId = record.identity.catalogId
        records[catalogId] = { ...serializeCatalogueRecord({ ...definition, provenance }, snapshotId, []), source, derived }
        const entry: CatalogueSearchEntryV1 = {
          catalogId, name: definition.name, normalizedName: normalizeSearchText(definition.name), internationalDesignator: definition.internationalDesignator,
          epochUtc: new Date(definition.meanElements.epoch.unixSeconds * 1000).toISOString(), groups: [], shard, ...encodeAutomaticSearchProjection(source, derived),
        }
        indexItems.push({ sortName: entry.normalizedName, catalogId, json: stableJson(entry) })
      }
      const sortedRecords = Object.fromEntries(Object.keys(records).sort().map((id) => [id, records[id]]))
      const shardBytes = encode({ schemaVersion: 1, snapshotId, shard, catalogueProfile: profile, records: sortedRecords })
      const sha256 = await sha256Hex(shardBytes)
      shardDescriptors.push({ shard, path: `/${root}records-${shard}.json`, byteLength: shardBytes.byteLength, sha256, entryCount: items.length })
      yield { key: `${root}records-${shard}.json`, bytes: shardBytes, sha256 }
    }

    indexItems.sort((a, b) => a.sortName.localeCompare(b.sortName, 'en') || a.catalogId.localeCompare(b.catalogId, 'en'))
    const indexBytes = encodeIndex(snapshotId, profile, indexItems)
    const indexEntryCount = indexItems.length
    indexItems.length = 0
    const indexSha256 = await sha256Hex(indexBytes)
    yield { key: `${root}search-index.json`, bytes: indexBytes, sha256: indexSha256 }

    const manifest: CatalogueManifestV1 = {
      schemaVersion: 1, snapshotId, generatedAtUtc: nowUtc,
      provider: { id: run.providerId, name: providerName, homepage: providerHomepage, sourceAuthority: run.sourceAuthority, wireFormat: 'omm-keyed-json', retrievedAtUtc: run.retrievedAtUtc },
      configurationRevision,
      groups: [],
      totals: { receivedCount, validBeforeDeduplicationCount: summary.acceptedBeforeDeduplicationCount, deduplicatedCount: publishedCount, rejectedCount },
      index: { path: `/${root}search-index.json`, byteLength: indexBytes.byteLength, sha256: indexSha256, entryCount: indexEntryCount },
      shardCount, shards: shardDescriptors,
      modelNotes: [...MODEL_NOTES],
      catalogueProfile: profile,
      sourceRun: run,
      automaticSummary: summary,
    }
    return { manifest, manifestBytes: encode(manifest) }
  }

  return { snapshotId, contentDigest, findings, reviewEvidence, summary, publishedCount, shardCount, sharedInternationalDesignatorCount: report.sharedInternationalDesignatorCount, parts }
}

/** Every part materialized in memory, for tests and local fixtures. The Worker
 *  publishes a prepared snapshot's parts one at a time instead. */
export async function buildAutomaticCatalogueSnapshot(input: AutomaticSnapshotInput, options: AutomaticSnapshotBuildOptions): Promise<BuiltAutomaticSnapshot> {
  const prepared = await prepareAutomaticCatalogueSnapshot(input, options)
  const bytes = new Map<string, Uint8Array>()
  const iterator = prepared.parts()
  let step = await iterator.next()
  while (!step.done) { bytes.set(step.value.key, step.value.bytes); step = await iterator.next() }
  const { manifest, manifestBytes } = step.value
  bytes.set(`catalog/v1/snapshots/${prepared.snapshotId}/manifest.json`, manifestBytes)
  return { snapshotId: prepared.snapshotId, manifest, bytes, manifestBytes, contentDigest: prepared.contentDigest, findings: prepared.findings, reviewEvidence: prepared.reviewEvidence, sharedInternationalDesignatorCount: prepared.sharedInternationalDesignatorCount }
}

/** Byte-identical to `stableJson(index)`, whose top-level keys sort as
 *  `catalogueProfile`, `entries`, `schemaVersion`, `snapshotId`, built from
 *  per-entry canonical JSON in chunks. */
function encodeIndex(snapshotId: string, profile: CatalogueProfileV1, items: readonly { readonly json: string }[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = [encoder.encode(`{"catalogueProfile":${stableJson(profile)},"entries":[`)]
  for (let start = 0; start < items.length; start += INDEX_CHUNK_ENTRIES) {
    chunks.push(encoder.encode(`${start > 0 ? ',' : ''}${items.slice(start, start + INDEX_CHUNK_ENTRIES).map((item) => item.json).join(',')}`))
  }
  chunks.push(encoder.encode(`],"schemaVersion":1,"snapshotId":${JSON.stringify(snapshotId)}}`))
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** Distributions and an evenly spaced, id-ordered sample: enough for the
 *  bootstrap review judgement without copying the catalogue. */
function buildReviewEvidence(
  accepted: readonly AcceptedRecord[], summary: AutomaticCatalogueSummaryV1, contentDigest: string, previousAutomaticCount: number | null, sharedInternationalDesignatorCount: number,
): AutomaticReviewEvidence {
  const tally = (read: (item: AcceptedRecord) => string | undefined): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const item of accepted) { const key = read(item) ?? '(absent)'; counts[key] = (counts[key] ?? 0) + 1 }
    return sortedCounts(counts)
  }
  const ordered = [...accepted].sort((a, b) => compareIds(a.record.identity.catalogId, b.record.identity.catalogId))
  const step = Math.max(1, Math.floor(ordered.length / REVIEW_SAMPLE_SIZE))
  const sample = ordered.filter((_, position) => position % step === 0).slice(0, REVIEW_SAMPLE_SIZE)
  return {
    contentDigest, previousAutomaticCount, summary, sharedInternationalDesignatorCount,
    typeCategories: tally(({ record }) => record.object.typeCategory),
    sourceTypes: tally(({ record }) => record.object.type),
    primaryOrbitClasses: tally(({ derived }) => derived.orbit.primaryOrbitClass),
    sgp4Regimes: tally(({ derived }) => derived.orbit.sgp4Regime),
    representativeRecords: sample.map(({ record, derived }) => {
      const definition = record.gp.definition
      return Object.fromEntries(Object.entries({
        catalogId: record.identity.catalogId, name: record.identity.providerName, internationalDesignator: record.identity.internationalDesignator,
        type: record.object.type, countryOrSourceCode: record.object.countryOrSourceCode, launchDate: record.object.launchDate,
        epochUtc: new Date(definition.meanElements.epoch.unixSeconds * 1000).toISOString(),
        primaryOrbitClass: derived.orbit.primaryOrbitClass, perigeeAltitudeKm: derived.orbit.perigeeAltitudeKm, apogeeAltitudeKm: derived.orbit.apogeeAltitudeKm,
      }).filter(([, value]) => value !== undefined)) as AutomaticReviewEvidence['representativeRecords'][number]
    }),
  }
}

function encode(value: unknown): Uint8Array { return new TextEncoder().encode(stableJson(value)) }
function compareIds(a: string, b: string): number { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0) }

function sortedCounts(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
