import { describe, expect, it } from 'vitest'
import { TAU, degToRad, radToDeg, wrapDegrees, wrapRadians } from './angles.ts'

describe('angle helpers', () => {
  it('converts degrees and radians', () => {
    expect(radToDeg(degToRad(123.45))).toBeCloseTo(123.45, 12)
  })

  it('wraps angles into positive canonical ranges', () => {
    expect(wrapRadians(-0.5)).toBeCloseTo(TAU - 0.5)
    expect(wrapRadians(TAU)).toBe(0)
    expect(wrapDegrees(-15)).toBe(345)
    expect(wrapDegrees(720)).toBe(0)
  })
})
