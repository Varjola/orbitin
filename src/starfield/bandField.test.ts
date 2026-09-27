import { describe, expect, it } from 'vitest'
import { radToDeg } from '../core/angles.ts'
import { DEFAULT_BAND_FIELD_OPTIONS, generateBandField, magnitudeFromUniform } from './bandField.ts'
import { decodeDensityByte, encodeDensityValue, type BandDensityMap } from './bandDensity.ts'

function mapOf(width: number, height: number, fill: (x: number, y: number) => number): BandDensityMap {
  const density = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) density[y * width + x] = fill(x, y)
  return { formatVersion: 1, width, height, density }
}

const uniform = mapOf(16, 8, () => 255)

function declinationsDeg(directionEci: Float32Array): number[] {
  const values: number[] = []
  for (let index = 0; index < directionEci.length; index += 3) values.push(radToDeg(Math.asin(directionEci[index + 2]!)))
  return values
}

function rightAscensionsDeg(directionEci: Float32Array): number[] {
  const values: number[] = []
  for (let index = 0; index < directionEci.length; index += 3) {
    values.push((radToDeg(Math.atan2(directionEci[index + 1]!, directionEci[index]!)) + 360) % 360)
  }
  return values
}

describe('band field generation', () => {
  it('produces unit directions, magnitudes in range and colours in range', () => {
    const field = generateBandField(uniform, { ...DEFAULT_BAND_FIELD_OPTIONS, starCount: 2000 })
    expect(field.starCount).toBe(2000)
    expect(field.directionEci.length).toBe(6000)
    let worstUnitLengthError = 0
    for (let index = 0; index < field.starCount; index += 1) {
      const length = Math.hypot(field.directionEci[index * 3]!, field.directionEci[index * 3 + 1]!, field.directionEci[index * 3 + 2]!)
      worstUnitLengthError = Math.max(worstUnitLengthError, Math.abs(length - 1))
    }
    expect(worstUnitLengthError).toBeLessThan(1e-6)
    for (let index = 0; index < field.starCount; index += 1) {
      expect(field.visualMagnitude[index]).toBeGreaterThanOrEqual(DEFAULT_BAND_FIELD_OPTIONS.brightestMagnitude)
      expect(field.visualMagnitude[index]).toBeLessThanOrEqual(DEFAULT_BAND_FIELD_OPTIONS.limitingMagnitude)
      expect(field.colorIndexBv[index]).toBeGreaterThanOrEqual(0.2)
      expect(field.colorIndexBv[index]).toBeLessThanOrEqual(1.7)
    }
  })

  /**
   * The seed is fixed so that the sky is the same on every load and on every
   * machine. A generator that drifted would be invisible in a screenshot and
   * obvious to anyone who had learned where the band's knots are.
   */
  it('is deterministic for a given seed and different for a different one', () => {
    const options = { ...DEFAULT_BAND_FIELD_OPTIONS, starCount: 500 }
    const first = generateBandField(uniform, options)
    const second = generateBandField(uniform, options)
    expect([...second.directionEci]).toEqual([...first.directionEci])
    expect([...second.visualMagnitude]).toEqual([...first.visualMagnitude])
    const other = generateBandField(uniform, { ...options, seed: options.seed + 1 })
    expect([...other.directionEci]).not.toEqual([...first.directionEci])
  })

  /**
   * A uniform map has to give a uniform *sphere*, which is the test of the
   * solid-angle weighting: without it the narrow cells at the poles would each
   * receive as many points as the wide ones at the equator and the sky would
   * gain two bright caps. The two caps beyond 60 degrees are `1 - sin 60`, or
   * 13.4 percent, of the sphere between them.
   */
  it('weights cells by solid angle rather than by cell count', () => {
    const field = generateBandField(uniform, { ...DEFAULT_BAND_FIELD_OPTIONS, starCount: 40000 })
    const declinations = declinationsDeg(field.directionEci)
    const polar = declinations.filter((declination) => Math.abs(declination) > 60).length / declinations.length
    expect(polar).toBeCloseTo(1 - Math.sin(Math.PI / 3), 2)
    const northern = declinations.filter((declination) => declination > 0).length / declinations.length
    expect(northern).toBeCloseTo(0.5, 1)
  })

  /** Cell brightness has to set how many points land there, in proportion. */
  it('draws points in proportion to cell brightness', () => {
    // Two columns and one row, so declination plays no part: the half of the
    // sky at right ascension 0 to 180 is four times the surface brightness of
    // the other half. The expected share is computed from the decoded weight
    // rather than from the nominal quarter, because the map stores 8-bit codes
    // and 0.25 is not one of them.
    const dimByte = encodeDensityValue(0.25)
    const twoCells = mapOf(2, 1, (x) => (x === 0 ? 255 : dimByte))
    const field = generateBandField(twoCells, { ...DEFAULT_BAND_FIELD_OPTIONS, starCount: 20000 })
    const eastern = rightAscensionsDeg(field.directionEci).filter((rightAscension) => rightAscension < 180).length
    const expected = 1 / (1 + decodeDensityByte(dimByte))
    expect(eastern / field.starCount).toBeGreaterThan(expected - 0.01)
    expect(eastern / field.starCount).toBeLessThan(expected + 0.01)
  })

  it('places every point in the only cell that has any light', () => {
    const oneCell = mapOf(4, 2, (x, y) => (x === 3 && y === 0 ? 255 : 0))
    const field = generateBandField(oneCell, { ...DEFAULT_BAND_FIELD_OPTIONS, starCount: 200 })
    for (const rightAscension of rightAscensionsDeg(field.directionEci)) {
      expect(rightAscension).toBeGreaterThanOrEqual(270)
      expect(rightAscension).toBeLessThanOrEqual(360)
    }
    for (const declination of declinationsDeg(field.directionEci)) expect(declination).toBeLessThanOrEqual(0)
  })

  it('rejects a map with no light in it', () => {
    expect(() => generateBandField(mapOf(4, 2, () => 0))).toThrow(/every cell is zero/)
  })
})

describe('band magnitude distribution', () => {
  /**
   * `pdf ~ 10^(0.6 m)` puts the median close to the faint limit: half the
   * points sit within the last half magnitude. That is the shape of real star
   * counts, and it is what keeps the field from reading as uniform grain.
   */
  it('follows the count slope, so faint points dominate', () => {
    const options = DEFAULT_BAND_FIELD_OPTIONS
    expect(magnitudeFromUniform(0, options)).toBeCloseTo(options.brightestMagnitude, 6)
    expect(magnitudeFromUniform(1, options)).toBeCloseTo(options.limitingMagnitude, 6)
    expect(magnitudeFromUniform(0.5, options)).toBeCloseTo(12.0, 1)
    const field = generateBandField(uniform, { ...options, starCount: 20000 })
    const brighterThanTen = [...field.visualMagnitude].filter((magnitude) => magnitude < 10).length
    expect(brighterThanTen / field.starCount).toBeLessThan(0.05)
  })
})

