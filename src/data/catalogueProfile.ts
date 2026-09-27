import { altitudeBandFor, primaryOrbitClassFor, type AltitudeBand, type DerivedCatalogueMetadata, type DerivedOrbitMetadata, type PrimaryOrbitClass, type Sgp4Regime } from './catalogueEnrichment.ts'
import type { CatalogueManifestV1, CatalogueRecordV1, CatalogueSearchEntryV1 } from './catalogueSchema.ts'
import {
  normalizeDateOnly, normalizeInternationalDesignator, normalizeSourceCode, normalizeUtcDateTime,
  type CatalogueObjectTypeCategory, type CatalogueSourceGp, type CatalogueSourceObject, type CatalogueSourceRecord, type CatalogueSourceRecordProvenance, type CatalogueSourceRunProvenance,
} from './catalogueSourceRecord.ts'

/** The automatic-catalogue profile of `/catalog/v1/`.
 *
 * A snapshot is exactly one of:
 *
 * - **legacy**: no part carries any reserved automatic key;
 * - **complete automatic**: the manifest, index and every shard carry the same
 *   `catalogueProfile`, and every entry and record carries its required blocks;
 * - **malformed partial**: anything else. The decoders throw, so the browser
 *   keeps its last known-good catalogue.
 *
 * Existing v1 fields keep their original meaning and old decoders ignore the
 * added keys. Inside contract version 1 the added blocks are closed: an
 * unexpected key rejects, so source, derived and future external values cannot
 * be decoded as one another, and a new field is a contract-version change.
 *
 * Index projections use compact keys because the index is downloaded whole.
 * Shard blocks keep readable names because a shard is fetched for one import. */

export const AUTOMATIC_CATALOGUE_CONTRACT_VERSION = 1 as const

export interface CatalogueProfileV1 {
  readonly kind: 'automatic-catalogue'
  readonly contractVersion: typeof AUTOMATIC_CATALOGUE_CONTRACT_VERSION
  readonly normalizationRulesVersion: string
  readonly enrichmentRulesVersion: string
}

/** Run-level source provenance, published once in the manifest. */
export type CatalogueSourceRunV1 = CatalogueSourceRunProvenance

/** Keys are bounded domain names or rejection reasons, never provider keys or
 *  record content. */
export interface AutomaticCatalogueSummaryV1 {
  readonly receivedCount: number
  readonly rejectedCount: number
  readonly acceptedBeforeDeduplicationCount: number
  readonly identicalDuplicateCount: number
  readonly publishedCount: number
  readonly rejectedByReason: Readonly<Record<string, number>>
  readonly optionalFieldErrors: Readonly<Record<string, number>>
  readonly optionalFieldCoverage: Readonly<Record<string, number>>
}

export type ObjectTypeCategoryCode = 'pay' | 'rb' | 'deb' | 'unk'
export type AltitudeBandCode = 'leo' | 'meo' | 'high' | 'cross'
export type PrimaryOrbitClassCode = AltitudeBandCode | 'geo' | 'ellip'
export type Sgp4RegimeCode = 'near' | 'deep'

/** Compact source search projection on an index entry. */
export interface AutomaticIndexSourceV1 {
  /** Source object type text. */
  readonly t?: string
  /** Object type category; present exactly when `t` is. */
  readonly k?: ObjectTypeCategoryCode
  /** Country or source code. */
  readonly c?: string
  /** Launch date, `YYYY-MM-DD`. */
  readonly l?: string
}

/** Compact derived search projection on an index entry. */
export interface AutomaticIndexDerivedV1 {
  readonly o: PrimaryOrbitClassCode
  readonly b: AltitudeBandCode
  readonly r: Sgp4RegimeCode
  /** Flag bits: 1 near-polar, 2 near-equatorial, 4 high eccentricity,
   *  8 near-geosynchronous, 16 GEO-like. */
  readonly f: number
}

/** Source block on a shard record. Identity, name, classification and the OMM
 *  values already live in the v1 record and are not repeated. */
export interface AutomaticRecordSourceV1 {
  /** Validated COSPAR designator; absent when the provider value was missing
   *  or malformed, while v1 `OBJECT_ID` keeps the provider text. */
  readonly internationalDesignator?: string
  readonly object: CatalogueSourceObject
  readonly gp: Omit<CatalogueSourceGp, 'definition'>
  readonly recordProvenance?: CatalogueSourceRecordProvenance
}

export interface AutomaticSearchProjection {
  readonly source: Pick<CatalogueSourceObject, 'type' | 'typeCategory' | 'countryOrSourceCode' | 'launchDate'>
  readonly derived: Pick<DerivedOrbitMetadata, 'primaryOrbitClass' | 'altitudeBand' | 'sgp4Regime' | 'nearPolar' | 'nearEquatorial' | 'highEccentricity' | 'nearGeosynchronous' | 'geoLike'>
}

export type CatalogueProfileMode = 'legacy' | 'automatic'

const TYPE_CATEGORY_CODES: Readonly<Record<CatalogueObjectTypeCategory, ObjectTypeCategoryCode>> = { payload: 'pay', 'rocket-body': 'rb', debris: 'deb', unknown: 'unk' }
const ALTITUDE_BAND_CODES: Readonly<Record<AltitudeBand, AltitudeBandCode>> = { 'low-earth': 'leo', 'medium-earth': 'meo', 'high-earth': 'high', 'crossing-bands': 'cross' }
const PRIMARY_CLASS_CODES: Readonly<Record<PrimaryOrbitClass, PrimaryOrbitClassCode>> = { ...ALTITUDE_BAND_CODES, geosynchronous: 'geo', 'highly-elliptical': 'ellip' }
const REGIME_CODES: Readonly<Record<Sgp4Regime, Sgp4RegimeCode>> = { 'near-earth': 'near', 'deep-space': 'deep' }
const TYPE_CATEGORIES = inverse(TYPE_CATEGORY_CODES)
const ALTITUDE_BANDS = inverse(ALTITUDE_BAND_CODES)
const PRIMARY_CLASSES = inverse(PRIMARY_CLASS_CODES)
const REGIMES = inverse(REGIME_CODES)

const FLAG_BITS = { nearPolar: 1, nearEquatorial: 2, highEccentricity: 4, nearGeosynchronous: 8, geoLike: 16 } as const
type OrbitFlag = keyof typeof FLAG_BITS
const FLAG_NAMES = Object.keys(FLAG_BITS) as OrbitFlag[]
const ALL_FLAG_BITS = 31

const MANIFEST_KEYS = ['catalogueProfile', 'sourceRun', 'automaticSummary'] as const
const ENTRY_KEYS = ['src', 'drv'] as const
/** `external` is reserved for future enrichment blocks and absent in contract 1. */
const RECORD_KEYS = ['source', 'derived', 'external'] as const
const PROFILE_KEYS = ['kind', 'contractVersion', 'normalizationRulesVersion', 'enrichmentRulesVersion']
const SOURCE_RUN_KEYS = ['providerId', 'sourceAuthority', 'providerRecordClass', 'wireFormat', 'queryDescription', 'retrievalStartedAtUtc', 'retrievedAtUtc', 'ommVersion', 'originator', 'normalizationRulesVersion']
const SUMMARY_KEYS = ['receivedCount', 'rejectedCount', 'acceptedBeforeDeduplicationCount', 'identicalDuplicateCount', 'publishedCount', 'rejectedByReason', 'optionalFieldErrors', 'optionalFieldCoverage']
const INDEX_SOURCE_KEYS = ['t', 'k', 'c', 'l']
const INDEX_DERIVED_KEYS = ['o', 'b', 'r', 'f']
const RECORD_SOURCE_KEYS = ['internationalDesignator', 'object', 'gp', 'recordProvenance']
const SOURCE_OBJECT_KEYS = ['type', 'typeCategory', 'countryOrSourceCode', 'launchDate', 'launchSiteCode', 'decayDate', 'rcsSizeCategory']
const SOURCE_GP_KEYS = ['sourceSemimajorAxisKm', 'sourcePeriodMinutes', 'sourceApogeeAltitudeKm', 'sourcePerigeeAltitudeKm']
const RECORD_PROVENANCE_KEYS = ['createdAtUtc', 'originator']
const DERIVED_KEYS = ['rulesVersion', 'orbit', 'launchYear']
const ORBIT_KEYS = ['basis', 'recoveredPeriodMinutes', 'semimajorAxisKm', 'perigeeAltitudeKm', 'apogeeAltitudeKm', 'sgp4Regime', 'altitudeBand', 'primaryOrbitClass', ...FLAG_NAMES]

const RULES_VERSION_PATTERN = /^[a-z0-9-]{1,40}\/\d{1,6}$/
const PROVIDER_ID_PATTERN = /^[a-z0-9-]{1,32}$/
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const COUNT_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,63}$/
const MAX_COUNT_KEYS = 64

// ---------------------------------------------------------------------------
// Encoding (used by snapshot construction and fixtures)

export function catalogueProfileFor(normalizationRulesVersion: string, enrichmentRulesVersion: string): CatalogueProfileV1 {
  return { kind: 'automatic-catalogue', contractVersion: AUTOMATIC_CATALOGUE_CONTRACT_VERSION, normalizationRulesVersion, enrichmentRulesVersion }
}

export function encodeAutomaticRecordSource(record: CatalogueSourceRecord): AutomaticRecordSourceV1 {
  const gp = record.gp
  return compact({
    internationalDesignator: record.identity.internationalDesignator,
    object: record.object,
    gp: compact({ sourceSemimajorAxisKm: gp.sourceSemimajorAxisKm, sourcePeriodMinutes: gp.sourcePeriodMinutes, sourceApogeeAltitudeKm: gp.sourceApogeeAltitudeKm, sourcePerigeeAltitudeKm: gp.sourcePerigeeAltitudeKm }),
    recordProvenance: record.recordProvenance,
  })
}

export function encodeAutomaticSearchProjection(source: AutomaticRecordSourceV1, derived: DerivedCatalogueMetadata): { readonly src: AutomaticIndexSourceV1; readonly drv: AutomaticIndexDerivedV1 } {
  const object = source.object
  const orbit = derived.orbit
  return {
    src: compact({ t: object.type, k: object.typeCategory === undefined ? undefined : TYPE_CATEGORY_CODES[object.typeCategory], c: object.countryOrSourceCode, l: object.launchDate }),
    drv: {
      o: PRIMARY_CLASS_CODES[orbit.primaryOrbitClass],
      b: ALTITUDE_BAND_CODES[orbit.altitudeBand],
      r: REGIME_CODES[orbit.sgp4Regime],
      f: FLAG_NAMES.reduce((bits, flag) => (orbit[flag] ? bits | FLAG_BITS[flag] : bits), 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Reading decoded parts

export function catalogueProfileMode(manifest: CatalogueManifestV1): CatalogueProfileMode {
  return manifest.catalogueProfile === undefined ? 'legacy' : 'automatic'
}

/** Readable search projection, or `null` for a legacy entry. Nothing is
 *  manufactured for a legacy entry. */
export function automaticSearchProjection(entry: CatalogueSearchEntryV1): AutomaticSearchProjection | null {
  if (entry.src === undefined || entry.drv === undefined) return null
  const { src, drv } = entry
  return {
    source: compact({ type: src.t, typeCategory: src.k === undefined ? undefined : TYPE_CATEGORIES.get(src.k), countryOrSourceCode: src.c, launchDate: src.l }),
    derived: {
      primaryOrbitClass: PRIMARY_CLASSES.get(drv.o)!,
      altitudeBand: ALTITUDE_BANDS.get(drv.b)!,
      sgp4Regime: REGIMES.get(drv.r)!,
      nearPolar: (drv.f & FLAG_BITS.nearPolar) !== 0,
      nearEquatorial: (drv.f & FLAG_BITS.nearEquatorial) !== 0,
      highEccentricity: (drv.f & FLAG_BITS.highEccentricity) !== 0,
      nearGeosynchronous: (drv.f & FLAG_BITS.nearGeosynchronous) !== 0,
      geoLike: (drv.f & FLAG_BITS.geoLike) !== 0,
    },
  }
}

/** Source and derived blocks of a shard record, or `null` for a legacy record. */
export function automaticRecordMetadata(record: CatalogueRecordV1): { readonly source: AutomaticRecordSourceV1; readonly derived: DerivedCatalogueMetadata } | null {
  return record.source === undefined || record.derived === undefined ? null : { source: record.source, derived: record.derived }
}

/** True when the index entry's projection is exactly what the shard record's
 *  blocks encode to. Legacy pairs carry neither and match trivially. */
export function indexEntryMatchesRecord(entry: CatalogueSearchEntryV1, record: CatalogueRecordV1): boolean {
  const entryAutomatic = entry.src !== undefined || entry.drv !== undefined
  const recordAutomatic = record.source !== undefined || record.derived !== undefined
  if (!entryAutomatic && !recordAutomatic) return true
  if (entry.src === undefined || entry.drv === undefined || record.source === undefined || record.derived === undefined) return false
  const expected = encodeAutomaticSearchProjection(record.source, record.derived)
  return sameFlat(expected.src, entry.src) && sameFlat(expected.drv, entry.drv)
}

// ---------------------------------------------------------------------------
// Validation. Called by the v1 decoders after their own checks.

export class MalformedCatalogueProfileError extends Error {
  constructor(reason: string) { super(`Malformed automatic catalogue data: ${reason}.`); this.name = 'MalformedCatalogueProfileError' }
}

function fail(reason: string): never { throw new MalformedCatalogueProfileError(reason) }

export function validateManifestProfile(manifest: Record<string, unknown>): void {
  if (!has(manifest, 'catalogueProfile')) {
    if (MANIFEST_KEYS.some((key) => has(manifest, key))) fail('the manifest carries automatic metadata without a catalogue profile')
    return
  }
  const profile = manifest.catalogueProfile
  if (!validProfile(profile)) fail('the manifest catalogue profile is invalid')
  const run = manifest.sourceRun
  if (!validSourceRun(run)) fail('the manifest source run is missing or invalid')
  const summary = manifest.automaticSummary
  if (!validSummary(summary)) fail('the manifest automatic summary is missing or invalid')

  if (run.normalizationRulesVersion !== profile.normalizationRulesVersion) fail('the source run and profile normalization rules versions disagree')
  const provider = manifest.provider as Record<string, unknown>
  if (run.providerId !== provider.id || run.sourceAuthority !== provider.sourceAuthority || run.wireFormat !== provider.wireFormat || run.retrievedAtUtc !== provider.retrievedAtUtc) fail('the source run and provider provenance disagree')
  if ((manifest.groups as unknown[]).length !== 0) fail('an automatic manifest lists groups')

  const totals = manifest.totals as Record<string, unknown>
  if (totals.receivedCount !== summary.receivedCount || totals.rejectedCount !== summary.rejectedCount || totals.validBeforeDeduplicationCount !== summary.acceptedBeforeDeduplicationCount || totals.deduplicatedCount !== summary.publishedCount) fail('the automatic summary and v1 totals disagree')
  if (summary.acceptedBeforeDeduplicationCount + summary.rejectedCount !== summary.receivedCount || summary.publishedCount + summary.identicalDuplicateCount !== summary.acceptedBeforeDeduplicationCount) fail('the automatic summary counts do not add up')
  if (sum(Object.values(summary.rejectedByReason)) !== summary.rejectedCount) fail('the rejection reasons do not add up to the rejected count')
  if (Object.values(summary.optionalFieldCoverage).some((count) => count > summary.publishedCount) || Object.values(summary.optionalFieldErrors).some((count) => count > summary.receivedCount)) fail('an optional-field count exceeds its population')
  const index = manifest.index as Record<string, unknown>
  const shards = manifest.shards as Record<string, unknown>[]
  if (index.entryCount !== summary.publishedCount || sum(shards.map((shard) => shard.entryCount as number)) !== summary.publishedCount) fail('the part entry counts and published count disagree')
}

/** Index top level; call `validateIndexEntryProfile` for each entry. */
export function validateIndexProfile(index: Record<string, unknown>, manifest: CatalogueManifestV1): void {
  validatePartProfile(index, manifest, 'index')
}

export function validateIndexEntryProfile(entry: Record<string, unknown>, manifest: CatalogueManifestV1): void {
  if (manifest.catalogueProfile === undefined) {
    if (ENTRY_KEYS.some((key) => has(entry, key))) fail('a legacy index entry carries automatic metadata')
    return
  }
  if ((entry.groups as unknown[]).length !== 0) fail('an automatic index entry lists groups')
  if (!validIndexSource(entry.src)) fail('an index entry source projection is missing or invalid')
  if (!validIndexDerived(entry.drv)) fail('an index entry derived projection is missing or invalid')
}

/** Shard top level; call `validateRecordProfile` for each record. */
export function validateShardProfile(shard: Record<string, unknown>, manifest: CatalogueManifestV1): void {
  validatePartProfile(shard, manifest, 'shard')
}

export function validateRecordProfile(record: Record<string, unknown>, manifest: CatalogueManifestV1): void {
  const profile = manifest.catalogueProfile
  const run = manifest.sourceRun
  if (profile === undefined || run === undefined) {
    if (RECORD_KEYS.some((key) => has(record, key))) fail('a legacy record carries automatic metadata')
    return
  }
  if (has(record, 'external')) fail('a record carries an external enrichment block, which contract version 1 does not define')
  if ((record.groups as unknown[]).length !== 0) fail('an automatic record lists groups')
  const provenance = record.provenance as Record<string, unknown>
  if (provenance.kind !== 'catalogue' || provenance.providerId !== run.providerId || provenance.providerRetrievedAtUtc !== run.retrievedAtUtc || (provenance.groups as unknown[]).length !== 0) fail('record provenance disagrees with the source run')

  const source = record.source
  if (!validRecordSource(source)) fail('a record source block is missing or invalid')
  if (source.internationalDesignator !== undefined && source.internationalDesignator !== (typeof record.OBJECT_ID === 'string' ? record.OBJECT_ID.trim() : null)) fail('a record source designator disagrees with OBJECT_ID')
  if (run.originator !== undefined && source.recordProvenance?.originator !== undefined) fail('a record repeats the run-level originator')

  const derived = record.derived
  if (!validDerived(derived)) fail('a record derived block is missing or invalid')
  if (derived.rulesVersion !== profile.enrichmentRulesVersion) fail('a record derived rules version disagrees with the profile')
  const launchDate = source.object.launchDate
  if ((derived.launchYear === undefined) !== (launchDate === undefined) || (launchDate !== undefined && derived.launchYear !== Number(launchDate.slice(0, 4)))) fail('a record launch year disagrees with its source launch date')
}

function validatePartProfile(part: Record<string, unknown>, manifest: CatalogueManifestV1, name: string): void {
  const expected = manifest.catalogueProfile
  if (expected === undefined) {
    if (has(part, 'catalogueProfile')) fail(`a legacy ${name} carries a catalogue profile`)
    return
  }
  const actual = part.catalogueProfile
  if (!validProfile(actual) || PROFILE_KEYS.some((key) => actual[key as keyof CatalogueProfileV1] !== expected[key as keyof CatalogueProfileV1])) fail(`the ${name} catalogue profile does not match the manifest`)
}

function validProfile(value: unknown): value is CatalogueProfileV1 {
  return isRecord(value) && onlyKeys(value, PROFILE_KEYS) && value.kind === 'automatic-catalogue' && value.contractVersion === AUTOMATIC_CATALOGUE_CONTRACT_VERSION && rulesVersion(value.normalizationRulesVersion) && rulesVersion(value.enrichmentRulesVersion)
}

function validSourceRun(value: unknown): value is CatalogueSourceRunV1 {
  return isRecord(value) && onlyKeys(value, SOURCE_RUN_KEYS) && typeof value.providerId === 'string' && PROVIDER_ID_PATTERN.test(value.providerId) && boundedText(value.sourceAuthority, 200) && value.providerRecordClass === 'gp' && value.wireFormat === 'omm-keyed-json' && boundedText(value.queryDescription, 500) && typeof value.retrievalStartedAtUtc === 'string' && ISO_UTC_PATTERN.test(value.retrievalStartedAtUtc) && typeof value.retrievedAtUtc === 'string' && ISO_UTC_PATTERN.test(value.retrievedAtUtc) && Date.parse(value.retrievalStartedAtUtc) <= Date.parse(value.retrievedAtUtc) && optionalCode(value, 'ommVersion') && optionalCode(value, 'originator') && rulesVersion(value.normalizationRulesVersion)
}

function validSummary(value: unknown): value is AutomaticCatalogueSummaryV1 {
  return isRecord(value) && onlyKeys(value, SUMMARY_KEYS) && ['receivedCount', 'rejectedCount', 'acceptedBeforeDeduplicationCount', 'identicalDuplicateCount', 'publishedCount'].every((key) => count(value[key])) && countMap(value.rejectedByReason) && countMap(value.optionalFieldErrors) && countMap(value.optionalFieldCoverage)
}

function validIndexSource(value: unknown): value is AutomaticIndexSourceV1 {
  if (!isRecord(value) || !onlyKeys(value, INDEX_SOURCE_KEYS) || !optionalCode(value, 't') || !optionalCode(value, 'c') || !optionalDate(value, 'l')) return false
  if (has(value, 't') !== has(value, 'k')) return false
  return !has(value, 'k') || (typeof value.k === 'string' && TYPE_CATEGORIES.has(value.k))
}

function validIndexDerived(value: unknown): value is AutomaticIndexDerivedV1 {
  if (!isRecord(value) || !onlyKeys(value, INDEX_DERIVED_KEYS) || typeof value.o !== 'string' || typeof value.b !== 'string' || typeof value.r !== 'string') return false
  const primary = PRIMARY_CLASSES.get(value.o)
  const band = ALTITUDE_BANDS.get(value.b)
  if (primary === undefined || band === undefined || !REGIMES.has(value.r) || !Number.isSafeInteger(value.f)) return false
  const bits = value.f as number
  if (bits < 0 || bits > ALL_FLAG_BITS) return false
  const flag = (name: OrbitFlag) => (bits & FLAG_BITS[name]) !== 0
  return consistentOrbitLabels(primary, band, flag('nearGeosynchronous'), flag('highEccentricity'), flag('geoLike'), flag('nearPolar'), flag('nearEquatorial'))
}

function validRecordSource(value: unknown): value is AutomaticRecordSourceV1 {
  if (!isRecord(value) || !onlyKeys(value, RECORD_SOURCE_KEYS)) return false
  if (has(value, 'internationalDesignator') && !sameNormalized(value.internationalDesignator, normalizeInternationalDesignator)) return false
  const object = value.object
  if (!isRecord(object) || !onlyKeys(object, SOURCE_OBJECT_KEYS) || !optionalCode(object, 'type') || !optionalCode(object, 'countryOrSourceCode') || !optionalCode(object, 'launchSiteCode') || !optionalCode(object, 'rcsSizeCategory') || !optionalDate(object, 'launchDate') || !optionalDate(object, 'decayDate')) return false
  if (has(object, 'type') !== has(object, 'typeCategory') || (has(object, 'typeCategory') && !(typeof object.typeCategory === 'string' && has(TYPE_CATEGORY_CODES, object.typeCategory)))) return false
  const gp = value.gp
  if (!isRecord(gp) || !onlyKeys(gp, SOURCE_GP_KEYS) || !Object.values(gp).every((item) => typeof item === 'number' && Number.isFinite(item))) return false
  if (!has(value, 'recordProvenance')) return true
  const provenance = value.recordProvenance
  return isRecord(provenance) && Object.keys(provenance).length > 0 && onlyKeys(provenance, RECORD_PROVENANCE_KEYS) && optionalCode(provenance, 'originator') && (!has(provenance, 'createdAtUtc') || sameNormalized(provenance.createdAtUtc, normalizeUtcDateTime))
}

function validDerived(value: unknown): value is DerivedCatalogueMetadata {
  if (!isRecord(value) || !onlyKeys(value, DERIVED_KEYS) || !rulesVersion(value.rulesVersion)) return false
  if (has(value, 'launchYear') && !(Number.isSafeInteger(value.launchYear) && (value.launchYear as number) >= 0 && (value.launchYear as number) <= 9999)) return false
  const orbit = value.orbit
  if (!isRecord(orbit) || !onlyKeys(orbit, ORBIT_KEYS) || orbit.basis !== 'sgp4-initialized-mean-elements') return false
  const numbers = [orbit.recoveredPeriodMinutes, orbit.semimajorAxisKm, orbit.perigeeAltitudeKm, orbit.apogeeAltitudeKm]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return false
  const [period, semimajorAxis, perigee, apogee] = numbers as number[]
  if (period <= 0 || semimajorAxis <= 0 || apogee < perigee) return false
  if (typeof orbit.sgp4Regime !== 'string' || !has(REGIME_CODES, orbit.sgp4Regime) || typeof orbit.altitudeBand !== 'string' || !has(ALTITUDE_BAND_CODES, orbit.altitudeBand) || typeof orbit.primaryOrbitClass !== 'string' || !has(PRIMARY_CLASS_CODES, orbit.primaryOrbitClass)) return false
  if (!FLAG_NAMES.every((flag) => typeof orbit[flag] === 'boolean')) return false
  // The band is a pure function of the two published altitudes, whatever the
  // flag thresholds of a rules version are.
  if (orbit.altitudeBand !== altitudeBandFor(perigee, apogee)) return false
  return consistentOrbitLabels(orbit.primaryOrbitClass as PrimaryOrbitClass, orbit.altitudeBand as AltitudeBand, orbit.nearGeosynchronous as boolean, orbit.highEccentricity as boolean, orbit.geoLike as boolean, orbit.nearPolar as boolean, orbit.nearEquatorial as boolean)
}

function consistentOrbitLabels(primary: PrimaryOrbitClass, band: AltitudeBand, nearGeosynchronous: boolean, highEccentricity: boolean, geoLike: boolean, nearPolar: boolean, nearEquatorial: boolean): boolean {
  return primary === primaryOrbitClassFor(nearGeosynchronous, highEccentricity, band) && (!geoLike || nearGeosynchronous) && !(nearPolar && nearEquatorial)
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function has(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key) }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function rulesVersion(value: unknown): value is string { return typeof value === 'string' && RULES_VERSION_PATTERN.test(value) }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0) }

function boundedText(value: unknown, maxCodePoints: number): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  const codePoints = [...value]
  return codePoints.length <= maxCodePoints && codePoints.every((character) => character >= ' ' && character !== '')
}

function countMap(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.keys(value).length <= MAX_COUNT_KEYS && Object.entries(value).every(([key, item]) => COUNT_KEY_PATTERN.test(key) && count(item))
}

/** A present value must already be in the normalized form the adapter emits. */
function sameNormalized(value: unknown, normalize: (input: unknown) => { readonly ok: boolean; readonly value?: string }): boolean {
  const result = normalize(value)
  return result.ok && result.value !== undefined && result.value === value
}

function optionalCode(value: Record<string, unknown>, key: string): boolean { return !has(value, key) || sameNormalized(value[key], normalizeSourceCode) }
function optionalDate(value: Record<string, unknown>, key: string): boolean { return !has(value, key) || sameNormalized(value[key], normalizeDateOnly) }

function sameFlat(a: object, b: object): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => has(right, key) && left[key] === right[key])
}

function inverse<K extends string, C extends string>(codes: Readonly<Record<K, C>>): ReadonlyMap<string, K> {
  return new Map(Object.entries(codes).map(([key, code]) => [code as string, key as K]))
}

function compact<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> }
}
