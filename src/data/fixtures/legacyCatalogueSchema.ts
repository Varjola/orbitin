// Pinned copy of the legacy `/catalog/v1/` decoder, taken verbatim from
// Production commit 33358c7 `src/data/catalogueSchema.ts` with only the two
// import paths adjusted. `catalogueProfile.test.ts` proves that an automatic
// snapshot is still accepted by this old decoder. Never edit or regenerate it.

import { epochToIsoUtc, type Sgp4MeanElements } from '../sgp4MeanElements.ts'
import type { OmmDefinition, OmmProvenance } from '../omm.ts'

export const CATALOGUE_SCHEMA_VERSION = 1 as const
export const CATALOGUE_ROOT = '/catalog/v1/'
export const SNAPSHOT_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/
export const MAX_SHARD_COUNT = 256

export interface CataloguePointerV1 {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly publishedAtUtc: string
  readonly providerRetrievedAtUtc: string
  readonly manifestPath: string
  readonly manifestSha256: string
}

/** One published Orbitin catalogue.
 *
 *  This describes the application's own educational selection, not an upstream
 *  provider taxonomy. `selection` is a short human-readable description of how
 *  membership is defined so that an operator can read a published snapshot and
 *  understand it without the ingestion source. It carries no provider query
 *  syntax, and no browser behaviour depends on its contents. */
export interface CatalogueGroupSummaryV1 {
  readonly id: string
  readonly label: string
  readonly purpose: string
  readonly membership: 'static' | 'query-derived'
  readonly selection: string
  readonly selectedCount: number
  readonly receivedCount: number
  readonly validCount: number
  readonly rejectedCount: number
  readonly fetchedAtUtc: string
}

export interface CataloguePartDescriptorV1 {
  readonly path: string
  readonly byteLength: number
  readonly sha256: string
  readonly entryCount: number
}

export interface CatalogueManifestV1 {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly generatedAtUtc: string
  /** Upstream provenance only. The public catalogue contract, the search index,
   *  the record shards and every browser code path are identical whichever
   *  provider produced the run. */
  readonly provider: {
    readonly id: string
    readonly name: string
    readonly homepage: string
    readonly sourceAuthority: string
    readonly wireFormat: 'omm-keyed-json'
    readonly retrievedAtUtc: string
  }
  readonly configurationRevision: string
  readonly groups: readonly CatalogueGroupSummaryV1[]
  readonly totals: {
    readonly receivedCount: number
    readonly validBeforeDeduplicationCount: number
    readonly deduplicatedCount: number
    readonly rejectedCount: number
  }
  readonly index: CataloguePartDescriptorV1
  readonly shardCount: number
  readonly shards: readonly (CataloguePartDescriptorV1 & { readonly shard: number })[]
  readonly modelNotes: readonly string[]
}

export interface CatalogueSearchEntryV1 {
  readonly catalogId: string
  readonly name: string
  readonly normalizedName: string
  readonly internationalDesignator: string | null
  readonly epochUtc: string
  readonly groups: readonly string[]
  readonly shard: number
}

export interface CatalogueSearchIndexV1 {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly entries: readonly CatalogueSearchEntryV1[]
}

export interface CatalogueRecordV1 {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly OBJECT_NAME: string
  readonly OBJECT_ID: string | null
  readonly CLASSIFICATION_TYPE: string | null
  readonly EPOCH: string
  readonly MEAN_MOTION: number
  readonly ECCENTRICITY: number
  readonly INCLINATION: number
  readonly RA_OF_ASC_NODE: number
  readonly ARG_OF_PERICENTER: number
  readonly MEAN_ANOMALY: number
  readonly EPHEMERIS_TYPE: number
  readonly NORAD_CAT_ID: string
  readonly BSTAR: number
  readonly MEAN_MOTION_DOT: number
  readonly MEAN_MOTION_DDOT: number
  readonly ELEMENT_SET_NO: number | null
  readonly REV_AT_EPOCH: number | null
  readonly CENTER_NAME: 'Earth'
  readonly REF_FRAME: 'TEME'
  readonly TIME_SYSTEM: 'UTC'
  readonly MEAN_ELEMENT_THEORY: 'SGP4'
  readonly groups: readonly string[]
  readonly provenance: OmmProvenance
}

export interface CatalogueRecordShardV1 {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly shard: number
  readonly records: Readonly<Record<string, CatalogueRecordV1>>
}

export interface CatalogueSnapshotParts {
  readonly pointer: CataloguePointerV1
  readonly manifest: CatalogueManifestV1
  readonly index: CatalogueSearchIndexV1
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
export const PROVIDER_ID_PATTERN = /^[a-z0-9-]{1,32}$/
export const CATALOGUE_ID_PATTERN = /^[a-z0-9-]{1,40}$/
const HTTPS_URL_PATTERN = /^https:\/\/[^\s"'<>]{1,200}$/
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isString(value: unknown): value is string { return typeof value === 'string' }
function nonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function pathForSnapshot(path: unknown, snapshotId: string, leaf: string): boolean { return path === `${CATALOGUE_ROOT}snapshots/${snapshotId}/${leaf}` }

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const copy = new Uint8Array(input.byteLength); copy.set(input)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function serializeCatalogueRecord(definition: OmmDefinition, snapshotId: string, groups: readonly string[]): CatalogueRecordV1 {
  const elements = definition.meanElements
  return {
    schemaVersion: 1, snapshotId, OBJECT_NAME: definition.name, OBJECT_ID: definition.objectId,
    CLASSIFICATION_TYPE: definition.classification, EPOCH: epochToIsoUtc(elements.epoch),
    MEAN_MOTION: elements.meanMotionRadPerMinute * 1440 / (Math.PI * 2),
    ECCENTRICITY: elements.eccentricity, INCLINATION: elements.inclinationRad * 180 / Math.PI,
    RA_OF_ASC_NODE: elements.raanRad * 180 / Math.PI, ARG_OF_PERICENTER: elements.argumentOfPerigeeRad * 180 / Math.PI,
    MEAN_ANOMALY: elements.meanAnomalyRad * 180 / Math.PI, EPHEMERIS_TYPE: definition.ephemerisType,
    NORAD_CAT_ID: elements.catalogId, BSTAR: elements.bstarPerEarthRadius,
    MEAN_MOTION_DOT: elements.meanMotionFirstDerivativeRadPerMinuteSquared * 1440 ** 2 / (Math.PI * 2),
    MEAN_MOTION_DDOT: elements.meanMotionSecondDerivativeRadPerMinuteCubed * 1440 ** 3 / (Math.PI * 2),
    ELEMENT_SET_NO: definition.elementSetNumber, REV_AT_EPOCH: definition.revolutionNumberAtEpoch,
    CENTER_NAME: 'Earth', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4',
    groups: [...groups].sort(), provenance: definition.provenance,
  }
}

export function decodeCataloguePointer(value: unknown): CataloguePointerV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isString(value.snapshotId) || !SNAPSHOT_ID_PATTERN.test(value.snapshotId) || !isString(value.publishedAtUtc) || !ISO_UTC_PATTERN.test(value.publishedAtUtc) || !isString(value.providerRetrievedAtUtc) || !ISO_UTC_PATTERN.test(value.providerRetrievedAtUtc) || !isString(value.manifestPath) || !pathForSnapshot(value.manifestPath, value.snapshotId, 'manifest.json') || !isString(value.manifestSha256) || !SHA256_PATTERN.test(value.manifestSha256)) throw new Error('Invalid catalogue pointer.')
  return value as unknown as CataloguePointerV1
}

export function decodeCatalogueManifest(value: unknown): CatalogueManifestV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isString(value.snapshotId) || !SNAPSHOT_ID_PATTERN.test(value.snapshotId) || !isString(value.generatedAtUtc) || !ISO_UTC_PATTERN.test(value.generatedAtUtc) || !isString(value.configurationRevision) || !isRecord(value.provider) || !isString(value.provider.id) || !PROVIDER_ID_PATTERN.test(value.provider.id) || !isString(value.provider.name) || !isString(value.provider.sourceAuthority) || value.provider.wireFormat !== 'omm-keyed-json' || !isString(value.provider.homepage) || !HTTPS_URL_PATTERN.test(value.provider.homepage) || !isString(value.provider.retrievedAtUtc) || !ISO_UTC_PATTERN.test(value.provider.retrievedAtUtc) || !Array.isArray(value.groups) || !value.groups.every(validGroupSummary) || !isRecord(value.totals) || !validTotals(value.totals) || !isRecord(value.index) || !nonNegativeInteger(value.shardCount) || value.shardCount < 1 || value.shardCount > MAX_SHARD_COUNT || !Array.isArray(value.shards) || value.shards.length !== value.shardCount || !Array.isArray(value.modelNotes) || !value.modelNotes.every(isString)) throw new Error('Invalid catalogue manifest.')
  if (!validPart(value.index, `${CATALOGUE_ROOT}snapshots/${value.snapshotId}/search-index.json`) || Number((value.index as Record<string, unknown>).entryCount) > 100_000) throw new Error('Invalid catalogue index descriptor.')
  const shards = value.shards as unknown[]
  shards.forEach((shard, index) => {
    if (!isRecord(shard) || shard.shard !== index || !validPart(shard, `${CATALOGUE_ROOT}snapshots/${value.snapshotId}/records-${index}.json`)) throw new Error('Invalid catalogue shard descriptor.')
  })
  return value as unknown as CatalogueManifestV1
}

function validPart(value: unknown, expectedPath: string): value is Record<string, unknown> {
  return isRecord(value) && value.path === expectedPath && nonNegativeInteger(value.byteLength) && isString(value.sha256) && SHA256_PATTERN.test(value.sha256) && nonNegativeInteger(value.entryCount)
}

export function decodeCatalogueIndex(value: unknown, manifest: CatalogueManifestV1): CatalogueSearchIndexV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.snapshotId !== manifest.snapshotId || !Array.isArray(value.entries) || value.entries.length > 100_000) throw new Error('Invalid catalogue search index.')
  for (const entry of value.entries) {
    if (!isRecord(entry) || !isString(entry.catalogId) || !canonicalCatalogId(entry.catalogId) || !isString(entry.name) || !isString(entry.normalizedName) || !isString(entry.epochUtc) || !ISO_UTC_PATTERN.test(entry.epochUtc) || !(entry.internationalDesignator === null || isString(entry.internationalDesignator)) || !Array.isArray(entry.groups) || !entry.groups.every(isString) || !nonNegativeInteger(entry.shard) || entry.shard >= manifest.shardCount) throw new Error('Invalid catalogue search entry.')
  }
  return value as unknown as CatalogueSearchIndexV1
}

export function decodeCatalogueShard(value: unknown, manifest: CatalogueManifestV1, expectedShard: number): CatalogueRecordShardV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.snapshotId !== manifest.snapshotId || value.shard !== expectedShard || !isRecord(value.records)) throw new Error('Invalid catalogue record shard.')
  for (const [id, record] of Object.entries(value.records)) {
    if (!canonicalCatalogId(id) || !isCatalogueRecord(record, manifest.snapshotId, id)) throw new Error('Invalid catalogue record.')
  }
  return value as unknown as CatalogueRecordShardV1
}

function isCatalogueRecord(value: unknown, snapshotId: string, id: string): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === 1 && value.snapshotId === snapshotId && value.NORAD_CAT_ID === id && isString(value.OBJECT_NAME) && (value.OBJECT_ID === null || isString(value.OBJECT_ID)) && (value.CLASSIFICATION_TYPE === null || isString(value.CLASSIFICATION_TYPE)) && isString(value.EPOCH) && ISO_UTC_PATTERN.test(value.EPOCH) && ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) && nonNegativeInteger(value.EPHEMERIS_TYPE) && (value.ELEMENT_SET_NO === null || nonNegativeInteger(value.ELEMENT_SET_NO)) && (value.REV_AT_EPOCH === null || nonNegativeInteger(value.REV_AT_EPOCH)) && value.CENTER_NAME === 'Earth' && value.REF_FRAME === 'TEME' && value.TIME_SYSTEM === 'UTC' && value.MEAN_ELEMENT_THEORY === 'SGP4' && Array.isArray(value.groups) && value.groups.every(isString) && validProvenance(value.provenance, snapshotId)
}

function validProvenance(value: unknown, snapshotId: string): boolean {
  if (!isRecord(value) || (value.kind !== 'manual' && value.kind !== 'catalogue')) return false
  if (value.kind === 'manual') return Object.keys(value).every((key) => key === 'kind')
  return isString(value.providerId) && PROVIDER_ID_PATTERN.test(value.providerId) && Array.isArray(value.groups) && value.groups.every(isString) && isString(value.providerRetrievedAtUtc) && ISO_UTC_PATTERN.test(value.providerRetrievedAtUtc) && value.snapshotId === snapshotId && isString(value.cataloguePublishedAtUtc) && ISO_UTC_PATTERN.test(value.cataloguePublishedAtUtc)
}

function canonicalCatalogId(value: string): boolean { return /^[1-9]\d{0,8}$/.test(value) }

function validGroupSummary(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && CATALOGUE_ID_PATTERN.test(value.id) && isString(value.label) && isString(value.purpose) && (value.membership === 'static' || value.membership === 'query-derived') && isString(value.selection) && nonNegativeInteger(value.selectedCount) && nonNegativeInteger(value.receivedCount) && nonNegativeInteger(value.validCount) && nonNegativeInteger(value.rejectedCount) && value.receivedCount <= value.selectedCount && value.validCount <= value.receivedCount && value.rejectedCount <= value.receivedCount && isString(value.fetchedAtUtc) && ISO_UTC_PATTERN.test(value.fetchedAtUtc)
}

/** `validBeforeDeduplicationCount` counts catalogue memberships, so an object
 *  published in two catalogues contributes twice and the total can legitimately
 *  exceed the number of records the provider returned. What must hold is that
 *  nothing was published that was not received, and nothing was both published
 *  and rejected. */
function validTotals(value: Record<string, unknown>): boolean {
  if (!nonNegativeInteger(value.receivedCount) || !nonNegativeInteger(value.validBeforeDeduplicationCount) || !nonNegativeInteger(value.deduplicatedCount) || !nonNegativeInteger(value.rejectedCount)) return false
  return value.rejectedCount <= value.receivedCount && value.deduplicatedCount <= value.validBeforeDeduplicationCount && value.deduplicatedCount + value.rejectedCount <= value.receivedCount
}

export function elementsFromCatalogueRecord(record: CatalogueRecordV1): Sgp4MeanElements {
  return {
    catalogId: record.NORAD_CAT_ID, epoch: { unixSeconds: Date.parse(record.EPOCH) / 1000 },
    meanMotionRadPerMinute: record.MEAN_MOTION * Math.PI * 2 / 1440,
    meanMotionFirstDerivativeRadPerMinuteSquared: record.MEAN_MOTION_DOT * Math.PI * 2 / 1440 ** 2,
    meanMotionSecondDerivativeRadPerMinuteCubed: record.MEAN_MOTION_DDOT * Math.PI * 2 / 1440 ** 3,
    bstarPerEarthRadius: record.BSTAR, eccentricity: record.ECCENTRICITY,
    inclinationRad: record.INCLINATION * Math.PI / 180, raanRad: record.RA_OF_ASC_NODE * Math.PI / 180,
    argumentOfPerigeeRad: record.ARG_OF_PERICENTER * Math.PI / 180, meanAnomalyRad: record.MEAN_ANOMALY * Math.PI / 180,
    nominalPeriodSeconds: 86400 / record.MEAN_MOTION,
  }
}
