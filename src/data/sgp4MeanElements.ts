import { MAX_SIMULATION_INSTANT, MIN_SIMULATION_INSTANT } from '../core/constants.ts'
import { TAU, degToRad } from '../core/angles.ts'
import { SECONDS_PER_DAY } from '../core/julianDate.ts'
import type { SimulationInstant } from '../core/time.ts'

/** The explicit application-owned input contract for scalar SGP4.
 *
 * The rates use the units consumed by satellite.js' SatRec initializer. TLE
 * printed /2 and /6 fields and OMM's rev/day fields are converted by their
 * parsers exactly once before this type is constructed.
 */
export interface Sgp4MeanElements {
  readonly catalogId: string
  readonly epoch: SimulationInstant
  readonly meanMotionRadPerMinute: number
  readonly meanMotionFirstDerivativeRadPerMinuteSquared: number
  readonly meanMotionSecondDerivativeRadPerMinuteCubed: number
  readonly bstarPerEarthRadius: number
  readonly eccentricity: number
  readonly inclinationRad: number
  readonly raanRad: number
  readonly argumentOfPerigeeRad: number
  readonly meanAnomalyRad: number
  readonly nominalPeriodSeconds: number
}

export function normalizeCatalogId(value: string): string | null {
  if (!/^\d{1,9}$/.test(value)) return null
  const normalized = value.replace(/^0+(?=\d)/, '')
  return normalized === '0' ? null : normalized
}

export function meanMotionFromRevolutionsPerDay(revolutionsPerDay: number): number {
  return revolutionsPerDay * TAU / (SECONDS_PER_DAY / 60)
}

export function firstDerivativeFromRevolutionsPerDaySquared(value: number): number {
  return value * TAU / (SECONDS_PER_DAY / 60) ** 2
}

export function secondDerivativeFromRevolutionsPerDayCubed(value: number): number {
  return value * TAU / (SECONDS_PER_DAY / 60) ** 3
}

export function meanElementsFromSourceUnits(input: {
  catalogId: string
  epoch: SimulationInstant
  meanMotionRevolutionsPerDay: number
  meanMotionFirstDerivativeRevolutionsPerDaySquared: number
  meanMotionSecondDerivativeRevolutionsPerDayCubed: number
  bstarPerEarthRadius: number
  eccentricity: number
  inclinationDeg: number
  raanDeg: number
  argumentOfPerigeeDeg: number
  meanAnomalyDeg: number
}): Sgp4MeanElements {
  const nominalPeriodSeconds = SECONDS_PER_DAY / input.meanMotionRevolutionsPerDay
  return {
    catalogId: input.catalogId,
    epoch: { ...input.epoch },
    meanMotionRadPerMinute: meanMotionFromRevolutionsPerDay(input.meanMotionRevolutionsPerDay),
    meanMotionFirstDerivativeRadPerMinuteSquared: firstDerivativeFromRevolutionsPerDaySquared(input.meanMotionFirstDerivativeRevolutionsPerDaySquared),
    meanMotionSecondDerivativeRadPerMinuteCubed: secondDerivativeFromRevolutionsPerDayCubed(input.meanMotionSecondDerivativeRevolutionsPerDayCubed),
    bstarPerEarthRadius: input.bstarPerEarthRadius,
    eccentricity: input.eccentricity,
    inclinationRad: degToRad(input.inclinationDeg),
    raanRad: degToRad(input.raanDeg),
    argumentOfPerigeeRad: degToRad(input.argumentOfPerigeeDeg),
    meanAnomalyRad: degToRad(input.meanAnomalyDeg),
    nominalPeriodSeconds,
  }
}

export function isSupportedSimulationInstant(instant: SimulationInstant): boolean {
  return Number.isFinite(instant.unixSeconds) && instant.unixSeconds >= MIN_SIMULATION_INSTANT.unixSeconds && instant.unixSeconds < MAX_SIMULATION_INSTANT.unixSeconds
}

export function epochToIsoUtc(epoch: SimulationInstant): string {
  return new Date(epoch.unixSeconds * 1000).toISOString()
}
