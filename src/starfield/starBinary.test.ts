import { describe, expect, it } from 'vitest'
import {
  STAR_BINARY_BYTES_PER_STAR,
  STAR_BINARY_FORMAT_VERSION,
  STAR_BINARY_HEADER_BYTES,
  decodeStarBinary,
  encodeStarBinary,
} from './starBinary.ts'

const syntheticCatalogue = {
  limitingMagnitude: 7,
  directionEci: [1, 0, 0, 0, 1, 0, 0, 0, -1, 0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
  visualMagnitude: [-1.46, 0.03, 3.2, 6.75],
  colorIndexBv: [0.0, 1.85, Number.NaN, -0.3],
}

describe('star binary round trip', () => {
  it('preserves every field within float32 tolerance', () => {
    const decoded = decodeStarBinary(encodeStarBinary(syntheticCatalogue))
    expect(decoded.formatVersion).toBe(STAR_BINARY_FORMAT_VERSION)
    expect(decoded.starCount).toBe(4)
    expect(decoded.limitingMagnitude).toBeCloseTo(7, 6)
    for (let index = 0; index < syntheticCatalogue.directionEci.length; index += 1) {
      expect(decoded.directionEci[index]).toBeCloseTo(syntheticCatalogue.directionEci[index]!, 6)
    }
    for (let index = 0; index < syntheticCatalogue.visualMagnitude.length; index += 1) {
      expect(decoded.visualMagnitude[index]).toBeCloseTo(syntheticCatalogue.visualMagnitude[index]!, 5)
    }
    expect(decoded.colorIndexBv[0]).toBeCloseTo(0, 6)
    expect(decoded.colorIndexBv[1]).toBeCloseTo(1.85, 5)
    expect(decoded.colorIndexBv[2]).toBeNaN()
    expect(decoded.colorIndexBv[3]).toBeCloseTo(-0.3, 5)
  })

  it('uses the documented size and encodes an empty catalogue', () => {
    expect(encodeStarBinary(syntheticCatalogue).byteLength).toBe(STAR_BINARY_HEADER_BYTES + 4 * STAR_BINARY_BYTES_PER_STAR)
    const empty = decodeStarBinary(encodeStarBinary({ limitingMagnitude: 6.5, directionEci: [], visualMagnitude: [], colorIndexBv: [] }))
    expect(empty.starCount).toBe(0)
    expect(empty.directionEci.length).toBe(0)
  })

  it('rejects a bad magic string rather than producing garbage', () => {
    const buffer = encodeStarBinary(syntheticCatalogue)
    new Uint8Array(buffer)[3] = 'X'.charCodeAt(0)
    expect(() => decodeStarBinary(buffer)).toThrow(/magic/)
  })

  it('rejects an unknown format version rather than producing garbage', () => {
    const buffer = encodeStarBinary(syntheticCatalogue)
    new DataView(buffer).setUint32(8, STAR_BINARY_FORMAT_VERSION + 1, true)
    expect(() => decodeStarBinary(buffer)).toThrow(/format version/)
  })

  it('rejects a truncated file', () => {
    const buffer = encodeStarBinary(syntheticCatalogue)
    expect(() => decodeStarBinary(buffer.slice(0, buffer.byteLength - 8))).toThrow(/bytes/)
    expect(() => decodeStarBinary(new ArrayBuffer(8))).toThrow(/header/)
  })

  it('rejects mismatched input array lengths at encode time', () => {
    expect(() => encodeStarBinary({ ...syntheticCatalogue, colorIndexBv: [0] })).toThrow(/colorIndexBv/)
    expect(() => encodeStarBinary({ ...syntheticCatalogue, directionEci: [0, 0, 1] })).toThrow(/directionEci/)
  })
})
