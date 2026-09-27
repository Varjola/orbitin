import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT } from '../core/constants.ts'
import { degToRad } from '../core/angles.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import type { SimulationInstant } from '../core/time.ts'
import { meanElementsFromSourceUnits, normalizeCatalogId, type Sgp4MeanElements } from './sgp4MeanElements.ts'

export interface TleValidationError {
  readonly code: TleValidationErrorCode
  readonly message: string
  readonly line?: 1 | 2 | 3
  readonly column?: number
}

export type TleValidationErrorCode =
  | 'inputTooLarge'
  | 'recordShape'
  | 'blankLine'
  | 'lineLength'
  | 'nonAscii'
  | 'lineNumber'
  | 'fieldCharacters'
  | 'catalogueMismatch'
  | 'checksum'
  | 'numericField'
  | 'epoch'
  | 'range'
  | 'initialization'

export interface TleDefinition {
  readonly format: 'tle'
  readonly line1: string
  readonly line2: string
  readonly name: string | null
  readonly catalogId: string
  readonly classification: string
  readonly internationalDesignator: string | null
  readonly epoch: SimulationInstant
  readonly meanMotionFirstDerivativeOver2RevPerDaySquared: number
  readonly meanMotionSecondDerivativeOver6RevPerDayCubed: number
  readonly ephemerisType: number
  readonly elementSetNumber: number
  readonly revolutionNumberAtEpoch: number
  readonly bstarPerEarthRadius: number
  readonly meanMotionRevolutionsPerDay: number
  readonly eccentricity: number
  readonly inclinationRad: number
  readonly raanRad: number
  readonly argumentOfPerigeeRad: number
  readonly meanAnomalyRad: number
  readonly nominalPeriodSeconds: number
  readonly meanElements: Sgp4MeanElements
}

export type TleParseResult =
  | { readonly ok: true; readonly definition: TleDefinition }
  | { readonly ok: false; readonly errors: readonly TleValidationError[] }

const MAX_TLE_TEXT_BYTES = 4096
const MAX_TLE_NAME_CODE_POINTS = 80
const TLE_LINE_LENGTH = 69

function error(code: TleValidationErrorCode, message: string, line?: 1 | 2 | 3, column?: number): TleValidationError {
  return { code, message, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) }
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

function checksum(line: string): number {
  let sum = 0
  for (let index = 0; index < 68; index += 1) {
    const character = line[index]
    if (character >= '0' && character <= '9') sum += Number(character)
    else if (character === '-') sum += 1
  }
  return sum % 10
}

function fixedDecimal(field: string): number | null {
  const value = field.trim()
  if (!/^[+-]?\.?\d+$/.test(value) && !/^[+-]?\d+\.\d+$/.test(value)) return null
  const parsed = Number(value.startsWith('.') || value.startsWith('-.') || value.startsWith('+.') ? `${value[0] === '-' ? '-' : ''}0${value.slice(value[0] === '-' || value[0] === '+' ? 1 : 0)}` : value)
  return Number.isFinite(parsed) ? parsed : null
}

function impliedDecimal(field: string): number | null {
  const value = field.trim()
  if (!/^[+-]?\d+[+-]\d$/.test(value)) return null
  const sign = value[0] === '-' ? '-' : ''
  const mantissa = value.slice(value[0] === '+' || value[0] === '-' ? 1 : 0, -2)
  const exponentSign = value.at(-2) === '-' ? '-' : '+'
  const exponent = value.at(-1)
  const parsed = Number(`${sign}0.${mantissa}e${exponentSign}${exponent}`)
  return Number.isFinite(parsed) ? parsed : null
}

function parseUnsigned(field: string): number | null {
  const value = field.trim()
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseName(lines: string[]): { name: string | null; elementLines: string[]; errors: TleValidationError[] } {
  const errors: TleValidationError[] = []
  if (lines.length === 2) return { name: null, elementLines: lines, errors }
  if (lines.length !== 3) return { name: null, elementLines: [], errors: [error('recordShape', 'Paste one TLE (two lines) or one named 3LE record (three lines).')] }
  const raw = lines[0].startsWith('0 ') ? lines[0].slice(2) : lines[0]
  const name = raw.trim()
  if (!name) errors.push(error('recordShape', 'The optional object name cannot be empty.', 3))
  if ([...name].length > MAX_TLE_NAME_CODE_POINTS) errors.push(error('range', `The object name is limited to ${MAX_TLE_NAME_CODE_POINTS} characters.`, 3))
  return { name: name || null, elementLines: lines.slice(1), errors }
}

function parseEpoch(yearField: string, dayField: string): SimulationInstant | null {
  const year = parseUnsigned(yearField)
  const day = Number(dayField.trim())
  if (year === null || !Number.isInteger(year) || !Number.isFinite(day)) return null
  const fullYear = year >= 57 ? 1900 + year : 2000 + year
  const daysInYear = new Date(Date.UTC(fullYear + 1, 0, 1)).getTime() / 86400000 - new Date(Date.UTC(fullYear, 0, 1)).getTime() / 86400000
  if (day < 1 || day >= daysInYear + 1) return null
  const unixSeconds = Date.UTC(fullYear, 0, 1) / 1000 + (day - 1) * SECONDS_PER_DAY
  if (unixSeconds < MIN_SIMULATION_INSTANT.unixSeconds || unixSeconds >= MAX_SIMULATION_INSTANT.unixSeconds) return null
  return { unixSeconds }
}

function checkFieldMasks(line1: string, line2: string): boolean {
  // The two element records are ASCII fixed-column data. Numeric validation
  // below carries the decimal/exponent semantics; these masks reject tabs,
  // shifted fields and invisible repairable input before that stage.
  const fixed = (value: string, pattern: RegExp): boolean => pattern.test(value)
  const checks = [
    line1[1] === ' ', fixed(line1.slice(2, 7), /^[0-9A-Z ]{5}$/), fixed(line1[7], /^[A-Z ]$/), line1[8] === ' ',
    fixed(line1.slice(9, 17), /^[0-9A-Z -]{8}$/), line1[17] === ' ', fixed(line1.slice(18, 20), /^\d{2}$/),
    fixed(line1.slice(20, 32), /^\d{3}\.\d{8}$/), line1[32] === ' ', fixed(line1.slice(33, 43), /^[ +-]\.\d{8}$/),
    line1[43] === ' ', fixed(line1.slice(44, 52), /^[ +-]\d{5}[+-]\d$/), line1[52] === ' ',
    fixed(line1.slice(53, 61), /^[ +-]\d{5}[+-]\d$/), line1[61] === ' ', fixed(line1[62], /^\d$/), line1[63] === ' ',
    fixed(line1.slice(64, 68), /^[ 0-9]{4}$/),
    line2[1] === ' ', fixed(line2.slice(2, 7), /^[0-9A-Z ]{5}$/), line2[7] === ' ', fixed(line2.slice(8, 16), /^[ 0-9.]{8}$/),
    line2[16] === ' ', fixed(line2.slice(17, 25), /^[ 0-9.]{8}$/), line2[25] === ' ', fixed(line2.slice(26, 33), /^[ 0-9]{7}$/),
    line2[33] === ' ', fixed(line2.slice(34, 42), /^[ 0-9.]{8}$/), line2[42] === ' ', fixed(line2.slice(43, 51), /^[ 0-9.]{8}$/),
    line2[51] === ' ', fixed(line2.slice(52, 63), /^[ 0-9.]{11}$/), fixed(line2.slice(63, 68), /^[ 0-9]{5}$/),
  ]
  return checks.every(Boolean)
}

export function parseTle(text: string): TleParseResult {
  if (typeof text !== 'string' || text.length > MAX_TLE_TEXT_BYTES) return { ok: false, errors: [error('inputTooLarge', 'TLE input must be 4 KiB or smaller.')] }
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const rawLines = normalized.split('\n')
  while (rawLines[0] === '') rawLines.shift()
  while (rawLines.at(-1) === '') rawLines.pop()
  if (rawLines.some((line) => line === '')) return { ok: false, errors: [error('blankLine', 'Blank lines are allowed only around the complete record.')] }
  const named = parseName(rawLines)
  const errors = [...named.errors]
  if (named.elementLines.length !== 2) errors.push(error('recordShape', 'Paste one TLE (two lines) or one named 3LE record (three lines).'))
  const [line1, line2] = named.elementLines
  if (!line1 || !line2) return { ok: false, errors }
  if (line1.length !== TLE_LINE_LENGTH) errors.push(error('lineLength', 'Line 1 must contain exactly 69 columns.', 1))
  if (line2.length !== TLE_LINE_LENGTH) errors.push(error('lineLength', 'Line 2 must contain exactly 69 columns.', 2))
  if (!isAscii(line1)) errors.push(error('nonAscii', 'Line 1 contains a non-ASCII or control character.', 1))
  if (!isAscii(line2)) errors.push(error('nonAscii', 'Line 2 contains a non-ASCII or control character.', 2))
  if (line1.length !== 69 || line2.length !== 69) return { ok: false, errors }
  if (line1[0] !== '1') errors.push(error('lineNumber', 'Line 1 must start with line number 1.', 1, 1))
  if (line2[0] !== '2') errors.push(error('lineNumber', 'Line 2 must start with line number 2.', 2, 1))
  if (!checkFieldMasks(line1, line2)) errors.push(error('fieldCharacters', 'One or more fixed-column fields contains an invalid character.'))
  if (line1.slice(2, 7) !== line2.slice(2, 7)) errors.push(error('catalogueMismatch', 'The catalogue identifier must match on both element lines.'))
  if (!/\d/.test(line1[68]) || checksum(line1) !== Number(line1[68])) errors.push(error('checksum', 'Line 1 checksum is invalid.', 1, 69))
  if (!/\d/.test(line2[68]) || checksum(line2) !== Number(line2[68])) errors.push(error('checksum', 'Line 2 checksum is invalid.', 2, 69))
  if (errors.length > named.errors.length) return { ok: false, errors }

  const epoch = parseEpoch(line1.slice(18, 20), line1.slice(20, 32))
  const ndot = fixedDecimal(line1.slice(33, 43))
  const nddot = impliedDecimal(line1.slice(44, 52))
  const bstar = impliedDecimal(line1.slice(53, 61))
  const ephemerisType = parseUnsigned(line1.slice(62, 63))
  const elementSetNumber = parseUnsigned(line1.slice(64, 68))
  const inclination = fixedDecimal(line2.slice(8, 16))
  const raan = fixedDecimal(line2.slice(17, 25))
  const eccentricity = parseUnsigned(`0.${line2.slice(26, 33).trim()}`)
  const argumentOfPerigee = fixedDecimal(line2.slice(34, 42))
  const meanAnomaly = fixedDecimal(line2.slice(43, 51))
  const meanMotion = fixedDecimal(line2.slice(52, 63))
  const revolutionNumberAtEpoch = parseUnsigned(line2.slice(63, 68))
  const numeric = [ndot, nddot, bstar, ephemerisType, elementSetNumber, inclination, raan, eccentricity, argumentOfPerigee, meanAnomaly, meanMotion, revolutionNumberAtEpoch]
  if (numeric.some((value) => value === null)) errors.push(error('numericField', 'One or more numeric TLE fields is not finite or not in its fixed format.'))
  if (!epoch) errors.push(error('epoch', 'The TLE epoch is outside the supported 1950–2050 range or is not a valid day of year.'))
  if (epoch && (line1.slice(18, 20) === '00' || line1.slice(18, 20) === '56')) { /* explicit pivot cases stay covered by parseEpoch */ }
  if (inclination !== null && (inclination < 0 || inclination > 180) || raan !== null && (raan < 0 || raan >= 360) || eccentricity !== null && (eccentricity < 0 || eccentricity >= 1) || argumentOfPerigee !== null && (argumentOfPerigee < 0 || argumentOfPerigee >= 360) || meanAnomaly !== null && (meanAnomaly < 0 || meanAnomaly >= 360) || meanMotion !== null && (meanMotion <= 0 || meanMotion > 20)) {
    errors.push(error('range', 'A printed orbital field is outside the supported TLE range.'))
  }
  if (errors.length) return { ok: false, errors }
  const catalogId = line1.slice(2, 7)
  const normalizedCatalogId = normalizeCatalogId(catalogId.trim()) ?? catalogId.trim()
  const internationalDesignator = line1.slice(9, 17).trim() || null
  const nominalPeriodSeconds = SECONDS_PER_DAY / meanMotion!
  return {
    ok: true,
    definition: {
      format: 'tle', line1, line2, name: named.name, catalogId, classification: line1[7], internationalDesignator,
      epoch: epoch!, meanMotionFirstDerivativeOver2RevPerDaySquared: ndot!,
      meanMotionSecondDerivativeOver6RevPerDayCubed: nddot!, ephemerisType: ephemerisType!, elementSetNumber: elementSetNumber!,
      revolutionNumberAtEpoch: revolutionNumberAtEpoch!, bstarPerEarthRadius: bstar!, meanMotionRevolutionsPerDay: meanMotion!,
      eccentricity: eccentricity!, inclinationRad: degToRad(inclination!), raanRad: degToRad(raan!),
      argumentOfPerigeeRad: degToRad(argumentOfPerigee!), meanAnomalyRad: degToRad(meanAnomaly!), nominalPeriodSeconds,
      meanElements: meanElementsFromSourceUnits({
        catalogId: normalizedCatalogId,
        epoch: epoch!,
        meanMotionRevolutionsPerDay: meanMotion!,
        meanMotionFirstDerivativeRevolutionsPerDaySquared: ndot! * 2,
        meanMotionSecondDerivativeRevolutionsPerDayCubed: nddot! * 6,
        bstarPerEarthRadius: bstar!,
        eccentricity: eccentricity!,
        inclinationDeg: inclination!,
        raanDeg: raan!,
        argumentOfPerigeeDeg: argumentOfPerigee!,
        meanAnomalyDeg: meanAnomaly!,
      }),
    },
  }
}

export const normalizeTle = parseTle
