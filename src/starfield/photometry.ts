import { clamp } from '../core/angles.ts'

/**
 * Faintest star retained by the bake. A bake parameter rather than an
 * architectural constant: `scripts/build-starfield.ts` takes it as a flag, and
 * the value actually used is recorded in the binary's header.
 */
export const STAR_LIMIT_MAGNITUDE = 7.0

/**
 * Magnitude that maps to full brightness. Sirius, the brightest star in the
 * sky, is magnitude -1.46, so nothing in the catalogue is clipped by this.
 *
 * Referencing the flux ratio to `STAR_LIMIT_MAGNITUDE` instead would invert
 * the curve: every star brighter than the limit would land above 1 and clamp
 * flat, leaving the whole sky at maximum brightness. The
 * reference has to be the bright end for the ratio to run downward from 1.
 */
export const STAR_BRIGHTEST_MAGNITUDE = -1.5

/**
 * Compresses the flux ratio. Raw flux spans about three and a half decades
 * across the retained range, so without compression Sirius is the only star
 * with any presence and everything else is an indistinguishable floor. This
 * exponent alone controls how flat or contrasty the sky reads.
 */
export const STAR_BRIGHTNESS_COMPRESSION = 0.25

/**
 * Point-size floor, in CSS pixels before the device pixel ratio. Below about
 * 1.5 px a point shimmers as it crosses pixel boundaries during a camera drag,
 * so faintness is carried by brightness alone under this floor and never by
 * size.
 */
export const STAR_MIN_POINT_PX = 1.6

/** Point size of the brightest retained star, in CSS pixels. */
export const STAR_MAX_POINT_PX = 6.0

/**
 * How far blackbody colour is mixed back toward white. Real stars look close to
 * white to the eye at these light levels; full-saturation blackbody colour
 * reads as a novelty graphic.
 */
export const STAR_SATURATION = 0.6

export interface LinearRgb {
  r: number
  g: number
  b: number
}

/**
 * Perceived brightness in [0, 1] from visual magnitude.
 *
 * `10^(-0.4 * dm)` is the standard flux ratio, referenced to the brightest
 * magnitude so Sirius sits at 1 and the ratio runs downward from there. The
 * exponent then compresses roughly three and a half decades of flux into a
 * range where a magnitude 6 star is still visible next to a magnitude 0 one.
 */
export function brightnessFromMagnitude(visualMagnitude: number, brightestMagnitude = STAR_BRIGHTEST_MAGNITUDE): number {
  const relativeFlux = Math.pow(10, -0.4 * (visualMagnitude - brightestMagnitude))
  return clamp(Math.pow(relativeFlux, STAR_BRIGHTNESS_COMPRESSION), 0, 1)
}

/**
 * Point size in CSS pixels. The caller multiplies by the device pixel ratio,
 * because `gl_PointSize` is in framebuffer pixels.
 */
export function pointSizePxFromBrightness(brightness: number): number {
  const clamped = clamp(brightness, 0, 1)
  return STAR_MIN_POINT_PX + (STAR_MAX_POINT_PX - STAR_MIN_POINT_PX) * clamped
}

/**
 * Effective temperature in kelvin from the B-V colour index, by Ballesteros'
 * formula. Returns NaN for a missing colour index so callers can route it to
 * the neutral fallback rather than silently colouring the star.
 */
export function temperatureKFromColorIndex(colorIndexBv: number): number {
  if (!Number.isFinite(colorIndexBv)) return Number.NaN
  const denominator = 0.92 * colorIndexBv
  return 4600 * (1 / (denominator + 1.7) + 1 / (denominator + 0.62))
}

function srgbComponentToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

/**
 * Blackbody colour as linear RGB, by the widely used piecewise fit to the
 * Planckian locus. The fit is stated in sRGB-encoded 0-255 terms, so it is
 * decoded here: everything downstream lights in linear space and lets the
 * renderer's `outputColorSpace` do the single conversion on output.
 */
export function blackbodyLinearRgb(temperatureK: number): LinearRgb {
  const t = clamp(temperatureK, 1000, 40000) / 100
  let red: number
  let green: number
  let blue: number
  if (t <= 66) {
    red = 255
    green = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    red = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    green = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }
  if (t >= 66) blue = 255
  else if (t <= 19) blue = 0
  else blue = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return {
    r: srgbComponentToLinear(clamp(red, 0, 255) / 255),
    g: srgbComponentToLinear(clamp(green, 0, 255) / 255),
    b: srgbComponentToLinear(clamp(blue, 0, 255) / 255),
  }
}

/**
 * Linear RGB for a star, from its B-V colour index. A missing index yields
 * neutral white rather than an arbitrary temperature.
 */
export function starLinearRgbFromColorIndex(colorIndexBv: number, saturation = STAR_SATURATION): LinearRgb {
  const temperatureK = temperatureKFromColorIndex(colorIndexBv)
  if (!Number.isFinite(temperatureK)) return { r: 1, g: 1, b: 1 }
  const blackbody = blackbodyLinearRgb(temperatureK)
  const mix = clamp(saturation, 0, 1)
  return {
    r: 1 + (blackbody.r - 1) * mix,
    g: 1 + (blackbody.g - 1) * mix,
    b: 1 + (blackbody.b - 1) * mix,
  }
}
