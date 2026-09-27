import { expect, it } from 'vitest'
import { MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT } from './constants.ts'
import { clampInstant, formatUtcDisplay, formatUtcInputValue, parseUtcInputValue } from './timeFormat.ts'
import { daysSinceJ2000, julianCenturiesSinceJ2000, julianDayFromUnixSeconds } from './julianDate.ts'

it('anchors Julian dates and the symmetric supported range', () => {
  expect(julianDayFromUnixSeconds(946728000)).toBe(2451545)
  expect(julianDayFromUnixSeconds(0)).toBe(2440587.5)
  expect(julianCenturiesSinceJ2000({ unixSeconds: 946728000 })).toBe(0)
  expect(daysSinceJ2000(MIN_SIMULATION_INSTANT)).toBe(-18262.5)
  expect(daysSinceJ2000(MAX_SIMULATION_INSTANT)).toBe(18262.5)
  expect(julianCenturiesSinceJ2000(MIN_SIMULATION_INSTANT)).toBe(-0.5)
  expect(julianCenturiesSinceJ2000(MAX_SIMULATION_INSTANT)).toBe(0.5)
  const seconds = Date.UTC(2049, 6, 1, 3, 4, 5) / 1000
  const roundTripSeconds = (julianDayFromUnixSeconds(seconds) - 2440587.5) * 86400
  expect(Math.abs(roundTripSeconds - seconds) / 86400).toBeLessThan(1e-9)
})
it.each(['2026-01-15T03:04:05', '2026-07-15T03:04:05', '2049-12-31T23:59:59'])('round trips UTC independent of host DST: %s', (text) => {
  const instant = { unixSeconds: Date.parse(text + 'Z') / 1000 }
  expect(parseUtcInputValue(formatUtcInputValue(instant))).toEqual(instant)
  expect(formatUtcDisplay(instant)).toBe(text.replace('T', ' ') + ' UTC')
})
it('accepts minute precision and rejects partial or normalized impossible dates', () => {
  expect(parseUtcInputValue('2026-03-20T12:00')).toEqual({ unixSeconds: 1774008000 })
  for (const text of ['', '2026-03', '2026-02-30T12:00', '2026-03-20T24:00', '2026-03-20T12:00:60', '2026-03-20T12:00Z']) expect(parseUtcInputValue(text)).toBeNull()
})
it('clamps supported bounds and rejects nonfinite instants', () => {
  expect(clampInstant({ unixSeconds: -1e12 })).toEqual(MIN_SIMULATION_INSTANT)
  expect(clampInstant({ unixSeconds: 1e12 })).toEqual(MAX_SIMULATION_INSTANT)
  expect(clampInstant({ unixSeconds: 0 })).toEqual({ unixSeconds: 0 })
  expect(() => clampInstant({ unixSeconds: NaN })).toThrow()
})
