/**
 * The `OETSTAR1` container: a compact little-endian binary that decodes
 * straight into typed arrays with no per-star parsing at runtime.
 *
 * ```text
 * offset  type         contents
 * 0       char[8]      "OETSTAR1"
 * 8       uint32       formatVersion = 1
 * 12      uint32       starCount
 * 16      float32      limitingMagnitude
 * 20      uint32       reserved (0)
 * 24      float32[3n]  directionEci, unit vectors, x y z per star
 * ...     float32[n]   visualMagnitude
 * ...     float32[n]   colorIndexBv, NaN where the catalogue had none
 * ```
 *
 * The file stores astrometry, not appearance. Direction, magnitude and colour
 * index are catalogue facts; the mapping from those to pixel size, brightness
 * and RGB lives in `photometry.ts`, where it is unit-testable and tunable
 * without re-baking.
 *
 * This module is shared by the bake script and the runtime loader so the format
 * is defined once rather than by a writer and a reader drifting apart.
 */

export const STAR_BINARY_MAGIC = 'OETSTAR1'
export const STAR_BINARY_FORMAT_VERSION = 1
export const STAR_BINARY_HEADER_BYTES = 24
/** Three direction components, one magnitude and one colour index, as float32. */
export const STAR_BINARY_BYTES_PER_STAR = 20

/**
 * What a renderer needs to draw a population of stars: where they are, how
 * bright they are and what colour they are.
 *
 * Split out from `StarCatalogueData` because the generated Milky Way band in
 * `bandField.ts` supplies the same three arrays without coming from a file, and
 * `StarFieldView` should draw either without caring which it was given. The
 * file-level fields below stay on the decoded type, where they mean something.
 */
export interface StarPointSource {
  starCount: number
  /** Unit vectors in the ECI convention, 3 components per star. */
  directionEci: Float32Array
  visualMagnitude: Float32Array
  colorIndexBv: Float32Array
}

export interface StarCatalogueData extends StarPointSource {
  formatVersion: number
  limitingMagnitude: number
}

export interface StarCatalogueInput {
  limitingMagnitude: number
  directionEci: ArrayLike<number>
  visualMagnitude: ArrayLike<number>
  colorIndexBv: ArrayLike<number>
}

const MAGIC_BYTES = Uint8Array.from(STAR_BINARY_MAGIC, (character) => character.charCodeAt(0))

/**
 * Typed-array views follow platform endianness, so they are only usable
 * directly on the little-endian platforms every browser this targets runs on.
 * The check costs nothing and keeps a big-endian host from reading garbage.
 */
const PLATFORM_IS_LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

export function encodeStarBinary(input: StarCatalogueInput): ArrayBuffer {
  const starCount = input.visualMagnitude.length
  if (input.colorIndexBv.length !== starCount) throw new Error('colorIndexBv length does not match visualMagnitude length')
  if (input.directionEci.length !== starCount * 3) throw new Error('directionEci length must be three times the star count')
  const buffer = new ArrayBuffer(STAR_BINARY_HEADER_BYTES + starCount * STAR_BINARY_BYTES_PER_STAR)
  const bytes = new Uint8Array(buffer)
  bytes.set(MAGIC_BYTES, 0)
  const view = new DataView(buffer)
  view.setUint32(8, STAR_BINARY_FORMAT_VERSION, true)
  view.setUint32(12, starCount, true)
  view.setFloat32(16, input.limitingMagnitude, true)
  view.setUint32(20, 0, true)
  let offset = STAR_BINARY_HEADER_BYTES
  offset = writeFloat32Section(view, offset, input.directionEci)
  offset = writeFloat32Section(view, offset, input.visualMagnitude)
  writeFloat32Section(view, offset, input.colorIndexBv)
  return buffer
}

function writeFloat32Section(view: DataView, offset: number, values: ArrayLike<number>): number {
  for (let index = 0; index < values.length; index += 1) view.setFloat32(offset + index * 4, values[index]!, true)
  return offset + values.length * 4
}

export function decodeStarBinary(buffer: ArrayBuffer): StarCatalogueData {
  if (!PLATFORM_IS_LITTLE_ENDIAN) throw new Error('Star catalogue decoding requires a little-endian platform')
  if (buffer.byteLength < STAR_BINARY_HEADER_BYTES) throw new Error('Star catalogue is shorter than its header')
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < MAGIC_BYTES.length; index += 1) {
    if (bytes[index] !== MAGIC_BYTES[index]) throw new Error('Star catalogue has an unexpected magic string')
  }
  const view = new DataView(buffer)
  const formatVersion = view.getUint32(8, true)
  if (formatVersion !== STAR_BINARY_FORMAT_VERSION) throw new Error(`Star catalogue format version ${formatVersion} is not supported`)
  const starCount = view.getUint32(12, true)
  const limitingMagnitude = view.getFloat32(16, true)
  const expectedBytes = STAR_BINARY_HEADER_BYTES + starCount * STAR_BINARY_BYTES_PER_STAR
  if (buffer.byteLength !== expectedBytes) throw new Error(`Star catalogue is ${buffer.byteLength} bytes; ${starCount} stars require ${expectedBytes}`)
  const directionOffset = STAR_BINARY_HEADER_BYTES
  const magnitudeOffset = directionOffset + starCount * 12
  const colorOffset = magnitudeOffset + starCount * 4
  return {
    formatVersion,
    starCount,
    limitingMagnitude,
    directionEci: new Float32Array(buffer, directionOffset, starCount * 3),
    visualMagnitude: new Float32Array(buffer, magnitudeOffset, starCount),
    colorIndexBv: new Float32Array(buffer, colorOffset, starCount),
  }
}
