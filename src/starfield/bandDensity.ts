/**
 * The `OETBAND1` container: a small equirectangular map of relative sky
 * surface brightness, used as the probability density the Milky Way band's
 * points are drawn from.
 *
 * ```text
 * offset  type          contents
 * 0       char[8]       "OETBAND1"
 * 8       uint32        formatVersion = 1
 * 12      uint32        width
 * 16      uint32        height
 * 20      uint32        reserved (0)
 * 24      uint8[w*h]    density, row-major
 * ```
 *
 * ## What a cell means
 *
 * The map is equirectangular in J2000 equatorial coordinates, the same frame
 * `celestial.ts` works in, and it is sampled directly rather than through a GPU
 * texture, so its conventions are fixed here rather than by three.js:
 *
 * - Column `x` spans right ascension `2*PI * x / width` to `2*PI * (x+1)/width`.
 * - Row `y` spans declination `PI * (y / height - 0.5)` to
 *   `PI * ((y+1) / height - 0.5)`, so **row 0 is the south celestial pole**.
 *
 * Right ascension increases with the column, which is the plain reading and the
 * opposite of the convention sky textures are stored in - three.js's
 * `equirectUv()` wants right ascension decreasing from 180 degrees at `u = 0`,
 * because a celestial sphere is viewed from the inside. `build-band-density.ts`
 * measures the source's convention and folds that difference away, so nothing
 * downstream of this file has to know about it.
 *
 * ## Why 8 bits, and why gamma
 *
 * The stored byte is `(linear / maximum) ^ (1 / BAND_DENSITY_ENCODE_GAMMA)`.
 * The value is a weight in a cumulative distribution, not a colour: a percent
 * of error in a cell moves a handful of points within that cell and is
 * invisible. The gamma encode spends the codes where the sky is faint, which is
 * most of it, and keeps the quantisation step proportional rather than
 * absolute.
 *
 * This module is shared by `scripts/build-band-density.ts` and the runtime, so
 * the writer and the reader cannot drift apart.
 */

export const BAND_DENSITY_MAGIC = 'OETBAND1'
export const BAND_DENSITY_FORMAT_VERSION = 1
export const BAND_DENSITY_HEADER_BYTES = 24

/** Exponent of the stored-to-linear decode. See the note above. */
export const BAND_DENSITY_ENCODE_GAMMA = 2.2

export interface BandDensityMap {
  formatVersion: number
  width: number
  height: number
  /** Row-major, `width * height` bytes, row 0 at declination -90. */
  density: Uint8Array
}

export interface BandDensityInput {
  width: number
  height: number
  density: ArrayLike<number>
}

const MAGIC_BYTES = Uint8Array.from(BAND_DENSITY_MAGIC, (character) => character.charCodeAt(0))

/** Relative linear surface brightness in [0, 1] from a stored byte. */
export function decodeDensityByte(byte: number): number {
  return Math.pow(byte / 255, BAND_DENSITY_ENCODE_GAMMA)
}

/** Stored byte from a relative linear surface brightness in [0, 1]. */
export function encodeDensityValue(relativeLinear: number): number {
  const clamped = Math.min(1, Math.max(0, relativeLinear))
  return Math.min(255, Math.max(0, Math.round(Math.pow(clamped, 1 / BAND_DENSITY_ENCODE_GAMMA) * 255)))
}

export function encodeBandDensity(input: BandDensityInput): ArrayBuffer {
  const cellCount = input.width * input.height
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1) {
    throw new Error('Band density dimensions must be positive integers')
  }
  if (input.density.length !== cellCount) {
    throw new Error(`Band density has ${input.density.length} cells; ${input.width}x${input.height} requires ${cellCount}`)
  }
  const buffer = new ArrayBuffer(BAND_DENSITY_HEADER_BYTES + cellCount)
  const bytes = new Uint8Array(buffer)
  bytes.set(MAGIC_BYTES, 0)
  const view = new DataView(buffer)
  view.setUint32(8, BAND_DENSITY_FORMAT_VERSION, true)
  view.setUint32(12, input.width, true)
  view.setUint32(16, input.height, true)
  view.setUint32(20, 0, true)
  for (let index = 0; index < cellCount; index += 1) bytes[BAND_DENSITY_HEADER_BYTES + index] = input.density[index]! & 0xff
  return buffer
}

export function decodeBandDensity(buffer: ArrayBuffer): BandDensityMap {
  if (buffer.byteLength < BAND_DENSITY_HEADER_BYTES) throw new Error('Band density map is shorter than its header')
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < MAGIC_BYTES.length; index += 1) {
    if (bytes[index] !== MAGIC_BYTES[index]) throw new Error('Band density map has an unexpected magic string')
  }
  const view = new DataView(buffer)
  const formatVersion = view.getUint32(8, true)
  if (formatVersion !== BAND_DENSITY_FORMAT_VERSION) throw new Error(`Band density map format version ${formatVersion} is not supported`)
  const width = view.getUint32(12, true)
  const height = view.getUint32(16, true)
  const expectedBytes = BAND_DENSITY_HEADER_BYTES + width * height
  if (buffer.byteLength !== expectedBytes) throw new Error(`Band density map is ${buffer.byteLength} bytes; ${width}x${height} requires ${expectedBytes}`)
  return {
    formatVersion,
    width,
    height,
    density: new Uint8Array(buffer, BAND_DENSITY_HEADER_BYTES, width * height),
  }
}
