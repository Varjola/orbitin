import { stableJson } from '../../../src/data/catalogueSchema.ts'
import {
  compareCatalogIds, normalizeDateOnly, normalizeInternationalDesignator, normalizeOptionalDecimal, normalizeSourceCode, normalizeUtcDateTime,
  type CatalogueObjectTypeCategory, type CatalogueSourceBatch, type CatalogueSourceRecord, type OptionalValue,
} from '../../../src/data/catalogueSourceRecord.ts'
import { parseOmmRecord, type OmmValidationErrorCode } from '../../../src/data/omm.ts'
import type { CatalogueSourceReport, GpSweepNormalizer, GpSweepProviderDescriptor } from './types.ts'

/** Space-Track GP JSON -> provider-neutral `CatalogueSourceBatch`.
 *
 * Raw Space-Track key names stop in this file. The mapping below is what
 * `SPACE_TRACK_NORMALIZATION_RULES_VERSION` identifies; change the version with
 * the mapping, never one without the other.
 *
 *   NORAD_CAT_ID                 identity.catalogId (via the shared OMM parser)
 *   OBJECT_ID                    identity.internationalDesignator
 *   OBJECT_NAME                  identity.providerName (trimmed, required)
 *   CLASSIFICATION_TYPE          identity.classification
 *   OBJECT_TYPE                  object.type, and object.typeCategory: PAYLOAD, ROCKET BODY and
 *                                DEBRIS map to their category; every other code maps to unknown
 *   COUNTRY_CODE                 object.countryOrSourceCode
 *   LAUNCH_DATE                  object.launchDate
 *   SITE                         object.launchSiteCode
 *   DECAY_DATE                   object.decayDate
 *   RCS_SIZE                     object.rcsSizeCategory
 *   EPOCH, mean elements, ...    gp.definition (existing validated OMM contract)
 *   SEMIMAJOR_AXIS               gp.sourceSemimajorAxisKm
 *   PERIOD                       gp.sourcePeriodMinutes
 *   APOAPSIS                     gp.sourceApogeeAltitudeKm
 *   PERIAPSIS                    gp.sourcePerigeeAltitudeKm
 *   CREATION_DATE                recordProvenance.createdAtUtc
 *   ORIGINATOR                   run.originator when uniform, else recordProvenance.originator
 *   CCSDS_OMM_VERS               run.ommVersion; a run carrying more than one value is refused
 *
 * `COMMENT`, `FILE`, `GP_ID` and `TLE_LINE0..2` are not read, and any key not
 * listed is ignored, so neither can reach the domain or a public snapshot.
 *
 * The field contract was measured against live Space-Track responses on
 * 2026-09-10; the tests in this directory hold it. */
export const SPACE_TRACK_NORMALIZATION_RULES_VERSION = 'space-track-gp/1'

const OPTIONAL_FIELDS = [
  'OBJECT_ID', 'OBJECT_TYPE', 'COUNTRY_CODE', 'LAUNCH_DATE', 'SITE', 'DECAY_DATE', 'RCS_SIZE',
  'SEMIMAJOR_AXIS', 'PERIOD', 'APOAPSIS', 'PERIAPSIS', 'CREATION_DATE', 'ORIGINATOR', 'CCSDS_OMM_VERS',
] as const
export type SpaceTrackOptionalField = typeof OPTIONAL_FIELDS[number]

/** Bounded; a reason never carries record content. */
export type SpaceTrackRecordRejectionReason = 'not-object' | 'blank-name' | `omm-${OmmValidationErrorCode}`

/** Domain name of each optional provider field, for published summaries, which
 *  never carry provider keys. */
export const SPACE_TRACK_OPTIONAL_FIELD_DOMAIN_NAMES: Readonly<Record<SpaceTrackOptionalField, string>> = {
  OBJECT_ID: 'identity.internationalDesignator',
  OBJECT_TYPE: 'object.type',
  COUNTRY_CODE: 'object.countryOrSourceCode',
  LAUNCH_DATE: 'object.launchDate',
  SITE: 'object.launchSiteCode',
  DECAY_DATE: 'object.decayDate',
  RCS_SIZE: 'object.rcsSizeCategory',
  SEMIMAJOR_AXIS: 'gp.sourceSemimajorAxisKm',
  PERIOD: 'gp.sourcePeriodMinutes',
  APOAPSIS: 'gp.sourceApogeeAltitudeKm',
  PERIAPSIS: 'gp.sourcePerigeeAltitudeKm',
  CREATION_DATE: 'recordProvenance.createdAtUtc',
  ORIGINATOR: 'provenance.originator',
  CCSDS_OMM_VERS: 'run.ommVersion',
}

export interface SpaceTrackRunContext {
  readonly providerId: string
  readonly sourceAuthority: string
  readonly queryDescription: string
  readonly retrievalStartedAtUtc: string
  readonly retrievedAtUtc: string
}

export interface SpaceTrackNormalizationReport {
  readonly receivedCount: number
  readonly publishedCount: number
  readonly identicalDuplicateCount: number
  readonly rejectedCount: number
  readonly rejectedByReason: Readonly<Partial<Record<SpaceTrackRecordRejectionReason, number>>>
  /** Malformed optional values that were omitted from otherwise valid records. */
  readonly optionalFieldErrors: Readonly<Partial<Record<SpaceTrackOptionalField, number>>>
  /** International designators carried by more than one catalogue id. The
   *  records stay separate; this is a diagnostic for review. */
  readonly sharedInternationalDesignators: { readonly designatorCount: number; readonly catalogIds: readonly string[] }
}

export type SpaceTrackNormalizationResult =
  | { readonly ok: true; readonly batch: CatalogueSourceBatch; readonly report: SpaceTrackNormalizationReport }
  | { readonly ok: false; readonly failure: 'conflicting-duplicate-catalog-id' | 'mixed-omm-version'; readonly catalogIds: readonly string[]; readonly report: SpaceTrackNormalizationReport }

const MAX_LISTED_IDS = 50

/** Exact provider codes observed in the 2026-09-13 preflight. `UNKNOWN` and any
 *  code not listed map to `unknown`. A Map, so a code such as `constructor`
 *  cannot resolve to an inherited property. */
const OBJECT_TYPE_CATEGORIES: ReadonlyMap<string, CatalogueObjectTypeCategory> = new Map([
  ['PAYLOAD', 'payload'], ['ROCKET BODY', 'rocket-body'], ['DEBRIS', 'debris'],
])

interface Draft {
  readonly source: Omit<CatalogueSourceRecord, 'recordProvenance'>
  readonly createdAtUtc?: string
  readonly originator?: string
  readonly ommVersion?: string
}

export function normalizeSpaceTrackGpRecords(records: readonly unknown[], context: SpaceTrackRunContext): SpaceTrackNormalizationResult {
  const accumulator = createSpaceTrackGpAccumulator()
  accumulator.add(records)
  return accumulator.finish(context)
}

/** Normalizes one logical provider run delivered in several parts.
 *
 * A paged sweep feeds its staged pages in order and then finishes once, so the
 * whole-run decisions (duplicates across pages, one OMM version, a uniform
 * originator) are made over the complete candidate exactly as for one response,
 * while only one page's raw records need to be held at a time. Splitting the
 * same records into different parts produces the identical result. */
export interface SpaceTrackGpAccumulator {
  add(records: readonly unknown[]): void
  /** Whether a normalized record with this canonical id is already held. */
  has(catalogId: string): boolean
  finish(context: SpaceTrackRunContext): SpaceTrackNormalizationResult
}

export function createSpaceTrackGpAccumulator(): SpaceTrackGpAccumulator {
  const rejectedByReason: Partial<Record<SpaceTrackRecordRejectionReason, number>> = {}
  const optionalFieldErrors: Partial<Record<SpaceTrackOptionalField, number>> = {}
  const byId = new Map<string, Draft>()
  const conflicting = new Set<string>()
  let identicalDuplicateCount = 0
  let rejectedCount = 0
  let receivedCount = 0
  let finished = false

  return {
    add(records) {
      if (finished) throw new Error('The Space-Track accumulator has already finished.')
      receivedCount += records.length
      for (const raw of records) {
        const result = normalizeOne(raw, optionalFieldErrors)
        if ('reason' in result) {
          rejectedCount += 1
          rejectedByReason[result.reason] = (rejectedByReason[result.reason] ?? 0) + 1
          continue
        }
        const id = result.source.identity.catalogId
        const existing = byId.get(id)
        // Canonical comparison only on an id collision: serializing every record
        // dominated normalization time at catalogue scale.
        if (!existing) byId.set(id, result)
        else if (stableJson(existing) === stableJson(result)) identicalDuplicateCount += 1
        else conflicting.add(id)
      }
    },
    has(catalogId) {
      return byId.has(catalogId)
    },
    finish(context) {
      if (finished) throw new Error('The Space-Track accumulator has already finished.')
      finished = true
      return finishRun({ byId, conflicting, identicalDuplicateCount, rejectedCount, receivedCount, rejectedByReason, optionalFieldErrors }, context)
    },
  }
}

interface AccumulatedRun {
  readonly byId: ReadonlyMap<string, Draft>
  readonly conflicting: ReadonlySet<string>
  readonly identicalDuplicateCount: number
  readonly rejectedCount: number
  readonly receivedCount: number
  readonly rejectedByReason: Partial<Record<SpaceTrackRecordRejectionReason, number>>
  readonly optionalFieldErrors: Partial<Record<SpaceTrackOptionalField, number>>
}

function finishRun(run: AccumulatedRun, context: SpaceTrackRunContext): SpaceTrackNormalizationResult {
  const { byId, conflicting, identicalDuplicateCount, rejectedCount, rejectedByReason, optionalFieldErrors } = run
  const drafts = [...byId.values()].sort((a, b) => compareCatalogIds(a.source.identity.catalogId, b.source.identity.catalogId))
  const report: SpaceTrackNormalizationReport = {
    receivedCount: run.receivedCount,
    publishedCount: conflicting.size === 0 ? drafts.length : 0,
    identicalDuplicateCount,
    rejectedCount,
    rejectedByReason: sortedCounts(rejectedByReason),
    optionalFieldErrors: sortedCounts(optionalFieldErrors),
    sharedInternationalDesignators: sharedDesignators(drafts),
  }
  if (conflicting.size > 0) return { ok: false, failure: 'conflicting-duplicate-catalog-id', catalogIds: [...conflicting].sort(compareCatalogIds).slice(0, MAX_LISTED_IDS), report }

  const ommVersions = new Set(drafts.map((draft) => draft.ommVersion))
  if (ommVersions.size > 1) return { ok: false, failure: 'mixed-omm-version', catalogIds: [], report: { ...report, publishedCount: 0 } }
  const ommVersion = drafts[0]?.ommVersion
  const originators = new Set(drafts.map((draft) => draft.originator))
  const runOriginator = originators.size === 1 ? drafts[0]?.originator : undefined

  const published = drafts.map((draft): CatalogueSourceRecord => {
    const recordProvenance = compact({ createdAtUtc: draft.createdAtUtc, originator: runOriginator === undefined ? draft.originator : undefined })
    return Object.keys(recordProvenance).length === 0 ? draft.source : { ...draft.source, recordProvenance }
  })

  return {
    ok: true,
    report,
    batch: {
      run: compact({
        providerId: context.providerId,
        sourceAuthority: context.sourceAuthority,
        providerRecordClass: 'gp' as const,
        wireFormat: 'omm-keyed-json' as const,
        queryDescription: context.queryDescription,
        retrievalStartedAtUtc: context.retrievalStartedAtUtc,
        retrievedAtUtc: context.retrievedAtUtc,
        ommVersion,
        originator: runOriginator,
        normalizationRulesVersion: SPACE_TRACK_NORMALIZATION_RULES_VERSION,
      }),
      records: published,
    },
  }
}

/** Sweep normalizer for any provider that emits the Space-Track GP dialect
 *  (the live provider and the offline fixture). Each staged page is checked
 *  again before its records enter the whole-run accumulator. */
export function createSpaceTrackDialectSweepNormalizer(descriptor: GpSweepProviderDescriptor): GpSweepNormalizer {
  const accumulator = createSpaceTrackGpAccumulator()
  let supplementAdded = false
  return {
    addPage(body, afterCatalogId, limit) {
      if (supplementAdded) throw new Error('A GP page cannot follow the curated supplement.')
      const inspection = inspectSpaceTrackGpPage(new TextDecoder().decode(body), afterCatalogId, limit)
      if (!inspection.ok) throw new Error(`A staged GP page failed its structural check (${inspection.reason}).`)
      accumulator.add(inspection.records)
    },
    /** The sweep's record wins. A curated id the sweep already
     *  holds is skipped, not counted as a duplicate; an id outside the curated
     *  set is ignored; the rest go through the ordinary path, so a malformed
     *  supplement record is a counted rejection like any other. */
    addSupplement(body, curatedIds) {
      if (supplementAdded) throw new Error('The curated supplement was already added.')
      supplementAdded = true
      // Membership was checked against the requested ids before staging; the
      // list deployed now may differ, so it only decides what is used.
      const inspection = inspectSpaceTrackCuratedResponse(new TextDecoder().decode(body), null)
      if (!inspection.ok) throw new Error(`The staged curated supplement failed its structural check (${inspection.reason}).`)
      const fill: unknown[] = []
      let alreadyInSweep = 0
      let notCurated = 0
      for (const record of inspection.records) {
        const id = canonicalWireCatalogId((record as Record<string, unknown>).NORAD_CAT_ID)!
        if (!curatedIds.has(id)) notCurated += 1
        else if (accumulator.has(id)) alreadyInSweep += 1
        else fill.push(record)
      }
      accumulator.add(fill)
      return { added: fill.length, alreadyInSweep, notCurated }
    },
    finish({ supplemented, ...retrieval }) {
      const queryDescription = supplemented ? `${descriptor.queryDescription}${descriptor.supplementDescription}` : descriptor.queryDescription
      const result = accumulator.finish({ providerId: descriptor.providerId, sourceAuthority: descriptor.sourceAuthority, queryDescription, ...retrieval })
      const report = neutralReport(result.report)
      return result.ok ? { ok: true, batch: result.batch, report } : { ok: false, failure: result.failure, report }
    },
  }
}

function neutralReport(report: SpaceTrackNormalizationReport): CatalogueSourceReport {
  const optionalFieldErrors: Record<string, number> = {}
  for (const [field, count] of Object.entries(report.optionalFieldErrors) as [SpaceTrackOptionalField, number][]) optionalFieldErrors[SPACE_TRACK_OPTIONAL_FIELD_DOMAIN_NAMES[field]] = count
  return {
    receivedCount: report.receivedCount,
    publishedCount: report.publishedCount,
    identicalDuplicateCount: report.identicalDuplicateCount,
    rejectedCount: report.rejectedCount,
    rejectedByReason: { ...report.rejectedByReason } as Record<string, number>,
    optionalFieldErrors: sortedCounts(optionalFieldErrors) as Record<string, number>,
    sharedInternationalDesignatorCount: report.sharedInternationalDesignators.designatorCount,
  }
}

/** Structural checks on one keyset page, before it is staged.
 *
 * A page must be a JSON array of at most `limit` objects whose catalogue ids
 * are canonical, strictly ascending and all greater than the cursor. That is
 * what makes consecutive pages exhaustive and non-overlapping: the next cursor
 * is this page's last id, and a page shorter than `limit` ends the sweep. A
 * record whose id cannot be read breaks that proof, so the page is refused
 * rather than the record being counted as an ordinary rejection. Record
 * content validation is left to normalization at finalization. */
export type SpaceTrackGpPageInspection =
  | { readonly ok: true; readonly records: readonly unknown[]; readonly firstCatalogId: string | null; readonly lastCatalogId: string | null }
  | { readonly ok: false; readonly reason: 'json' | 'not-array' | 'over-limit' | 'record-id' | 'not-after-cursor' | 'not-ascending' }

export function inspectSpaceTrackGpPage(text: string, afterCatalogId: string, limit: number): SpaceTrackGpPageInspection {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, reason: 'json' } }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not-array' }
  if (parsed.length > limit) return { ok: false, reason: 'over-limit' }
  let previous = afterCatalogId
  for (const [position, record] of parsed.entries()) {
    const id = typeof record === 'object' && record !== null && !Array.isArray(record) ? canonicalWireCatalogId((record as Record<string, unknown>).NORAD_CAT_ID) : null
    if (id === null) return { ok: false, reason: 'record-id' }
    if (compareCatalogIds(id, previous) <= 0) return { ok: false, reason: position === 0 ? 'not-after-cursor' : 'not-ascending' }
    previous = id
  }
  return { ok: true, records: parsed, firstCatalogId: parsed.length === 0 ? null : canonicalWireCatalogId((parsed[0] as Record<string, unknown>).NORAD_CAT_ID), lastCatalogId: parsed.length === 0 ? null : previous }
}

/** Structural checks on the curated supplement response: a JSON array
 *  whose catalogue ids are canonical and strictly
 *  ascending, and, when checked against the request, at most one record per
 *  requested id and none outside it. Record content validation is left to
 *  normalization, as for a page. */
export type SpaceTrackCuratedInspection =
  | { readonly ok: true; readonly records: readonly unknown[] }
  | { readonly ok: false; readonly reason: 'json' | 'not-array' | 'over-limit' | 'record-id' | 'not-requested' | 'not-ascending' }

export function inspectSpaceTrackCuratedResponse(text: string, requested: ReadonlySet<string> | null): SpaceTrackCuratedInspection {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, reason: 'json' } }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not-array' }
  if (requested && parsed.length > requested.size) return { ok: false, reason: 'over-limit' }
  let previous = '0'
  for (const record of parsed) {
    const id = typeof record === 'object' && record !== null && !Array.isArray(record) ? canonicalWireCatalogId((record as Record<string, unknown>).NORAD_CAT_ID) : null
    if (id === null) return { ok: false, reason: 'record-id' }
    if (requested && !requested.has(id)) return { ok: false, reason: 'not-requested' }
    if (compareCatalogIds(id, previous) <= 0) return { ok: false, reason: 'not-ascending' }
    previous = id
  }
  return { ok: true, records: parsed }
}

function canonicalWireCatalogId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : null
  if (text === null || !/^\d{1,9}$/.test(text)) return null
  const canonical = text.replace(/^0+/, '')
  return canonical.length === 0 ? null : canonical
}

function normalizeOne(raw: unknown, fieldErrors: Partial<Record<SpaceTrackOptionalField, number>>): Draft | { readonly reason: SpaceTrackRecordRejectionReason } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { reason: 'not-object' }
  const value = raw as Record<string, unknown>
  const parsed = parseOmmRecord(value)
  if (!parsed.ok) return { reason: `omm-${parsed.errors[0]?.code ?? 'recordShape'}` }
  const providerName = parsed.definition.name.trim()
  if (providerName.length === 0) return { reason: 'blank-name' }

  const optional = <T>(field: SpaceTrackOptionalField, normalize: (input: unknown) => OptionalValue<T>): T | undefined => {
    const result = normalize(value[field])
    if (!result.ok) { fieldErrors[field] = (fieldErrors[field] ?? 0) + 1; return undefined }
    return result.value
  }
  const type = optional('OBJECT_TYPE', normalizeSourceCode)

  return compact({
    source: {
      identity: compact({
        catalogId: parsed.definition.meanElements.catalogId,
        internationalDesignator: optional('OBJECT_ID', normalizeInternationalDesignator),
        providerName,
        classification: parsed.definition.classification ?? undefined,
      }),
      object: compact({
        type,
        typeCategory: type === undefined ? undefined : OBJECT_TYPE_CATEGORIES.get(type) ?? 'unknown',
        countryOrSourceCode: optional('COUNTRY_CODE', normalizeSourceCode),
        launchDate: optional('LAUNCH_DATE', normalizeDateOnly),
        launchSiteCode: optional('SITE', normalizeSourceCode),
        decayDate: optional('DECAY_DATE', normalizeDateOnly),
        rcsSizeCategory: optional('RCS_SIZE', normalizeSourceCode),
      }),
      gp: compact({
        definition: parsed.definition,
        sourceSemimajorAxisKm: optional('SEMIMAJOR_AXIS', normalizeOptionalDecimal),
        sourcePeriodMinutes: optional('PERIOD', normalizeOptionalDecimal),
        sourceApogeeAltitudeKm: optional('APOAPSIS', normalizeOptionalDecimal),
        sourcePerigeeAltitudeKm: optional('PERIAPSIS', normalizeOptionalDecimal),
      }),
    },
    createdAtUtc: optional('CREATION_DATE', normalizeUtcDateTime),
    originator: optional('ORIGINATOR', normalizeSourceCode),
    ommVersion: optional('CCSDS_OMM_VERS', normalizeSourceCode),
  })
}

function sharedDesignators(drafts: readonly Draft[]): SpaceTrackNormalizationReport['sharedInternationalDesignators'] {
  const idsByDesignator = new Map<string, string[]>()
  for (const { source } of drafts) {
    const designator = source.identity.internationalDesignator
    if (designator === undefined) continue
    idsByDesignator.set(designator, [...(idsByDesignator.get(designator) ?? []), source.identity.catalogId])
  }
  const shared = [...idsByDesignator.values()].filter((ids) => ids.length > 1)
  return { designatorCount: shared.length, catalogIds: shared.flat().sort(compareCatalogIds).slice(0, MAX_LISTED_IDS) }
}

/** Drops `undefined` properties so absent values stay absent. */
function compact<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> }
}

function sortedCounts<K extends string>(counts: Partial<Record<K, number>>): Partial<Record<K, number>> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as Partial<Record<K, number>>
}
