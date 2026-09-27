/**
 * Generate the Milky Way band as points, by sampling the baked sky-brightness
 * map in `bandDensity.ts`.
 *
 * ## Why this exists rather than a background texture
 *
 * The band used to be an equirectangular texture applied as `scene.background`.
 * A raster sky cannot match the catalogue points it sits behind: a 2K map
 * resolves 0.176 degrees per pixel against roughly 0.02 on a high-density
 * display at the 45 degree field of view in `camera.ts`, so it reads as blur
 * next to sharp points, and closing that gap needs a 16K map whose cube render
 * target would cost over a gigabyte. Drawing the band as points removes the
 * mismatch by construction: the same shader, the same photometry and the same
 * resolution independence as the catalogue.
 *
 * ## What these stars are, and are not
 *
 * **The positions are statistical, not catalogue positions.** Each point is
 * drawn from the surface-brightness distribution of the NASA SVS starless Milky
 * Way map, so the *population* is faithful - the band, its width, the bulge and
 * the dust lanes all land where the real sky puts them - while any individual
 * point is invented. Magnitude and colour are drawn from plausible
 * distributions rather than measured.
 *
 * That is a deliberate trade for a tool that teaches orbits rather than
 * astrometry. The real faint sky needs Gaia down to about magnitude 12, which
 * is one to two million stars and tens of megabytes. The catalogue that is
 * real - HYG to magnitude 7, in `starBinary.ts` - is unaffected by anything
 * here, `ATTRIBUTION.md` states the distinction, and nothing in the application
 * labels these points as identifiable objects.
 *
 * ## Runtime cost
 *
 * The map is about 128 KiB and the points are generated on load rather than
 * downloaded: `BAND_STAR_COUNT` points would be 4.4 MB in `OETSTAR1`. The
 * generation is one pass to build the cumulative distribution and one binary
 * search per point - measured at 54 ms for the full sky - and it runs after
 * first paint on the same optional path as the catalogue, so nothing waits on
 * it.
 */
import { equatorialToDirectionEci } from './celestial.ts'
import { decodeDensityByte, type BandDensityMap } from './bandDensity.ts'
import { STAR_MIN_POINT_PX } from './photometry.ts'
import type { StarPointSource } from './starBinary.ts'

/**
 * How many points the band is drawn with.
 *
 * This is the knob that sets how substantial the band looks. Point brightness
 * is nearly flat across the magnitude range below - the 0.25 compression in
 * `photometry.ts` maps five and a half magnitudes onto a factor of four - so
 * the band's presence comes from how many points land in it rather than from
 * how bright each one is.
 */
export const BAND_STAR_COUNT = 220_000

/**
 * Magnitude range assigned to the generated points. The bright end sits at the
 * catalogue's limit so the two populations meet without a gap and without
 * overlapping: HYG covers everything brighter, and this covers what it cannot.
 */
export const BAND_BRIGHTEST_MAGNITUDE = 7.0
export const BAND_LIMITING_MAGNITUDE = 12.5

/**
 * Slope of the cumulative star count with magnitude, `log10 N = slope * m`.
 * 0.6 is the Euclidean value for a uniform space density, and it is close to
 * what the real Galactic field shows at these magnitudes. It makes faint points
 * far more numerous than bright ones, which is what keeps the field from
 * reading as uniform grain.
 */
export const BAND_COUNT_SLOPE = 0.6

/**
 * B-V range for the generated population, sampled with a central bias. The
 * faint field is dominated by K and M dwarfs and is reddened by the dust in the
 * plane, so it sits well to the red of the catalogue's mean.
 */
export const BAND_COLOR_INDEX_MIN = 0.2
export const BAND_COLOR_INDEX_MAX = 1.7

/**
 * Fixed seed. The band has to be identical on every load and on every machine:
 * a reload that reshuffled the sky would make screenshots incomparable and
 * would be visible to anyone who knows where the band's brighter knots are.
 */
export const BAND_RANDOM_SEED = 0x5eed5747

export interface BandFieldOptions {
  starCount: number
  brightestMagnitude: number
  limitingMagnitude: number
  countSlope: number
  seed: number
}

export const DEFAULT_BAND_FIELD_OPTIONS: BandFieldOptions = {
  starCount: BAND_STAR_COUNT,
  brightestMagnitude: BAND_BRIGHTEST_MAGNITUDE,
  limitingMagnitude: BAND_LIMITING_MAGNITUDE,
  countSlope: BAND_COUNT_SLOPE,
  seed: BAND_RANDOM_SEED,
}

/**
 * Brightness multiplier applied to the band's points at view construction.
 *
 * Kept separate from magnitude so the layer can be balanced against the
 * catalogue without re-deriving what a magnitude means.
 */
export const BAND_BRIGHTNESS_SCALE = 3.5

/**
 * The band's points are all drawn at the size floor. Above it a faint point
 * gains area rather than presence, and 220,000 points that each grew by a pixel
 * would wash the band into the haze the raster layer was dropped for.
 */
export const BAND_MAX_POINT_PX = STAR_MIN_POINT_PX

/**
 * splitmix32. A seeded generator is required - see `BAND_RANDOM_SEED` - and
 * this one costs a handful of integer operations per draw, which matters when
 * it is called six times per point.
 */
function createRandom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x9e3779b9) | 0
    let z = state
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296
  }
}

/**
 * Cumulative weight per cell, in map order, normalised to end at 1.
 *
 * A cell's weight is its surface brightness times its solid angle. Both factors
 * are needed: brightness alone would put as many points into a cell at the pole
 * as into one at the equator, and the polar cells are narrow, so the sky would
 * gain two bright caps.
 *
 * One flat array over every cell, searched directly. A two-level index - pick a
 * row, then a cell within it - looks like it should win, because this array is
 * a megabyte and the search jumps around it. Measured, it loses: 71 ms against
 * 54 ms for a full sky. The early steps of the search touch the same few
 * addresses every time and stay in cache, so the split buys nothing and costs
 * an extra random draw and a second search setup per point.
 */
function buildCumulativeWeights(map: BandDensityMap): Float64Array {
  const cumulative = new Float64Array(map.width * map.height)
  let total = 0
  for (let y = 0; y < map.height; y += 1) {
    // Exact solid angle of the row, up to the constant every cell shares: the
    // sine of the top edge minus the sine of the bottom edge.
    const sinBottom = Math.sin(Math.PI * (y / map.height - 0.5))
    const sinTop = Math.sin(Math.PI * ((y + 1) / map.height - 0.5))
    const rowSolidAngle = sinTop - sinBottom
    for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x
      total += decodeDensityByte(map.density[index]!) * rowSolidAngle
      cumulative[index] = total
    }
  }
  if (!(total > 0)) throw new Error('Band density map is empty; every cell is zero')
  for (let index = 0; index < cumulative.length; index += 1) cumulative[index] = cumulative[index]! / total
  return cumulative
}

/** Index of the first cell whose cumulative weight exceeds `target`. */
function findCell(cumulative: Float64Array, target: number): number {
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (cumulative[middle]! > target) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * Inverse CDF of a star-count distribution with `pdf` proportional to
 * `10^(slope * magnitude)` over the configured magnitude range.
 */
export function magnitudeFromUniform(uniform: number, options: BandFieldOptions = DEFAULT_BAND_FIELD_OPTIONS): number {
  const brightFlux = Math.pow(10, options.countSlope * options.brightestMagnitude)
  const faintFlux = Math.pow(10, options.countSlope * options.limitingMagnitude)
  return Math.log10(brightFlux + uniform * (faintFlux - brightFlux)) / options.countSlope
}

/**
 * Generate the band's points.
 *
 * Returns the shape `starBinary.ts` decodes to, so `StarFieldView` draws this
 * population through exactly the same path as the catalogue rather than gaining
 * a second one.
 */
export function generateBandField(map: BandDensityMap, options: BandFieldOptions = DEFAULT_BAND_FIELD_OPTIONS): StarPointSource {
  if (!Number.isInteger(options.starCount) || options.starCount < 0) throw new Error('starCount must be a non-negative integer')
  if (!(options.limitingMagnitude > options.brightestMagnitude)) throw new Error('limitingMagnitude must be fainter than brightestMagnitude')
  const cumulative = buildCumulativeWeights(map)
  const random = createRandom(options.seed)
  const starCount = options.starCount
  const directionEci = new Float32Array(starCount * 3)
  const visualMagnitude = new Float32Array(starCount)
  const colorIndexBv = new Float32Array(starCount)
  const colorSpread = BAND_COLOR_INDEX_MAX - BAND_COLOR_INDEX_MIN
  for (let index = 0; index < starCount; index += 1) {
    const cell = findCell(cumulative, random())
    const x = cell % map.width
    const y = (cell - x) / map.width
    // Uniform within the cell: uniform in right ascension, and uniform in the
    // sine of declination, which is the equal-area coordinate. Sampling
    // declination linearly instead would bunch points toward whichever edge of
    // the cell is nearer a pole.
    const rightAscensionRad = (2 * Math.PI * (x + random())) / map.width
    const sinBottom = Math.sin(Math.PI * (y / map.height - 0.5))
    const sinTop = Math.sin(Math.PI * ((y + 1) / map.height - 0.5))
    const sinDeclination = sinBottom + random() * (sinTop - sinBottom)
    const declinationRad = Math.asin(Math.min(1, Math.max(-1, sinDeclination)))
    const direction = equatorialToDirectionEci({ rightAscensionRad, declinationRad })
    directionEci[index * 3] = direction.x
    directionEci[index * 3 + 1] = direction.y
    directionEci[index * 3 + 2] = direction.z
    visualMagnitude[index] = magnitudeFromUniform(random(), options)
    // Three uniforms summed: a rough bell rather than a flat spread, so the
    // population has a mode instead of equal numbers of blue and red points.
    colorIndexBv[index] = BAND_COLOR_INDEX_MIN + colorSpread * ((random() + random() + random()) / 3)
  }
  return { starCount, directionEci, visualMagnitude, colorIndexBv }
}
