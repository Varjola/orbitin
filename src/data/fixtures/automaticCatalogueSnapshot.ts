import { CATALOGUE_ENRICHMENT_RULES_VERSION, deriveCatalogueMetadata } from '../catalogueEnrichment.ts'
import { catalogueProfileFor, encodeAutomaticRecordSource, encodeAutomaticSearchProjection } from '../catalogueProfile.ts'
import { normalizeSearchText, serializeCatalogueRecord, sha256Hex, stableJson, type CataloguePointerV1 } from '../catalogueSchema.ts'
import { analyzeSgp4ForCatalogue } from '../../orbital/sgp4CatalogueAnalysis.ts'
import { normalizeSpaceTrackGpRecords } from '../../../workers/catalogue/provider/spaceTrackSourceRecord.ts'

/** Test-only complete automatic-profile snapshot.
 *
 * Built from synthetic Space-Track-dialect records through the real adapter,
 * SGP4 analysis and enrichment, then laid out by hand in the automatic profile.
 * It stands in for the snapshot builder in decoder tests; it is not that
 * builder. No provider record is copied. Parts are plain JSON so tests can
 * mutate them into malformed variants. */

export const FIXTURE_SNAPSHOT_ID = '20260914T001703Z-0123456789ab'
export const FIXTURE_PUBLISHED_AT = '2026-09-14T00:17:03.120Z'

/** Deliberately untyped: tests mutate these parts into malformed shapes. */
export interface AutomaticSnapshotFixture {
  manifest: any
  index: any
  shards: any[]
}

const RUN = {
  providerId: 'space-track',
  sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron',
  queryDescription: 'Current GP element sets with no decay date and an epoch within ten days, ordered by catalogue id',
  retrievalStartedAtUtc: '2026-09-13T17:17:02.250Z',
  retrievedAtUtc: '2026-09-14T00:17:01.500Z',
}

function wire(catalogId: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    CCSDS_OMM_VERS: '3.0', CREATION_DATE: '2026-09-13T21:04:11', ORIGINATOR: '18 SPCS', OBJECT_NAME: `SYNTHETIC ${catalogId}`,
    CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4', EPOCH: '2026-09-13T18:00:00.000000',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: catalogId, ELEMENT_SET_NO: '999', REV_AT_EPOCH: '1000',
    BSTAR: '0', MEAN_MOTION_DOT: '0', MEAN_MOTION_DDOT: '0', ...overrides,
  }
}

/** Low-Earth payload with every optional field, a geostationary record with
 *  none, and an eccentric rocket body; plus one identical duplicate and one
 *  non-object entry so every summary count is exercised. */
function wireRecords(): unknown[] {
  const leo = wire('900001', {
    OBJECT_ID: '2026-900A', MEAN_MOTION: '15.49', ECCENTRICITY: '0.0002', INCLINATION: '51.64', RA_OF_ASC_NODE: '60', ARG_OF_PERICENTER: '35', MEAN_ANOMALY: '60',
    OBJECT_TYPE: 'PAYLOAD', COUNTRY_CODE: 'ISS', LAUNCH_DATE: '1998-11-20', SITE: 'TTMTR', RCS_SIZE: 'LARGE',
    SEMIMAJOR_AXIS: '6795.456', PERIOD: '92.953', APOAPSIS: '418.432', PERIAPSIS: '416.211',
  })
  const geo = wire('900002', { MEAN_MOTION: '1.00271', ECCENTRICITY: '0.0002', INCLINATION: '0.05', RA_OF_ASC_NODE: '80', ARG_OF_PERICENTER: '200', MEAN_ANOMALY: '100' })
  const eccentric = wire('900003', {
    OBJECT_ID: '1990-001B', MEAN_MOTION: '2.00565', ECCENTRICITY: '0.72', INCLINATION: '63.4', RA_OF_ASC_NODE: '10', ARG_OF_PERICENTER: '270', MEAN_ANOMALY: '5',
    OBJECT_TYPE: 'ROCKET BODY', LAUNCH_DATE: '1990-01-05',
  })
  return [leo, geo, eccentric, { ...leo }, 'not a record']
}

/** Four synthetic twelve-hour, 55-degree payloads in two planes. They exist
 *  only so the fixture official-group proof has real automatic-profile index
 *  entries; they are not modelled on, or named after, any real spacecraft. */
function syntheticNavigationRecords(): unknown[] {
  return ['900011', '900012', '900013', '900014'].map((catalogId, member) => wire(catalogId, {
    OBJECT_NAME: `SYNTHETIC NAV ${member + 1}`, OBJECT_ID: `2026-91${member + 1}A`, OBJECT_TYPE: 'PAYLOAD', LAUNCH_DATE: `2026-0${member + 1}-15`,
    MEAN_MOTION: '2.00564', ECCENTRICITY: '0.004', INCLINATION: '55.0', RA_OF_ASC_NODE: String(member < 2 ? 40 : 160), ARG_OF_PERICENTER: '30', MEAN_ANOMALY: String(member * 90),
  }))
}

/** Synthetic medium-orbit payloads under the given catalogue ids, spread over
 *  six planes (for browser checks of the official GPS group). */
function syntheticNavigationRecordsFor(catalogIds: readonly string[]): unknown[] {
  return catalogIds.map((catalogId, member) => wire(catalogId, {
    OBJECT_NAME: `SYNTHETIC NAV ${member + 1}`, OBJECT_ID: `2026-9${String(member + 11).padStart(2, '0')}A`, OBJECT_TYPE: 'PAYLOAD', LAUNCH_DATE: `2026-0${(member % 9) + 1}-15`,
    MEAN_MOTION: '2.00564', ECCENTRICITY: '0.004', INCLINATION: '55.0', RA_OF_ASC_NODE: String((member % 6) * 60), ARG_OF_PERICENTER: '30', MEAN_ANOMALY: String((member * 45) % 360),
  }))
}

/** One synthetic payload for the local development catalogue: plausible
 *  mean elements under a given catalogue id. Not a provider record. */
export interface SyntheticRecordSpec {
  readonly catalogId: string
  readonly name: string
  readonly meanMotion: number
  readonly eccentricity: number
  readonly inclinationDeg: number
  readonly raanDeg: number
  readonly argumentOfPerigeeDeg: number
  readonly meanAnomalyDeg: number
}

function syntheticRecordsFrom(specs: readonly SyntheticRecordSpec[]): unknown[] {
  return specs.map((spec, index) => wire(spec.catalogId, {
    OBJECT_NAME: spec.name, OBJECT_ID: `2026-${String(800 + Math.floor(index / 20)).padStart(3, '0')}${String.fromCharCode(65 + (index % 20))}`, OBJECT_TYPE: 'PAYLOAD', LAUNCH_DATE: '2026-01-15',
    MEAN_MOTION: String(spec.meanMotion), ECCENTRICITY: String(spec.eccentricity), INCLINATION: String(spec.inclinationDeg),
    RA_OF_ASC_NODE: String(spec.raanDeg), ARG_OF_PERICENTER: String(spec.argumentOfPerigeeDeg), MEAN_ANOMALY: String(spec.meanAnomalyDeg),
  }))
}

export interface AutomaticSnapshotFixtureOptions {
  /** Append the four synthetic navigation payloads used by the fixture-only
   *  official-group proof. The default fixture is unchanged. */
  readonly syntheticNavigationMembers?: boolean
  /** Append synthetic navigation payloads under these ids instead. */
  readonly syntheticNavigationIds?: readonly string[]
  /** Append these synthetic payloads (the local development catalogue). */
  readonly syntheticRecords?: readonly SyntheticRecordSpec[]
}

export function buildAutomaticSnapshotFixture(options: AutomaticSnapshotFixtureOptions = {}): AutomaticSnapshotFixture {
  const navigation = [
    ...(options.syntheticNavigationIds ? syntheticNavigationRecordsFor(options.syntheticNavigationIds) : options.syntheticNavigationMembers ? syntheticNavigationRecords() : []),
    ...syntheticRecordsFrom(options.syntheticRecords ?? []),
  ]
  const normalized = normalizeSpaceTrackGpRecords([...wireRecords(), ...navigation], RUN)
  if (!normalized.ok) throw new Error('The automatic fixture did not normalize.')
  const { batch, report } = normalized
  const profile = catalogueProfileFor(batch.run.normalizationRulesVersion, CATALOGUE_ENRICHMENT_RULES_VERSION)
  const shardCount = 2
  const provenance = { kind: 'catalogue' as const, providerId: batch.run.providerId, groups: [], providerRetrievedAtUtc: batch.run.retrievedAtUtc, snapshotId: FIXTURE_SNAPSHOT_ID, cataloguePublishedAtUtc: FIXTURE_PUBLISHED_AT }

  const built = batch.records.map((record, position) => {
    const definition = record.gp.definition
    const elements = definition.meanElements
    const derived = deriveCatalogueMetadata({ eccentricity: elements.eccentricity, inclinationDeg: (elements.inclinationRad * 180) / Math.PI, launchDate: record.object.launchDate, analysis: analyzeSgp4ForCatalogue(elements) })
    const source = encodeAutomaticRecordSource(record)
    const shard = position % shardCount
    const catalogId = record.identity.catalogId
    return {
      catalogId, shard,
      record: { ...serializeCatalogueRecord({ ...definition, provenance }, FIXTURE_SNAPSHOT_ID, []), source, derived },
      entry: {
        catalogId, name: definition.name, normalizedName: normalizeSearchText(definition.name), internationalDesignator: definition.internationalDesignator,
        epochUtc: new Date(elements.epoch.unixSeconds * 1000).toISOString(), groups: [], shard, ...encodeAutomaticSearchProjection(source, derived),
      },
    }
  })

  const root = `/catalog/v1/snapshots/${FIXTURE_SNAPSHOT_ID}/`
  const placeholderHash = '0'.repeat(64)
  const shards = Array.from({ length: shardCount }, (_, shard) => ({
    schemaVersion: 1, snapshotId: FIXTURE_SNAPSHOT_ID, shard, catalogueProfile: profile,
    records: Object.fromEntries(built.filter((item) => item.shard === shard).map((item) => [item.catalogId, item.record])),
  }))
  const index = { schemaVersion: 1, snapshotId: FIXTURE_SNAPSHOT_ID, catalogueProfile: profile, entries: built.map((item) => item.entry) }
  const acceptedBeforeDeduplicationCount = report.publishedCount + report.identicalDuplicateCount
  const manifest = {
    schemaVersion: 1, snapshotId: FIXTURE_SNAPSHOT_ID, generatedAtUtc: FIXTURE_PUBLISHED_AT,
    provider: { id: batch.run.providerId, name: 'Synthetic automatic fixture', homepage: 'https://example.invalid/', sourceAuthority: batch.run.sourceAuthority, wireFormat: 'omm-keyed-json', retrievedAtUtc: batch.run.retrievedAtUtc },
    configurationRevision: 'automatic-fixture',
    groups: [],
    totals: { receivedCount: report.receivedCount, validBeforeDeduplicationCount: acceptedBeforeDeduplicationCount, deduplicatedCount: report.publishedCount, rejectedCount: report.rejectedCount },
    index: { path: `${root}search-index.json`, byteLength: 0, sha256: placeholderHash, entryCount: built.length },
    shardCount,
    shards: shards.map((shard) => ({ shard: shard.shard, path: `${root}records-${shard.shard}.json`, byteLength: 0, sha256: placeholderHash, entryCount: Object.keys(shard.records).length })),
    modelNotes: ['SGP4/SDP4 source data; no covariance or error bound.', 'Snapshot freshness is distinct from element epoch.'],
    catalogueProfile: profile,
    sourceRun: batch.run,
    automaticSummary: {
      receivedCount: report.receivedCount, rejectedCount: report.rejectedCount, acceptedBeforeDeduplicationCount,
      identicalDuplicateCount: report.identicalDuplicateCount, publishedCount: report.publishedCount,
      rejectedByReason: report.rejectedByReason, optionalFieldErrors: {},
      optionalFieldCoverage: { 'identity.internationalDesignator': 2 + navigation.length, 'object.type': 2 + navigation.length, 'object.launchDate': 2 + navigation.length, 'object.countryOrSourceCode': 1 },
    },
  }
  return JSON.parse(stableJson({ manifest, index, shards })) as AutomaticSnapshotFixture
}

/** Fills byte lengths and hashes and returns same-origin payloads by path,
 *  including `current.json`. Mutate the fixture first to serve a variant. */
export async function servedSnapshotPayloads(fixture: AutomaticSnapshotFixture): Promise<Map<string, Uint8Array>> {
  const encode = (value: unknown) => new TextEncoder().encode(stableJson(value))
  const payloads = new Map<string, Uint8Array>()
  const indexBytes = encode(fixture.index)
  fixture.manifest.index = { ...fixture.manifest.index, byteLength: indexBytes.byteLength, sha256: await sha256Hex(indexBytes) }
  payloads.set(fixture.manifest.index.path, indexBytes)
  for (const [position, shard] of fixture.shards.entries()) {
    const bytes = encode(shard)
    fixture.manifest.shards[position] = { ...fixture.manifest.shards[position], byteLength: bytes.byteLength, sha256: await sha256Hex(bytes) }
    payloads.set(fixture.manifest.shards[position].path, bytes)
  }
  const manifestBytes = encode(fixture.manifest)
  const manifestPath = `/catalog/v1/snapshots/${FIXTURE_SNAPSHOT_ID}/manifest.json`
  payloads.set(manifestPath, manifestBytes)
  const pointer: CataloguePointerV1 = { schemaVersion: 1, snapshotId: FIXTURE_SNAPSHOT_ID, publishedAtUtc: FIXTURE_PUBLISHED_AT, providerRetrievedAtUtc: RUN.retrievedAtUtc, manifestPath, manifestSha256: await sha256Hex(manifestBytes) }
  payloads.set('/catalog/v1/current.json', encode(pointer))
  return payloads
}
