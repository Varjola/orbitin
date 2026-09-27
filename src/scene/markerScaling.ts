/**
 * Markers are spheres a few hundredths of a render unit across, which reads
 * well at low Earth orbit and disappears at geostationary framing: at the fit
 * distance for a GEO orbit a 0.02 marker covers about one pixel, less than the
 * orbit path drawn through it, so the body hides inside its own trajectory.
 *
 * Zoom-aware sizing keeps the marker at a floor of apparent size instead. The
 * authored size stays the size at close range; further out the marker grows
 * just enough to stay `MIN_MARKER_PIXEL_RADIUS` pixels in radius, so the same
 * slider still means what it meant and nothing shrinks below legibility.
 */

/** Screen radius, in CSS pixels, a marker is never allowed to fall below. */
export const MIN_MARKER_PIXEL_RADIUS = 4

export interface MarkerScaleInput {
  /** Authored marker radius in render units. */
  baseSizeRenderUnits: number
  /** Distance from the camera to the marker, in render units. */
  distanceToCameraRenderUnits: number
  verticalFovRad: number
  viewportHeightCssPx: number
  /** Screen radius floor in CSS pixels; defaults to `MIN_MARKER_PIXEL_RADIUS`. */
  minPixelRadius?: number
}

/**
 * Render-unit radius that keeps a marker at or above the pixel floor.
 *
 * Never returns less than the authored size, so the feature can only enlarge a
 * marker that has become too small to see. Degenerate inputs fall back to the
 * authored size rather than producing a marker of unpredictable size.
 */
export function markerScaleRenderUnits(input: MarkerScaleInput): number {
  const { baseSizeRenderUnits: base, distanceToCameraRenderUnits: distance, verticalFovRad: fov, viewportHeightCssPx: height } = input
  const minPixelRadius = input.minPixelRadius ?? MIN_MARKER_PIXEL_RADIUS
  if (![base, distance, fov, height, minPixelRadius].every((value) => Number.isFinite(value))) return base
  if (distance <= 0 || height <= 0 || minPixelRadius <= 0 || fov <= 0 || fov >= Math.PI) return base
  // Half the viewport height spans distance * tan(fov / 2) render units at the marker.
  const renderUnitsPerPixel = (distance * Math.tan(fov / 2)) / (height / 2)
  return Math.max(base, minPixelRadius * renderUnitsPerPixel)
}
