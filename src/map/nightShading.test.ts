import { expect, it } from 'vitest'
import { NIGHT_MAX_ALPHA, nightAlpha, nightShadeGrid, sunElevationSine } from './nightShading.ts'

const deg = Math.PI / 180

it('puts the Sun overhead at the sub-solar point and below the horizon on the far side', () => {
  expect(sunElevationSine(10 * deg, 30 * deg, 10 * deg, 30 * deg)).toBeCloseTo(1, 12)
  expect(sunElevationSine(-10 * deg, -150 * deg, 10 * deg, 30 * deg)).toBeCloseTo(-1, 12)
  // 90° away along the equator at an equinox: exactly on the terminator.
  expect(sunElevationSine(0, 120 * deg, 0, 30 * deg)).toBeCloseTo(0, 12)
})

it('shades nothing in daylight, fully after nautical twilight, smoothly between', () => {
  expect(nightAlpha(0.2)).toBe(0)
  expect(nightAlpha(0)).toBe(0)
  expect(nightAlpha(-Math.sin(12 * deg))).toBeCloseTo(NIGHT_MAX_ALPHA, 12)
  const middle = nightAlpha(-Math.sin(6 * deg))
  expect(middle).toBeGreaterThan(0)
  expect(middle).toBeLessThan(NIGHT_MAX_ALPHA)
})

it('lights the summer pole and darkens the winter pole at a solstice', () => {
  const columns = 36
  const rows = 18
  const grid = nightShadeGrid(columns, rows, 23.44 * deg, 0, [2, 6, 16])
  const alphaAt = (row: number, column: number) => grid[(row * columns + column) * 4 + 3]
  // The northernmost row is in daylight all round; the southernmost in night.
  for (let column = 0; column < columns; column += 1) {
    expect(alphaAt(0, column)).toBe(0)
    expect(alphaAt(rows - 1, column)).toBeGreaterThan(100)
  }
  // Noon at Greenwich (column 18 starts at 0°) is day; midnight (column 0) is night.
  expect(alphaAt(9, 18)).toBe(0)
  expect(alphaAt(9, 0)).toBeGreaterThan(100)
  expect(grid[0]).toBe(2)
})
