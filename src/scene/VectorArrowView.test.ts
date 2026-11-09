import { describe, expect, it } from 'vitest'
import { arrowParts, renderUnitsPerPixel } from './VectorArrowView.ts'

describe('screen-sized arrows', () => {
  it('covers twice as much of the scene per pixel from twice as far', () => {
    const near = renderUnitsPerPixel(2, Math.PI / 4, 800)
    expect(renderUnitsPerPixel(4, Math.PI / 4, 800)).toBeCloseTo(2 * near, 12)
    // The whole view's height at that distance spans every pixel row.
    expect(near * 800).toBeCloseTo(2 * 2 * Math.tan(Math.PI / 8), 12)
  })

  it('keeps an arrow the same size on screen at any zoom', () => {
    for (const distance of [0.5, 3, 40]) {
      const pixel = renderUnitsPerPixel(distance, Math.PI / 4, 900)
      const parts = arrowParts(84 * pixel, pixel)
      expect((parts.shaft + parts.head) / pixel).toBeCloseTo(84, 9)
      expect(parts.head / pixel).toBeCloseTo(11, 9)
    }
  })

  it('keeps a short arrow mostly shaft, and has no size without a view', () => {
    const parts = arrowParts(10, 1)
    expect(parts.head).toBeCloseTo(4.5, 12)
    expect(parts.shaft).toBeCloseTo(5.5, 12)
    expect(renderUnitsPerPixel(2, Math.PI / 4, 0)).toBe(0)
  })
})
