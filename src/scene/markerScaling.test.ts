import { expect, it } from 'vitest'
import { markerScaleRenderUnits, MIN_MARKER_PIXEL_RADIUS, type MarkerScaleInput } from './markerScaling.ts'

const input: MarkerScaleInput = { baseSizeRenderUnits: 0.02, distanceToCameraRenderUnits: 4, verticalFovRad: Math.PI / 4, viewportHeightCssPx: 800 }

function pixelRadius(size: number, distance: number): number {
  return (size / (distance * Math.tan(input.verticalFovRad / 2))) * (input.viewportHeightCssPx / 2)
}

it('holds the pixel floor as the camera pulls back', () => {
  // Geostationary framing: the authored size alone would be about one pixel.
  const geoDistance = 20
  expect(pixelRadius(input.baseSizeRenderUnits, geoDistance)).toBeLessThan(MIN_MARKER_PIXEL_RADIUS)
  const scaled = markerScaleRenderUnits({ ...input, distanceToCameraRenderUnits: geoDistance })
  expect(pixelRadius(scaled, geoDistance)).toBeCloseTo(MIN_MARKER_PIXEL_RADIUS)
  expect(markerScaleRenderUnits({ ...input, distanceToCameraRenderUnits: 40 })).toBeGreaterThan(scaled)
  expect(markerScaleRenderUnits({ ...input, distanceToCameraRenderUnits: geoDistance, minPixelRadius: 8 })).toBeCloseTo(scaled * 2)
})

it('never shrinks a marker below its authored size', () => {
  expect(markerScaleRenderUnits({ ...input, distanceToCameraRenderUnits: 1.15 })).toBe(input.baseSizeRenderUnits)
  expect(markerScaleRenderUnits({ ...input, baseSizeRenderUnits: 0.05, distanceToCameraRenderUnits: 2 })).toBe(0.05)
})

it('falls back to the authored size on unusable inputs', () => {
  for (const patch of [{ distanceToCameraRenderUnits: 0 }, { distanceToCameraRenderUnits: NaN }, { viewportHeightCssPx: 0 },
    { verticalFovRad: 0 }, { verticalFovRad: Math.PI }, { minPixelRadius: 0 }, { viewportHeightCssPx: Infinity }]) {
    expect(markerScaleRenderUnits({ ...input, ...patch })).toBe(input.baseSizeRenderUnits)
  }
})
