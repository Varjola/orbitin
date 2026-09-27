import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT } from '../core/constants.ts'
import { meanElementsFromSourceUnits, normalizeCatalogId, type Sgp4MeanElements } from './sgp4MeanElements.ts'

export type OmmProvenance =
  | { readonly kind: 'manual' }
  | {
      readonly kind: 'catalogue'
      /** Provider identity is recorded for provenance only. Nothing in the
       *  browser branches on which upstream provider produced the record. */
      readonly providerId: string
      readonly groups: readonly string[]
      readonly providerRetrievedAtUtc: string
      readonly snapshotId: string
      readonly cataloguePublishedAtUtc: string
      /** Automatic-profile imports only: bounded source provenance
       *  combined at import from the manifest's run-level values and the
       *  record's own. Absent on legacy imports and older saved state. */
      readonly automatic?: CatalogueImportSourceProvenance
    }

export interface CatalogueImportSourceProvenance {
  readonly sourceAuthority: string
  readonly providerRecordClass: string
  readonly retrievalStartedAtUtc: string
  readonly ommVersion?: string
  /** Record-level originator when it varied within the run, else the run's. */
  readonly originator?: string
  /** Provider `CREATION_DATE` of this record. */
  readonly recordCreatedAtUtc?: string
  readonly normalizationRulesVersion: string
  readonly enrichmentRulesVersion: string
}

export interface OmmDefinition {
  readonly format: 'omm-keyed-json'
  readonly name: string
  readonly internationalDesignator: string | null
  readonly classification: string | null
  readonly objectId: string | null
  readonly ephemerisType: number
  readonly elementSetNumber: number | null
  readonly revolutionNumberAtEpoch: number | null
  readonly meanElements: Sgp4MeanElements
  readonly provenance: OmmProvenance
}

export type OmmValidationErrorCode =
  | 'inputTooLarge'
  | 'json'
  | 'recordShape'
  | 'missing'
  | 'type'
  | 'number'
  | 'epoch'
  | 'range'
  | 'contract'
  | 'initialization'

export interface OmmValidationError {
  readonly code: OmmValidationErrorCode
  readonly field?: string
  readonly message: string
}

export type OmmParseResult =
  | { readonly ok: true; readonly definition: OmmDefinition }
  | { readonly ok: false; readonly errors: readonly OmmValidationError[] }

export const MAX_MANUAL_OMM_TEXT_BYTES = 64 * 1024
export const MAX_PROVIDER_OMM_TEXT_BYTES = 8 * 1024 * 1024
export const MAX_PROVIDER_OMM_RECORDS = 20_000
const MAX_NAME_CODE_POINTS = 120
const MAX_BSTAR = 1_000
const MAX_DERIVATIVE = 1_000

function failure(code: OmmValidationErrorCode, message: string, field?: string): OmmValidationError {
  return { code, message, ...(field === undefined ? {} : { field }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(record: Record<string, unknown>, field: string, errors: OmmValidationError[]): string | null {
  const value = record[field]
  if (value === undefined) { errors.push(failure('missing', `${field} is required.`, field)); return null }
  if (typeof value !== 'string' || value.length === 0) { errors.push(failure('type', `${field} must be a non-empty string.`, field)); return null }
  return value
}

function readOptionalString(record: Record<string, unknown>, field: string, errors: OmmValidationError[]): string | null {
  const value = record[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') { errors.push(failure('type', `${field} must be a string when present.`, field)); return null }
  return value
}

function decimal(value: unknown, field: string, errors: OmmValidationError[]): number | null {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    errors.push(failure('number', `${field} must be finite.`, field)); return null
  }
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    errors.push(failure('number', `${field} must be a finite decimal number.`, field)); return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) { errors.push(failure('number', `${field} must be finite.`, field)); return null }
  return parsed
}

function requiredNumber(record: Record<string, unknown>, field: string, errors: OmmValidationError[]): number | null {
  if (record[field] === undefined || record[field] === null) { errors.push(failure('missing', `${field} is required.`, field)); return null }
  return decimal(record[field], field, errors)
}

function optionalInteger(record: Record<string, unknown>, field: string, errors: OmmValidationError[]): number | null {
  if (record[field] === undefined || record[field] === null) return null
  const value = decimal(record[field], field, errors)
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) { errors.push(failure('range', `${field} must be a non-negative safe integer.`, field)); return null }
  return value
}

/** CCSDS 502.0-B specifies the OMM epoch as an ASCII time code whose time
 *  system is named by TIME_SYSTEM, so a trailing `Z` is optional. Space-Track's
 *  GP JSON emits `2026-09-10T04:07:08.689632` with no designator and declares
 *  `TIME_SYSTEM: UTC`; other providers emit the `Z` form. Both are read as UTC,
 *  and `validateContract` has already rejected any non-UTC time system. */
function parseEpoch(value: string, errors: OmmValidationError[]): { unixSeconds: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/.exec(value)
  if (!match) { errors.push(failure('epoch', 'EPOCH must be an ISO-8601 UTC date and time.', 'EPOCH')); return null }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText)
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) { errors.push(failure('epoch', 'EPOCH contains an invalid UTC date or time.', 'EPOCH')); return null }
  const milliseconds = Number((fraction.slice(0, 3) + '000').slice(0, 3))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, milliseconds))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    errors.push(failure('epoch', 'EPOCH contains an invalid UTC date or time.', 'EPOCH')); return null
  }
  const extraFraction = fraction.length > 3 ? Number(`0.${fraction.slice(3)}`) / 1000 : 0
  const unixSeconds = date.getTime() / 1000 + extraFraction
  if (unixSeconds < MIN_SIMULATION_INSTANT.unixSeconds || unixSeconds >= MAX_SIMULATION_INSTANT.unixSeconds) {
    errors.push(failure('epoch', 'EPOCH is outside the supported 1950–2050 interval.', 'EPOCH')); return null
  }
  return { unixSeconds }
}

/** The physical contract is compared case-insensitively because providers
 *  differ in casing for the same declared meaning: Space-Track GP emits
 *  `CENTER_NAME: "EARTH"` while the CCSDS examples use `Earth`. A genuinely
 *  different centre, frame, time system or theory is still rejected rather than
 *  coerced. */
function validateContract(record: Record<string, unknown>, errors: OmmValidationError[]): void {
  const contracts: readonly [string, string][] = [
    ['CENTER_NAME', 'EARTH'], ['REF_FRAME', 'TEME'], ['TIME_SYSTEM', 'UTC'], ['MEAN_ELEMENT_THEORY', 'SGP4'],
  ]
  for (const [field, expected] of contracts) {
    const value = record[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' || value.trim().toUpperCase() !== expected) errors.push(failure('contract', `${field} must be ${expected}.`, field))
  }
}

export function parseOmmRecord(value: unknown, provenance: OmmProvenance = { kind: 'manual' }): OmmParseResult {
  if (!isRecord(value)) return { ok: false, errors: [failure('recordShape', 'An OMM record must be one JSON object.')] }
  const errors: OmmValidationError[] = []
  validateContract(value, errors)
  const name = readRequiredString(value, 'OBJECT_NAME', errors)
  const epochText = readRequiredString(value, 'EPOCH', errors)
  const idValue = value.NORAD_CAT_ID
  let rawId: string | null = null
  if (idValue === undefined || idValue === null) errors.push(failure('missing', 'NORAD_CAT_ID is required.', 'NORAD_CAT_ID'))
  else if (typeof idValue === 'string' && /^\d{1,9}$/.test(idValue)) rawId = idValue
  else if (typeof idValue === 'number' && Number.isSafeInteger(idValue) && idValue > 0 && idValue <= 999_999_999) rawId = String(idValue)
  else errors.push(failure('type', 'NORAD_CAT_ID must be one to nine ASCII digits.', 'NORAD_CAT_ID'))
  const catalogId = rawId ? normalizeCatalogId(rawId) : null
  if (!catalogId) errors.push(failure('range', 'NORAD_CAT_ID must contain one to nine digits.', 'NORAD_CAT_ID'))
  const numericFields = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'] as const
  const numbers = Object.fromEntries(numericFields.map((field) => [field, requiredNumber(value, field, errors)])) as Record<typeof numericFields[number], number | null>
  const ephemerisType = requiredNumber(value, 'EPHEMERIS_TYPE', errors)
  const elementSetNumber = optionalInteger(value, 'ELEMENT_SET_NO', errors)
  const revolutionNumberAtEpoch = optionalInteger(value, 'REV_AT_EPOCH', errors)
  const classification = readOptionalString(value, 'CLASSIFICATION_TYPE', errors)
  const internationalDesignator = readOptionalString(value, 'OBJECT_ID', errors)
  if (classification !== null && classification.length !== 1) errors.push(failure('range', 'CLASSIFICATION_TYPE must be one character.', 'CLASSIFICATION_TYPE'))
  if (name !== null && ([...name].length === 0 || [...name].length > MAX_NAME_CODE_POINTS || [...name].some((character) => character < ' '))) errors.push(failure('range', 'OBJECT_NAME must contain 1–120 non-control code points.', 'OBJECT_NAME'))
  const epoch = epochText ? parseEpoch(epochText, errors) : null
  const ranges: readonly [string, number | null, number, number][] = [
    ['MEAN_MOTION', numbers.MEAN_MOTION, 0, 20], ['ECCENTRICITY', numbers.ECCENTRICITY, 0, 1],
    ['INCLINATION', numbers.INCLINATION, 0, 180], ['RA_OF_ASC_NODE', numbers.RA_OF_ASC_NODE, 0, 360],
    ['ARG_OF_PERICENTER', numbers.ARG_OF_PERICENTER, 0, 360], ['MEAN_ANOMALY', numbers.MEAN_ANOMALY, 0, 360],
  ]
  for (const [field, number, min, max] of ranges) if (number !== null && (number < min || (field === 'INCLINATION' ? number > max : number >= max))) errors.push(failure('range', `${field} is outside its supported range.`, field))
  for (const field of ['BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'] as const) if (numbers[field] !== null && Math.abs(numbers[field]!) > (field === 'BSTAR' ? MAX_BSTAR : MAX_DERIVATIVE)) errors.push(failure('range', `${field} is outside the defensive supported bound.`, field))
  if (ephemerisType !== null && (!Number.isSafeInteger(ephemerisType) || ephemerisType < 0 || ephemerisType > 9)) errors.push(failure('range', 'EPHEMERIS_TYPE must be an integer from 0 through 9.', 'EPHEMERIS_TYPE'))
  if (errors.length > 0 || !name || !epoch || !catalogId || Object.values(numbers).some((number) => number === null) || ephemerisType === null) return { ok: false, errors }
  try {
    const meanElements = meanElementsFromSourceUnits({
      catalogId, epoch,
      meanMotionRevolutionsPerDay: numbers.MEAN_MOTION!,
      meanMotionFirstDerivativeRevolutionsPerDaySquared: numbers.MEAN_MOTION_DOT!,
      meanMotionSecondDerivativeRevolutionsPerDayCubed: numbers.MEAN_MOTION_DDOT!,
      bstarPerEarthRadius: numbers.BSTAR!, eccentricity: numbers.ECCENTRICITY!, inclinationDeg: numbers.INCLINATION!,
      raanDeg: numbers.RA_OF_ASC_NODE!, argumentOfPerigeeDeg: numbers.ARG_OF_PERICENTER!, meanAnomalyDeg: numbers.MEAN_ANOMALY!,
    })
    if (![meanElements.meanMotionRadPerMinute, meanElements.nominalPeriodSeconds].every(Number.isFinite)) return { ok: false, errors: [failure('initialization', 'The OMM mean motion could not initialize a finite SGP4 input.')] }
    return {
      ok: true,
      definition: {
        format: 'omm-keyed-json', name, internationalDesignator, classification, objectId: internationalDesignator,
        ephemerisType, elementSetNumber, revolutionNumberAtEpoch, meanElements, provenance,
      },
    }
  } catch {
    return { ok: false, errors: [failure('initialization', 'The OMM record could not initialize the SGP4 model.')] }
  }
}

/** The parsed JSON, or the failure, tagged so that input can never pose as
 *  a result. A string longer than the byte limit is
 *  refused before it is encoded. */
function parseJson(text: string, maxBytes: number): { readonly parsed: true; readonly value: unknown } | { readonly parsed: false; readonly failure: { readonly ok: false; readonly errors: readonly OmmValidationError[] } } {
  const tooLarge = { parsed: false as const, failure: { ok: false as const, errors: [failure('inputTooLarge', `OMM input must be ${Math.round(maxBytes / 1024)} KiB or smaller.`)] } }
  if (typeof text !== 'string' || text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) return tooLarge
  try { return { parsed: true, value: JSON.parse(text) as unknown } } catch { return { parsed: false, failure: { ok: false, errors: [failure('json', 'OMM input is not valid JSON.')] } } }
}

export function parseOmmJson(text: string): OmmParseResult {
  const result = parseJson(text, MAX_MANUAL_OMM_TEXT_BYTES)
  if (!result.parsed) return result.failure
  return parseOmmRecord(result.value)
}

export function parseOmmArrayJson(text: string): { readonly ok: true; readonly definitions: readonly OmmDefinition[]; readonly errors: readonly OmmValidationError[]; readonly rejectedRecordCount: number } | { readonly ok: false; readonly errors: readonly OmmValidationError[] } {
  const result = parseJson(text, MAX_PROVIDER_OMM_TEXT_BYTES)
  if (!result.parsed) return result.failure
  const parsed = result.value
  if (!Array.isArray(parsed)) return { ok: false, errors: [failure('recordShape', 'A provider OMM response must be a JSON array.')] }
  if (parsed.length > MAX_PROVIDER_OMM_RECORDS) return { ok: false, errors: [failure('range', `A provider response may contain at most ${MAX_PROVIDER_OMM_RECORDS} records.`)] }
  const definitions: OmmDefinition[] = []; const errors: OmmValidationError[] = []; let rejectedRecordCount = 0
  parsed.forEach((record, index) => {
    const result = parseOmmRecord(record)
    if (result.ok) definitions.push(result.definition)
    else { rejectedRecordCount += 1; errors.push(...result.errors.map((item) => ({ ...item, message: `Record ${index + 1}: ${item.message}` }))) }
  })
  return { ok: true, definitions, errors, rejectedRecordCount }
}
