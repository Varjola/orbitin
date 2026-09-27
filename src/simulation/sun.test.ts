import { expect, it } from 'vitest'
import { degToRad, radToDeg, wrapRadiansSigned } from '../core/angles.ts'
import { dotVec3, lengthVec3 } from '../core/vec3.ts'
import { equatorialToDirectionEci } from '../starfield/celestial.ts'
import { sunPositionOfDate } from './sun.ts'

// NASA/JPL Horizons DE441, retrieved 2026-09-08, https://ssd.jpl.nasa.gov/api/horizons.api
// COMMAND='10', EPHEM_TYPE='OBSERVER', CENTER='500@399', QUANTITIES='2',
// START_TIME='2026-03-20 12:00', STOP_TIME='2026-06-22 12:00', STEP_SIZE='93d', CSV_FORMAT='YES'.
// Airless apparent equator/equinox of date. Allow 0.02 deg for approximate solar model.
it.each([
  ['2026-03-20T12:00:00Z', 15 * (23 + 59 / 60 + 34.76 / 3600), -(2 / 60 + 43.8 / 3600)],
  ['2026-06-21T12:00:00Z', 15 * (6 + 37.36 / 3600), 23 + 26 / 60 + 16.3 / 3600],
] as const)('matches external apparent solar reference %s', (date, ra, dec) => {
  const sun = sunPositionOfDate({ unixSeconds: Date.parse(date) / 1000 })
  expect(Math.abs(radToDeg(wrapRadiansSigned(sun.rightAscensionRad - degToRad(ra))))).toBeLessThan(0.02)
  expect(Math.abs(radToDeg(sun.declinationRad) - dec)).toBeLessThan(0.02)
})
it('has unit directions, seasonal bounds and the catalogue axis convention', () => {
  for (let year = 1950; year <= 2050; year += 10) {
    const instant = { unixSeconds: Date.UTC(year, 0, 1) / 1000 }
    const sun = sunPositionOfDate(instant)
    expect(lengthVec3(sun.directionMeanOfDate)).toBeCloseTo(1, 12)
    expect(Math.abs(radToDeg(sun.declinationRad))).toBeLessThan(23.45)
    // Only the RA/Dec axis convention is compared: Sun is of date, catalogue J2000.
    expect(equatorialToDirectionEci(sun).x).toBeCloseTo(sun.directionMeanOfDate.x, 12)
    expect(equatorialToDirectionEci(sun).y).toBeCloseTo(sun.directionMeanOfDate.y, 12)
    expect(equatorialToDirectionEci(sun).z).toBeCloseTo(sun.directionMeanOfDate.z, 12)
    const next = sunPositionOfDate({ unixSeconds: instant.unixSeconds + 365.256363 * 86400 })
    expect(radToDeg(Math.acos(Math.min(1, dotVec3(sun.directionMeanOfDate, next.directionMeanOfDate))))).toBeLessThan(0.05)
  }
})
it.each([['2026-03-20T14:46:00Z', 0], ['2026-06-21T08:24:00Z', 23.44], ['2026-09-23T00:05:00Z', 0], ['2026-12-21T20:50:00Z', -23.44]] as const)('follows the seasons %s', (date, dec) => {
  expect(Math.abs(radToDeg(sunPositionOfDate({ unixSeconds: Date.parse(date) / 1000 }).declinationRad) - dec)).toBeLessThan(0.02)
})
