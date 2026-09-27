import { describe, expect, it } from 'vitest'
import {
  BAND_DENSITY_FORMAT_VERSION,
  BAND_DENSITY_HEADER_BYTES,
  decodeBandDensity,
  decodeDensityByte,
  encodeBandDensity,
  encodeDensityValue,
} from './bandDensity.ts'

const syntheticMap = { width: 4, height: 2, density: [0, 17, 64, 255, 128, 3, 200, 90] }

describe('band density round trip', () => {
  it('preserves the dimensions and every cell', () => {
    const decoded = decodeBandDensity(encodeBandDensity(syntheticMap))
    expect(decoded.formatVersion).toBe(BAND_DENSITY_FORMAT_VERSION)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(2)
    expect([...decoded.density]).toEqual(syntheticMap.density)
  })

  it('uses the documented size', () => {
    expect(encodeBandDensity(syntheticMap).byteLength).toBe(BAND_DENSITY_HEADER_BYTES + 8)
  })

  it('rejects a truncated file, a foreign file and a cell count that disagrees with the header', () => {
    const encoded = encodeBandDensity(syntheticMap)
    expect(() => decodeBandDensity(encoded.slice(0, 12))).toThrow(/shorter than its header/)
    expect(() => decodeBandDensity(encoded.slice(0, BAND_DENSITY_HEADER_BYTES + 4))).toThrow(/requires/)
    const foreign = new Uint8Array(encoded.slice(0))
    foreign[0] = 'X'.charCodeAt(0)
    expect(() => decodeBandDensity(foreign.buffer)).toThrow(/magic string/)
  })

  it('rejects dimensions that do not match the cells given', () => {
    expect(() => encodeBandDensity({ width: 4, height: 2, density: [1, 2, 3] })).toThrow(/requires 8/)
    expect(() => encodeBandDensity({ width: 0, height: 2, density: [] })).toThrow(/positive integers/)
  })
})

describe('band density value encoding', () => {
  it('round trips the endpoints exactly and the middle within a code value', () => {
    expect(encodeDensityValue(0)).toBe(0)
    expect(encodeDensityValue(1)).toBe(255)
    expect(decodeDensityByte(0)).toBe(0)
    expect(decodeDensityByte(255)).toBe(1)
    for (const value of [0.001, 0.05, 0.25, 0.5, 0.9]) {
      expect(decodeDensityByte(encodeDensityValue(value))).toBeCloseTo(value, 2)
    }
  })

  it('is monotonic, and clamps rather than wrapping', () => {
    let previous = -1
    for (let byte = 0; byte <= 255; byte += 1) {
      const value = decodeDensityByte(byte)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
    expect(encodeDensityValue(-5)).toBe(0)
    expect(encodeDensityValue(5)).toBe(255)
  })

  /**
   * The point of the gamma encode: the faint sky is most of the sky, so the
   * quantisation step there has to be small relative to the value rather than
   * small in absolute terms.
   */
  it('spends codes on the faint end', () => {
    expect(encodeDensityValue(0.01)).toBeGreaterThan(0.01 * 255)
  })
})
