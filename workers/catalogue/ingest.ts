import type { OmmDefinition } from '../../src/data/omm.ts'
import { normalizeSearchText, serializeCatalogueRecord, sha256Hex, stableJson, type CatalogueManifestV1, type CatalogueRecordShardV1, type CatalogueSearchIndexV1 } from '../../src/data/catalogueSchema.ts'
import { CATALOGUE_DEFINITIONS, type CatalogueDefinition } from './catalogues.ts'
import type { GpFetchResult } from './provider/types.ts'

export interface SnapshotBuildOptions {
  readonly nowUtc: string
  readonly configurationRevision: string
  readonly definitions?: readonly CatalogueDefinition[]
  readonly shardCount?: number
  readonly previousManifest?: CatalogueManifestV1 | null
  readonly snapshotId?: string
}

/** Why a returned record was not published. Bounded categories only; a reason
 *  never carries record content. */
export type RejectionReason = 'unselected' | 'designator-mismatch'

export interface BuiltCatalogueSnapshot {
  readonly snapshotId: string
  readonly manifest: CatalogueManifestV1
  readonly index: CatalogueSearchIndexV1
  readonly shards: readonly CatalogueRecordShardV1[]
  readonly bytes: ReadonlyMap<string, Uint8Array>
  readonly manifestBytes: Uint8Array
  readonly indexBytes: Uint8Array
  readonly shardBytes: readonly Uint8Array[]
  /** Catalogue identifiers that were selected but absent from the provider
   *  response, for the operator's membership review. Bounded by the definition
   *  size, so it is safe to log. */
  readonly missingMembers: readonly string[]
  readonly rejections: Readonly<Record<RejectionReason, number>>
}

export class CatalogueIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogueIntegrityError' }
}

/** Builds one immutable published snapshot from a provider-neutral fetch.
 *
 * Everything below this line works on the application's own types. The only
 * thing the provider contributes beyond records is provenance metadata for the
 * manifest, so replacing the provider does not reach this function's logic. */
export async function buildCatalogueSnapshot(fetched: GpFetchResult, options: SnapshotBuildOptions): Promise<BuiltCatalogueSnapshot> {
  const shardCount = options.shardCount ?? 8
  const definitions = options.definitions ?? CATALOGUE_DEFINITIONS
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 256) throw new CatalogueIntegrityError('Shard count is outside the public contract.')
  if (definitions.length === 0) throw new CatalogueIntegrityError('At least one catalogue must be defined.')

  const returned = indexReturnedRecords(fetched.definitions)
  const rejections: Record<RejectionReason, number> = { unselected: 0, 'designator-mismatch': 0 }
  const missingMembers: string[] = []
  const memberships = new Map<string, Set<string>>()
  const accepted = new Map<string, OmmDefinition>()
  const summaries: { readonly definition: CatalogueDefinition; readonly received: number; readonly valid: number; readonly rejected: number }[] = []

  for (const definition of definitions) {
    let received = 0
    let valid = 0
    for (const member of definition.members) {
      const record = returned.get(member.catalogId)
      if (!record) { if (!missingMembers.includes(member.catalogId)) missingMembers.push(member.catalogId); continue }
      received += 1
      // A catalogue identifier is only a number. The recorded international
      // designator is what actually identifies the object, so a disagreement is
      // a curation error to surface, never a record to publish.
      if (record.internationalDesignator !== member.designator) { rejections['designator-mismatch'] += 1; continue }
      valid += 1
      accepted.set(member.catalogId, record)
      const existing = memberships.get(member.catalogId)
      if (existing) existing.add(definition.id)
      else memberships.set(member.catalogId, new Set([definition.id]))
    }
    if (valid === 0) throw new CatalogueIntegrityError(`Catalogue ${definition.id} retained no valid record.`)
    summaries.push({ definition, received, valid, rejected: received - valid })
  }

  const selectedIds = new Set(definitions.flatMap((definition) => definition.members.map((member) => member.catalogId)))
  for (const id of returned.keys()) if (!selectedIds.has(id)) rejections.unselected += 1

  const rejectedCount = fetched.rejectedCount + rejections.unselected + rejections['designator-mismatch']
  const receivedCount = fetched.receivedCount
  if (rejectedCount > 5 || (receivedCount > 0 && rejectedCount / receivedCount > 0.005)) throw new CatalogueIntegrityError('The configured rejected-record integrity threshold was exceeded.')

  const previousGroups = new Map((options.previousManifest?.groups ?? []).map((group) => [group.id, group.validCount]))
  for (const summary of summaries) {
    const previous = previousGroups.get(summary.definition.id)
    if (previous !== undefined && summary.valid < previous * 0.5) throw new CatalogueIntegrityError(`Catalogue ${summary.definition.id} dropped by more than 50%.`)
  }
  const previousTotal = options.previousManifest?.totals.deduplicatedCount
  if (previousTotal !== undefined && accepted.size < previousTotal * 0.8) throw new CatalogueIntegrityError('Deduplicated catalogue count dropped by more than 20%.')

  const records = [...accepted.entries()]
    .map(([catalogId, definition]) => ({ catalogId, definition, groups: [...(memberships.get(catalogId) ?? new Set<string>())].sort() }))
    .sort((a, b) => a.catalogId.localeCompare(b.catalogId, 'en'))

  const canonicalPayload = records.map(({ catalogId, definition, groups }) => ({ id: catalogId, definition, groups }))
  const contentDigest = await sha256Hex(new TextEncoder().encode(stableJson(canonicalPayload)))
  const snapshotId = options.snapshotId ?? `${basicTimestamp(options.nowUtc)}-${contentDigest.slice(0, 12)}`
  if (!/^\d{8}T\d{6}Z-[0-9a-f]{12}$/.test(snapshotId)) throw new CatalogueIntegrityError('Snapshot id is not in the public format.')

  const indexEntries = records.map(({ catalogId, definition, groups }) => ({
    catalogId,
    name: definition.name,
    normalizedName: normalizeSearchText(definition.name),
    internationalDesignator: definition.internationalDesignator,
    epochUtc: new Date(definition.meanElements.epoch.unixSeconds * 1000).toISOString(),
    groups,
    shard: fnv1a(catalogId) % shardCount,
  })).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName, 'en') || a.catalogId.localeCompare(b.catalogId, 'en'))
  const index: CatalogueSearchIndexV1 = { schemaVersion: 1, snapshotId, entries: indexEntries }

  const shardMaps: Array<Record<string, ReturnType<typeof serializeCatalogueRecord>>> = Array.from({ length: shardCount }, () => ({}))
  for (const { catalogId, definition, groups } of records) {
    const provenance = { kind: 'catalogue' as const, providerId: fetched.providerId, groups, providerRetrievedAtUtc: fetched.retrievedAtUtc, snapshotId, cataloguePublishedAtUtc: options.nowUtc }
    shardMaps[fnv1a(catalogId) % shardCount][catalogId] = serializeCatalogueRecord({ ...definition, provenance }, snapshotId, groups)
  }
  const shardObjects: CatalogueRecordShardV1[] = shardMaps.map((recordsForShard, shard) => ({ schemaVersion: 1, snapshotId, shard, records: Object.fromEntries(Object.keys(recordsForShard).sort().map((id) => [id, recordsForShard[id]])) }))

  const indexBytes = bytesOf(index)
  const shardBytes = shardObjects.map(bytesOf)
  const indexDescriptor = { path: `/catalog/v1/snapshots/${snapshotId}/search-index.json`, byteLength: indexBytes.byteLength, sha256: await sha256Hex(indexBytes), entryCount: index.entries.length }
  const shardDescriptors = shardObjects.map((shard, position) => ({ shard: position, path: `/catalog/v1/snapshots/${snapshotId}/records-${position}.json`, byteLength: shardBytes[position].byteLength, sha256: '', entryCount: Object.keys(shard.records).length }))
  for (const [position, bytes] of shardBytes.entries()) shardDescriptors[position] = { ...shardDescriptors[position], sha256: await sha256Hex(bytes) }

  const manifest: CatalogueManifestV1 = {
    schemaVersion: 1, snapshotId, generatedAtUtc: options.nowUtc,
    provider: { id: fetched.providerId, name: fetched.providerName, homepage: fetched.providerHomepage, sourceAuthority: fetched.sourceAuthority, wireFormat: 'omm-keyed-json', retrievedAtUtc: fetched.retrievedAtUtc },
    configurationRevision: options.configurationRevision,
    groups: summaries.map(({ definition, received, valid, rejected }) => ({
      id: definition.id, label: definition.title, purpose: definition.purpose, membership: definition.membership,
      selection: definition.selection, selectedCount: definition.members.length,
      receivedCount: received, validCount: valid, rejectedCount: rejected, fetchedAtUtc: fetched.retrievedAtUtc,
    })),
    totals: {
      receivedCount,
      validBeforeDeduplicationCount: summaries.reduce((sum, summary) => sum + summary.valid, 0),
      deduplicatedCount: records.length,
      rejectedCount,
    },
    index: indexDescriptor, shardCount, shards: shardDescriptors,
    modelNotes: ['SGP4/SDP4 source data; no covariance or error bound.', 'Snapshot freshness is distinct from element epoch.'],
  }
  const manifestBytes = bytesOf(manifest)
  const bytes = new Map<string, Uint8Array>([
    [`catalog/v1/snapshots/${snapshotId}/search-index.json`, indexBytes],
    ...shardBytes.map((value, position) => [`catalog/v1/snapshots/${snapshotId}/records-${position}.json`, value] as const),
    [`catalog/v1/snapshots/${snapshotId}/manifest.json`, manifestBytes],
  ])
  return { snapshotId, manifest, index, shards: shardObjects, bytes, manifestBytes, indexBytes, shardBytes, missingMembers, rejections }
}

/** Groups the flat provider response by catalogue identifier.
 *
 * A GP query returns the newest element set per object, so two records for one
 * identifier should be impossible. If it happens and they disagree on anything
 * that drives propagation, the whole candidate snapshot is refused rather than
 * silently resolved in favour of whichever arrived first. */
function indexReturnedRecords(definitions: readonly OmmDefinition[]): Map<string, OmmDefinition> {
  const returned = new Map<string, OmmDefinition>()
  for (const definition of definitions) {
    const id = definition.meanElements.catalogId
    const existing = returned.get(id)
    if (!existing) { returned.set(id, definition); continue }
    if (!samePropagation(existing, definition)) throw new CatalogueIntegrityError(`Conflicting propagation records for catalogue id ${id}.`)
  }
  return returned
}

function bytesOf(value: unknown): Uint8Array { return new TextEncoder().encode(stableJson(value)) }
/** `YYYYMMDDTHHMMSSZ`, the timestamp half of a public snapshot id. */
export function basicTimestamp(value: string): string { return value.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace(/Z$/, 'Z').slice(0, 15) + 'Z' }
/** Stable id-to-shard hash shared by every snapshot builder. */
export function fnv1a(value: string): number { let hash = 0x811c9dc5; for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193) } return hash >>> 0 }

function samePropagation(a: OmmDefinition, b: OmmDefinition): boolean {
  const x = a.meanElements; const y = b.meanElements
  return x.catalogId === y.catalogId && x.epoch.unixSeconds === y.epoch.unixSeconds && x.meanMotionRadPerMinute === y.meanMotionRadPerMinute && x.meanMotionFirstDerivativeRadPerMinuteSquared === y.meanMotionFirstDerivativeRadPerMinuteSquared && x.meanMotionSecondDerivativeRadPerMinuteCubed === y.meanMotionSecondDerivativeRadPerMinuteCubed && x.bstarPerEarthRadius === y.bstarPerEarthRadius && x.eccentricity === y.eccentricity && x.inclinationRad === y.inclinationRad && x.raanRad === y.raanRad && x.argumentOfPerigeeRad === y.argumentOfPerigeeRad && x.meanAnomalyRad === y.meanAnomalyRad && a.ephemerisType === b.ephemerisType
}
