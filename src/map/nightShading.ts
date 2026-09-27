/** Day and night on the 2D map, from the same Sun
 *  direction the globe uses. Night is shaded from sunset (the Sun's centre
 *  on the horizon) through civil and nautical twilight to full shade once
 *  the Sun is 12° below the horizon. Spherical Earth, as the terminator on
 *  the globe; the difference from the geodetic horizon is far below the
 *  shading's softness. */

/** Opacity of full night over the map's ocean and land. */
export const NIGHT_MAX_ALPHA = 0.5
const TWILIGHT_DEPTH_SIN = Math.sin((12 * Math.PI) / 180)

/** Sine of the Sun's elevation seen from (latitude, longitude). */
export function sunElevationSine(latitudeRad: number, longitudeRad: number, subSolarLatitudeRad: number, subSolarLongitudeRad: number): number {
  return Math.sin(latitudeRad) * Math.sin(subSolarLatitudeRad) + Math.cos(latitudeRad) * Math.cos(subSolarLatitudeRad) * Math.cos(longitudeRad - subSolarLongitudeRad)
}

/** Night opacity from 0 (the Sun above the horizon) to NIGHT_MAX_ALPHA. */
export function nightAlpha(elevationSine: number): number {
  const t = Math.min(1, Math.max(0, -elevationSine / TWILIGHT_DEPTH_SIN))
  return NIGHT_MAX_ALPHA * t * t * (3 - 2 * t)
}

/** An equirectangular RGBA grid of the night shade, west to east from
 *  -180°, north to south from 90°, sampled at cell centres. Drawn scaled
 *  with smoothing, a coarse grid gives a smooth terminator. */
export function nightShadeGrid(columns: number, rows: number, subSolarLatitudeRad: number, subSolarLongitudeRad: number, rgb: readonly [number, number, number]): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(columns * rows * 4)
  for (let row = 0; row < rows; row += 1) {
    const latitude = (Math.PI / 2) - ((row + 0.5) / rows) * Math.PI
    for (let column = 0; column < columns; column += 1) {
      const longitude = -Math.PI + ((column + 0.5) / columns) * 2 * Math.PI
      const offset = (row * columns + column) * 4
      pixels[offset] = rgb[0]
      pixels[offset + 1] = rgb[1]
      pixels[offset + 2] = rgb[2]
      pixels[offset + 3] = Math.round(255 * nightAlpha(sunElevationSine(latitude, longitude, subSolarLatitudeRad, subSolarLongitudeRad)))
    }
  }
  return pixels
}
