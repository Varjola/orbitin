import { describe, expect, it } from 'vitest'
import { parseTle } from './tle.ts'

const LINE1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992'
const LINE2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442'

describe('TLE parser', () => {
  it('parses a 2LE and retains source units and conventions', () => {
    const result = parseTle(`${LINE1}\n${LINE2}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.catalogId).toBe('25544')
    expect(result.definition.epoch.unixSeconds).toBe(Date.UTC(2019, 0, 1) / 1000 + (156.50900463 - 1) * 86400)
    expect(result.definition.meanMotionFirstDerivativeOver2RevPerDaySquared).toBeCloseTo(0.00003075)
    expect(result.definition.bstarPerEarthRadius).toBeCloseTo(0.000059442)
    expect(result.definition.nominalPeriodSeconds).toBeCloseTo(86400 / 15.51174618)
  })

  it('accepts a named CRLF 3LE and trims only the display name', () => {
    const result = parseTle(`\r\n0 ISS <demo>\r\n${LINE1}\r\n${LINE2}\r\n`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.definition.name).toBe('ISS <demo>')
  })

  it('rejects internal blanks, checksum changes and mismatched identifiers atomically', () => {
    expect(parseTle(`${LINE1}\n\n${LINE2}`).ok).toBe(false)
    expect(parseTle(`${LINE1.slice(0, -1)}0\n${LINE2}`).ok).toBe(false)
    expect(parseTle(`${LINE1}\n${LINE2.replace('25544', '25545')}`).ok).toBe(false)
  })

  it('preserves Alpha-5 catalogue identifiers when the record is valid', () => {
    const alpha1 = `${LINE1.slice(0, 2)}E8493${LINE1.slice(7)}`
    const alpha2 = `${LINE2.slice(0, 2)}E8493${LINE2.slice(7)}`
    const withChecksums = (line: string): string => {
      let sum = 0
      for (const character of line.slice(0, 68)) sum += /\d/.test(character) ? Number(character) : character === '-' ? 1 : 0
      return `${line.slice(0, 68)}${sum % 10}`
    }
    const result = parseTle(`${withChecksums(alpha1)}\n${withChecksums(alpha2)}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.definition.catalogId).toBe('E8493')
  })
})
