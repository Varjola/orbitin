import type { SimulationInstant } from './time.ts'

export const UNIX_EPOCH_JD = 2440587.5
export const J2000_EPOCH_JD = 2451545.0
export const SECONDS_PER_DAY = 86400
export const JULIAN_CENTURY_DAYS = 36525

export function julianDayFromUnixSeconds(unixSeconds: number): number {
  return unixSeconds / SECONDS_PER_DAY + UNIX_EPOCH_JD
}
export function daysSinceJ2000(instant: SimulationInstant): number {
  return julianDayFromUnixSeconds(instant.unixSeconds) - J2000_EPOCH_JD
}
export function julianCenturiesSinceJ2000(instant: SimulationInstant): number {
  return daysSinceJ2000(instant) / JULIAN_CENTURY_DAYS
}
