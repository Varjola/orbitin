import { describe, expect, it } from 'vitest'
import {
  STAR_BRIGHTEST_MAGNITUDE,
  STAR_LIMIT_MAGNITUDE,
  STAR_MAX_POINT_PX,
  STAR_MIN_POINT_PX,
  blackbodyLinearRgb,
  brightnessFromMagnitude,
  pointSizePxFromBrightness,
  starLinearRgbFromColorIndex,
  temperatureKFromColorIndex,
} from './photometry.ts'

describe('brightness from magnitude', () => {
  it('makes a bright star brighter and larger than a faint one', () => {
    const bright = brightnessFromMagnitude(0)
    const faint = brightnessFromMagnitude(5)
    expect(bright).toBeGreaterThan(faint)
    expect(pointSizePxFromBrightness(bright)).toBeGreaterThan(pointSizePxFromBrightness(faint))
  })

  it('keeps every size inside the configured point-size range', () => {
    for (const magnitude of [-1.5, 0, 2.5, 5, 7, 9]) {
      const size = pointSizePxFromBrightness(brightnessFromMagnitude(magnitude))
      expect(size).toBeGreaterThanOrEqual(STAR_MIN_POINT_PX)
      expect(size).toBeLessThanOrEqual(STAR_MAX_POINT_PX)
    }
  })

  it('clamps brightness at both ends of the range', () => {
    expect(brightnessFromMagnitude(STAR_BRIGHTEST_MAGNITUDE)).toBeCloseTo(1, 12)
    expect(brightnessFromMagnitude(-30)).toBe(1)
    expect(brightnessFromMagnitude(STAR_LIMIT_MAGNITUDE)).toBeGreaterThan(0)
    expect(brightnessFromMagnitude(STAR_LIMIT_MAGNITUDE)).toBeLessThan(0.2)
    // Stated relative to the limiting magnitude rather than as an absolute
    // floor, so tuning the compression exponent does not invalidate it.
    expect(brightnessFromMagnitude(40)).toBeLessThan(brightnessFromMagnitude(STAR_LIMIT_MAGNITUDE) / 100)
    expect(brightnessFromMagnitude(40)).toBeGreaterThanOrEqual(0)
  })

  it('falls monotonically across the retained magnitude range', () => {
    let previous = Number.POSITIVE_INFINITY
    for (let magnitude = STAR_BRIGHTEST_MAGNITUDE; magnitude <= STAR_LIMIT_MAGNITUDE; magnitude += 0.25) {
      const brightness = brightnessFromMagnitude(magnitude)
      expect(brightness).toBeLessThan(previous)
      previous = brightness
    }
  })

  it('references the brightest magnitude it is given rather than only the default', () => {
    expect(brightnessFromMagnitude(0, 0)).toBeCloseTo(1, 12)
    expect(brightnessFromMagnitude(0)).toBeLessThan(1)
  })
})

describe('colour index to temperature and linear RGB', () => {
  it('puts Sirius in the blue-white range', () => {
    // Ballesteros at B-V 0.00 gives about 10,125 K; Sirius A is about 9,940 K.
    const temperatureK = temperatureKFromColorIndex(0.0)
    expect(temperatureK).toBeGreaterThan(9000)
    expect(temperatureK).toBeLessThan(10500)
    const rgb = starLinearRgbFromColorIndex(0.0)
    expect(rgb.b).toBeGreaterThan(rgb.r)
  })

  it('puts Betelgeuse in the cool orange range', () => {
    const temperatureK = temperatureKFromColorIndex(1.85)
    expect(temperatureK).toBeGreaterThan(3000)
    expect(temperatureK).toBeLessThan(3800)
    const rgb = starLinearRgbFromColorIndex(1.85)
    expect(rgb.r).toBeGreaterThan(rgb.b)
  })

  it('falls back to neutral white when the colour index is missing', () => {
    expect(temperatureKFromColorIndex(Number.NaN)).toBeNaN()
    expect(starLinearRgbFromColorIndex(Number.NaN)).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('keeps colour restrained rather than fully saturated', () => {
    const restrained = starLinearRgbFromColorIndex(1.85)
    const full = starLinearRgbFromColorIndex(1.85, 1)
    expect(full.b).toBeLessThan(restrained.b)
    expect(restrained.b).toBeLessThan(1)
    expect(starLinearRgbFromColorIndex(1.85, 0)).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('produces components inside the unit range across the blackbody span', () => {
    for (const temperatureK of [1000, 3000, 5800, 10000, 40000, 100000]) {
      const rgb = blackbodyLinearRgb(temperatureK)
      for (const component of [rgb.r, rgb.g, rgb.b]) {
        expect(component).toBeGreaterThanOrEqual(0)
        expect(component).toBeLessThanOrEqual(1)
      }
    }
  })
})
