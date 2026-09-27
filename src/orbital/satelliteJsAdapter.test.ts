import { describe, expect, it } from 'vitest'
import { parseTle } from '../data/tle.ts'
import { createSatelliteJsAdapter, satRecErrorCode } from './satelliteJsAdapter.ts'
import { SatRecError } from '../vendor/satellite-js-scalar.ts'
import {
  MOLNIYA_2_14_LINE1,
  MOLNIYA_2_14_LINE2,
  HIGH_DRAG_LINE1,
  HIGH_DRAG_LINE2,
  VANGUARD_1_LINE1,
  VANGUARD_1_LINE2,
  VANGUARD_1_TEME_AT_EPOCH,
  VANGUARD_1_TEME_AT_PLUS_THREE_DAYS,
} from '../test-fixtures/sgp4/vallado.ts'

function definition(line1: string, line2: string) {
  const result = parseTle(`${line1}\n${line2}`)
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '))
  return result.definition
}

function expectVector(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }, tolerance: number): void {
  expect(actual.x).toBeCloseTo(expected.x, Math.max(0, Math.floor(-Math.log10(tolerance))))
  expect(actual.y).toBeCloseTo(expected.y, Math.max(0, Math.floor(-Math.log10(tolerance))))
  expect(actual.z).toBeCloseTo(expected.z, Math.max(0, Math.floor(-Math.log10(tolerance))))
}

describe('satellite.js SGP4 adapter', () => {
  it('matches the fixed Vallado near-earth TEME fixture at epoch and +3 days', () => {
    const source = definition(VANGUARD_1_LINE1, VANGUARD_1_LINE2)
    const adapter = createSatelliteJsAdapter(source)
    const atEpoch = adapter.temeStateAt(source.epoch)
    const afterThreeDays = adapter.temeStateAt({ unixSeconds: source.epoch.unixSeconds + 3 * 86400 })
    expectVector(atEpoch.positionTemeKm, VANGUARD_1_TEME_AT_EPOCH.positionKm, 1e-8)
    expectVector(atEpoch.velocityTemeKmPerSecond, VANGUARD_1_TEME_AT_EPOCH.velocityKmPerSecond, 1e-9)
    expectVector(afterThreeDays.positionTemeKm, VANGUARD_1_TEME_AT_PLUS_THREE_DAYS.positionKm, 1e-8)
    expectVector(afterThreeDays.velocityTemeKmPerSecond, VANGUARD_1_TEME_AT_PLUS_THREE_DAYS.velocityKmPerSecond, 1e-9)
  })

  it('is deterministic across negative, positive, repeated and reordered requests', () => {
    const source = definition(VANGUARD_1_LINE1, VANGUARD_1_LINE2)
    const adapter = createSatelliteJsAdapter(source)
    const before = { unixSeconds: source.epoch.unixSeconds - 3 * 86400 }
    const after = { unixSeconds: source.epoch.unixSeconds + 3 * 86400 }
    const first = adapter.temeStateAt(after)
    adapter.temeStateAt(before)
    adapter.temeStateAt(source.epoch)
    const repeated = adapter.temeStateAt(after)
    expect(repeated).toEqual(first)
    expect(adapter.temeStateAt(before)).toEqual(adapter.temeStateAt(before))
  })

  it('initializes a resonant deep-space record through the same adapter', () => {
    const source = definition(MOLNIYA_2_14_LINE1, MOLNIYA_2_14_LINE2)
    const adapter = createSatelliteJsAdapter(source)
    expect(adapter.record.method).toBe('d')
    for (const days of [-1, 0, 1]) {
      const state = adapter.temeStateAt({ unixSeconds: source.epoch.unixSeconds + days * 86400 })
      expect(Object.values(state.positionTemeKm).every(Number.isFinite)).toBe(true)
      expect(Object.values(state.velocityTemeKmPerSecond).every(Number.isFinite)).toBe(true)
    }
  })

  it('maps every public SatRec failure to a stable application code', () => {
    expect(satRecErrorCode(SatRecError.Decayed)).toBe('decayed')
    expect(satRecErrorCode(SatRecError.MeanMotionBelowZero)).toBe('meanMotionNonPositive')
    expect(satRecErrorCode(SatRecError.MeanEccentricityOutOfRange)).toBe('meanEccentricityOutOfRange')
    expect(satRecErrorCode(SatRecError.PerturbedEccentricityOutOfRange)).toBe('perturbedEccentricityOutOfRange')
    expect(satRecErrorCode(SatRecError.SemiLatusRectumBelowZero)).toBe('semiLatusRectumNegative')
  })

  it('keeps the non-standard community decay policy separate from official decay', () => {
    const source = definition(HIGH_DRAG_LINE1, HIGH_DRAG_LINE2)
    const adapter = createSatelliteJsAdapter(source)
    expect(() => adapter.temeStateAt({ unixSeconds: source.epoch.unixSeconds + 215 * 86400 })).toThrowError(expect.objectContaining({ code: 'decayed' }))
    expect(() => adapter.temeStateAt({ unixSeconds: source.epoch.unixSeconds + 745 * 86400 })).toThrowError(expect.objectContaining({ code: 'communityDecayDetected' }))
  })
})
