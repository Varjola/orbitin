import type { OmmDefinition } from './omm.ts'

/** Provider-neutral catalogue source contract.
 *
 * A provider adapter turns its own wire records into these types before
 * ingestion, enrichment, publication or any browser code sees them. Nothing
 * here names a provider key, and nothing above an adapter branches on which
 * provider produced a batch.
 *
 * Optional values are absent rather than `undefined`, `null` or an empty string,
 * so a serialized record never carries a placeholder fact. */

export interface CatalogueSourceIdentity {
  readonly catalogId: string
  readonly internationalDesignator?: string
  readonly providerName: string
  readonly classification?: string
}

/** Provider-neutral search category for a source object type. It is still
 *  source classification, not mission purpose. */
export type CatalogueObjectTypeCategory = 'payload' | 'rocket-body' | 'debris' | 'unknown'

/** Source codes are published as the provider wrote them. They are not mission
 *  purpose, ownership, dimensions or operational status. */
export interface CatalogueSourceObject {
  readonly type?: string
  /** Present exactly when `type` is present. The adapter maps the provider
   *  codes it recognizes; any other code is `unknown` and `type` keeps the text. */
  readonly typeCategory?: CatalogueObjectTypeCategory
  readonly countryOrSourceCode?: string
  /** `YYYY-MM-DD`; date-only precision is preserved, never given a time. */
  readonly launchDate?: string
  readonly launchSiteCode?: string
  readonly decayDate?: string
  readonly rcsSizeCategory?: string
}

/** Provider-computed orbit summaries are kept as source values and are never
 *  reconciled with application-derived quantities. */
export interface CatalogueSourceGp {
  readonly definition: OmmDefinition
  readonly sourceSemimajorAxisKm?: number
  readonly sourcePeriodMinutes?: number
  readonly sourceApogeeAltitudeKm?: number
  readonly sourcePerigeeAltitudeKm?: number
}

/** Only provenance that genuinely varies between records of one run. */
export interface CatalogueSourceRecordProvenance {
  readonly createdAtUtc?: string
  readonly originator?: string
}

export interface CatalogueSourceRecord {
  readonly identity: CatalogueSourceIdentity
  readonly object: CatalogueSourceObject
  readonly gp: CatalogueSourceGp
  /** Absent when no record-specific provenance applies. */
  readonly recordProvenance?: CatalogueSourceRecordProvenance
}

/** Once per provider run. Published in the manifest, never per record. */
export interface CatalogueSourceRunProvenance {
  readonly providerId: string
  readonly sourceAuthority: string
  readonly providerRecordClass: 'gp'
  readonly wireFormat: 'omm-keyed-json'
  /** The adopted query, described without credentials or session material. */
  readonly queryDescription: string
  /** When the provider retrieval that produced this batch began. For a paged
   *  sweep this is the retrieval time of its first page. */
  readonly retrievalStartedAtUtc: string
  /** When the provider retrieval completed: for a paged sweep, the retrieval
   *  time of its terminal page. Never earlier than `retrievalStartedAtUtc`. */
  readonly retrievedAtUtc: string
  /** OMM message-format version (CCSDS_OMM_VERS), not a provider schema
   *  version. Absent when the provider omits it. */
  readonly ommVersion?: string
  /** Present only when every record of the run carries the same value. */
  readonly originator?: string
  /** Identifies the adapter's provider-key to domain-field mapping. */
  readonly normalizationRulesVersion: string
}

export interface CatalogueSourceBatch {
  readonly run: CatalogueSourceRunProvenance
  /** Sorted by numeric catalogue id, one record per id. */
  readonly records: readonly CatalogueSourceRecord[]
}

/** Result of normalizing one optional provider value: an absent value is not
 *  an error, a malformed one is reported so it can be counted. */
export type OptionalValue<T> = { readonly ok: true; readonly value?: T } | { readonly ok: false }

export const MAX_SOURCE_CODE_CODE_POINTS = 40

const ABSENT: OptionalValue<never> = { ok: true }
const INVALID: OptionalValue<never> = { ok: false }

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

/** Bounded provider code text: trimmed, display case preserved. */
export function normalizeSourceCode(value: unknown): OptionalValue<string> {
  if (blank(value)) return ABSENT
  if (typeof value !== 'string') return INVALID
  const text = value.trim()
  const codePoints = [...text]
  if (codePoints.length > MAX_SOURCE_CODE_CODE_POINTS || codePoints.some((character) => character < ' ' || character === '')) return INVALID
  return { ok: true, value: text }
}

/** Strict `YYYY-MM-DD` calendar date, re-emitted unchanged. */
export function normalizeDateOnly(value: unknown): OptionalValue<string> {
  if (blank(value)) return ABSENT
  if (typeof value !== 'string') return INVALID
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return INVALID
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? { ok: true, value: text } : INVALID
}

/** A UTC date-time with or without the `Z` designator, emitted with `Z` and
 *  with the provider's fractional-second digits preserved. */
export function normalizeUtcDateTime(value: unknown): OptionalValue<string> {
  if (blank(value)) return ABSENT
  if (typeof value !== 'string') return INVALID
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/.exec(value.trim())
  if (!match) return INVALID
  const [, date, hour, minute, second, fraction = ''] = match
  if (normalizeDateOnly(date).ok === false || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return INVALID
  return { ok: true, value: `${date}T${hour}:${minute}:${second}${fraction}Z` }
}

/** COSPAR international designator in the published `YYYY-NNNP[PP]` form. */
export function normalizeInternationalDesignator(value: unknown): OptionalValue<string> {
  if (blank(value)) return ABSENT
  if (typeof value !== 'string') return INVALID
  const text = value.trim()
  return /^\d{4}-\d{3}[A-Z]{1,3}$/.test(text) ? { ok: true, value: text } : INVALID
}

/** Finite decimal from a JSON number or decimal string. */
export function normalizeOptionalDecimal(value: unknown): OptionalValue<number> {
  if (blank(value)) return ABSENT
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : INVALID
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return INVALID
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? { ok: true, value: parsed === 0 ? 0 : parsed } : INVALID
}

/** Numeric order of canonical catalogue ids (no leading zeros). */
export function compareCatalogIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}
