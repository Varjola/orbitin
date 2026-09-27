import { describe, expect, it } from 'vitest'
import type { TemeState } from './satelliteJsAdapter.ts'
import { applyMat3, multiplyMat3 } from '../core/mat3.ts'
import { temeToProjectInertialMatrix, projectInertialToTemeMatrix, temeToProjectInertialState } from './teme.ts'
import { parseTle } from '../data/tle.ts'
import { createSatelliteJsAdapter } from './satelliteJsAdapter.ts'
import { VANGUARD_1_LINE1, VANGUARD_1_LINE2, VANGUARD_1_TEME_AT_PLUS_THREE_DAYS } from '../test-fixtures/sgp4/vallado.ts'

const INSTANT = { unixSeconds: Date.UTC(2004, 3, 6, 7, 51, 28, 386) / 1000 }

function dotRow(a: readonly number[], b: readonly number[], rowA: number, rowB: number): number {
  return a[rowA * 3] * b[rowB * 3] + a[rowA * 3 + 1] * b[rowB * 3 + 1] + a[rowA * 3 + 2] * b[rowB * 3 + 2]
}

describe('TEME frame conversion', () => {
  it('is an orthonormal rotation with an inverse round trip', () => {
    const matrix = temeToProjectInertialMatrix(INSTANT)
    const inverse = projectInertialToTemeMatrix(INSTANT)
    const product = multiplyMat3(matrix, inverse)
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
      expect(product[row * 3 + column]).toBeCloseTo(row === column ? 1 : 0, 14)
    }
    for (let row = 0; row < 3; row += 1) expect(dotRow(matrix, matrix, row, row)).toBeCloseTo(1, 14)
    expect(dotRow(matrix, matrix, 0, 1)).toBeCloseTo(0, 14)
    expect(dotRow(matrix, matrix, 0, 2)).toBeCloseTo(0, 14)
    expect(dotRow(matrix, matrix, 1, 2)).toBeCloseTo(0, 14)
    const vector = { x: 1.234, y: -5.678, z: 9.1011 }
    const roundTrip = applyMat3(inverse, applyMat3(matrix, vector))
    expect(roundTrip.x).toBeCloseTo(vector.x, 13)
    expect(roundTrip.y).toBeCloseTo(vector.y, 13)
    expect(roundTrip.z).toBeCloseTo(vector.z, 13)
  })

  it('uses the same instantaneous rotation for position and velocity', () => {
    const state: TemeState = {
      positionTemeKm: { x: 5094.18016210, y: 6127.64465950, z: 6380.34453270 },
      velocityTemeKmPerSecond: { x: -4.746131487, y: 0.785818041, z: 5.531931288 },
    }
    const matrix = temeToProjectInertialMatrix(INSTANT)
    const converted = temeToProjectInertialState(state, INSTANT)
    expect(converted.positionProjectInertialKm).toEqual(applyMat3(matrix, state.positionTemeKm))
    expect(converted.velocityProjectInertialKmPerSecond).toEqual(applyMat3(matrix, state.velocityTemeKmPerSecond))
  })

  it('agrees with the published future-date Vallado J2000 conversion within the documented UTC/EOP budget', () => {
    const parsed = parseTle(`${VANGUARD_1_LINE1}\n${VANGUARD_1_LINE2}`)
    if (!parsed.ok) throw new Error('fixture must parse')
    const source = parsed.definition
    const raw = createSatelliteJsAdapter(source).temeStateAt({ unixSeconds: source.epoch.unixSeconds + 3 * 86400 })
    const converted = temeToProjectInertialState(raw, { unixSeconds: source.epoch.unixSeconds + 3 * 86400 })
    // The paper's J2000 example uses full UTC/UT1/leap-second inputs; this
    // application intentionally uses UTC as UT1 and omits EOP. Keep a broad
    // numerical guard here and document the measured residual rather than
    // pretending those omitted inputs are available.
    expect(converted.positionProjectInertialKm.x).toBeCloseTo(-9059.9413786, 2)
    expect(converted.positionProjectInertialKm.y).toBeCloseTo(4659.6972000, 2)
    expect(converted.positionProjectInertialKm.z).toBeCloseTo(813.9588875, 2)
    expect(converted.velocityProjectInertialKmPerSecond.x).toBeCloseTo(-2.233348094, 3)
    expect(converted.velocityProjectInertialKmPerSecond.y).toBeCloseTo(-4.110136162, 3)
    expect(converted.velocityProjectInertialKmPerSecond.z).toBeCloseTo(-3.157394074, 3)
    expect(VANGUARD_1_TEME_AT_PLUS_THREE_DAYS.positionKm.x).toBeCloseTo(raw.positionTemeKm.x, 8)
  })
})

it('reuses the matrix for an identical instant without changing any value', () => {
  const at = { unixSeconds: 1_774_008_000.25 }
  const first = temeToProjectInertialMatrix(at)
  expect(temeToProjectInertialMatrix({ unixSeconds: at.unixSeconds })).toBe(first)
  const other = temeToProjectInertialMatrix({ unixSeconds: at.unixSeconds + 3600 })
  expect(other).not.toBe(first)
  // Recomputed after a different instant, the values are bit-identical.
  expect([...temeToProjectInertialMatrix(at)]).toEqual([...first])
})
