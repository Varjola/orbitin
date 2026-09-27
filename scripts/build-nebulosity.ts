/**
 * Bake the NASA Deep Star Maps 2020 starless Milky Way map into a KTX2
 * equirectangular background.
 *
 * **Its output is no longer shipped.** The nebulosity background was retired on
 * 2026-09-07: a 2K raster sky resolves 0.176 degrees per pixel against roughly
 * 0.02 on the screen, so it read as blur behind the sharp catalogue points, and
 * the resolution that would fix it costs a gigabyte of cube render target.
 * `src/starfield/bandField.ts` carries the full reasoning, and
 * `scripts/build-band-density.ts` bakes what replaced it, from the same source
 * image.
 *
 * This script is kept for two reasons: it regenerates the texture if that
 * decision is ever revisited, and its `KTX_ENCODE_ARGUMENTS` are the only
 * written record of how the Earth textures under `public/assets/textures/` were
 * encoded - they were recovered from `stars-4k.ktx2`'s own metadata, and the
 * bakes themselves were manual and undocumented.
 *
 * Usage:
 *   node scripts/build-nebulosity.ts [--input <exr>] [--output <ktx2>]
 *                                    [--width <px>] [--ktx <ktx executable>]
 *
 * ## Why this script exists
 *
 * Every other derived texture under `public/assets/textures/` was converted by
 * hand before production started, and the commands were never written down, so
 * none of them is reproducible. The nebulosity bake must
 * not repeat that: the commands live here, in the repository,
 * rather than in a shell history. `assets-source/` cannot serve that purpose
 * because the whole tree is gitignored.
 *
 * The `ktx create` parameters below were recovered from `stars-4k.ktx2`'s own
 * `KTXwriterScParams` metadata, so the nebulosity map is encoded the way the
 * Earth maps were.
 *
 * ## Input
 *
 * `milkyway_2020_4k.exr` from https://svs.gsfc.nasa.gov/4851/ - the variant the
 * SVS describes as "a version of the star map that omits the bright (Hipparcos
 * and Tycho) stars". That matters: HYG is Hipparcos-derived, so the starless
 * map is the complement of the catalogue points rather than a duplicate of
 * them. Baking `Starmap_2020_16k.png` instead would draw every bright star
 * twice, once as a catalogue point and once as a painted blob, which is the
 * double-draw that would otherwise have to be blurred away.
 *
 * ## Dependencies
 *
 * Only `three`, which is already a dependency, and the KTX-Software `ktx`
 * executable. three's `EXRLoader` parses the input and `node:zlib` writes the
 * intermediate PNG, so the bake needs no Python, ImageMagick or OpenEXR
 * install. It runs under Node's native type stripping, like
 * `build-starfield.ts`.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  input: 'assets-source/originals/milkyway_2020_4k.exr',
  intermediate: 'assets-source/resamples/nebulosity.png',
  output: 'public/assets/textures/nebulosity-2k.ktx2',
  width: 2048,
  ktx: 'ktx',
}

/**
 * Recovered from `stars-4k.ktx2`: `ktx create v4.4.2 / libktx v4.4.2` with
 * `--uastc-quality 2 --zstd 18`, UASTC, sRGB transfer, BT709 primaries and a
 * full mip chain.
 *
 * UASTC rather than `basis-lz`: the content is a smooth, dark, low-contrast
 * gradient, which is precisely what ETC1S bands worst on. The extra bytes buy
 * a band that does not step.
 *
 * `--convert-texcoord-origin bottom-left` is the vertical flip, and it is the
 * only place the flip is applied. See the orientation note in `main()`.
 */
const KTX_ENCODE_ARGUMENTS = [
  '--format', 'R8G8B8_SRGB',
  '--encode', 'uastc',
  '--uastc-quality', '2',
  '--zstd', '18',
  '--generate-mipmap',
  '--assign-tf', 'srgb',
  '--convert-texcoord-origin', 'bottom-left',
]

function parseArguments(argv: string[]): typeof DEFAULTS {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    if (flag === '--input') options.input = value
    else if (flag === '--output') options.output = value
    else if (flag === '--intermediate') options.intermediate = value
    else if (flag === '--width') options.width = Number(value)
    else if (flag === '--ktx') options.ktx = value
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isInteger(options.width) || options.width < 1) throw new Error('--width must be a positive integer')
  return options
}

/** IEC 61966-2-1 linear to sRGB. */
function linearToSrgb(value: number): number {
  if (value <= 0.0031308) return value * 12.92
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

/**
 * Deterministic value noise in [0, 1). The bake has to be reproducible, so the
 * dither cannot come from `Math.random()`.
 */
function hashNoise(index: number): number {
  let hash = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) c = CRC_TABLE[(c ^ bytes[index]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  for (let index = 0; index < 4; index += 1) chunk[4 + index] = type.charCodeAt(index)
  chunk.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)))
  return chunk
}

/**
 * Minimal 8-bit RGB PNG writer. Filter type 0 on every row: the intermediate is
 * a gitignored scratch file that `ktx create` immediately re-encodes, so a
 * smarter filter would only save disk that nothing keeps.
 */
function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type 2 = truecolour RGB
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    pngChunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { png.set(part, offset); offset += part.length }
  return png
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const inputPath = resolve(projectRoot, options.input)
  const intermediatePath = resolve(projectRoot, options.intermediate)
  const outputPath = resolve(projectRoot, options.output)

  const file = readFileSync(inputPath)
  const source = new EXRLoader().setDataType(THREE.FloatType)
    .parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) as
    { width: number; height: number; data: Float32Array }
  const { width: sourceWidth, height: sourceHeight, data } = source
  if (sourceWidth !== sourceHeight * 2) throw new Error(`Expected a 2:1 equirectangular map, got ${sourceWidth}x${sourceHeight}`)
  if (sourceWidth % options.width !== 0) throw new Error(`--width ${options.width} does not divide the source width ${sourceWidth}`)

  /**
   * Orientation, measured rather than assumed.
   *
   * `EXRLoader` returns rows bottom-up, so `data` row 0 is the south celestial
   * pole - which is already what GL wants. three.js samples an equirectangular
   * background through `equirectUv()` as `v = asin(dir.y) / PI + 0.5`, and
   * `eciToRender` puts declination on render `+Y`, so v = 0 is declination -90.
   *
   * Two independent measurements against the source pixels:
   *
   * - The brightest region's centroid lands at declination -29.9 reading row 0
   *   as south, against -29.0 for the true galactic centre. Reading row 0 as
   *   north would put it at +29.9.
   * - Fitting the plane of the band - the luminance-weighted inertia tensor's
   *   smallest eigenvector - puts its pole 2.1 degrees from the true north
   *   galactic pole at RA 192.86, Dec +27.13. Mirroring horizontally moves it
   *   to 24.6 degrees; flipping vertically, to 127.1 degrees. The residual 2.1
   *   degrees is the fit's own bias, since the band is not a symmetric great
   *   circle - the bulge and the Magellanic Clouds pull it - not a
   *   misalignment.
   *
   * The galactic centre alone cannot settle the horizontal convention: it sits
   * at RA 266 degrees, within four degrees of the RA 270 where the mirrored and
   * unmirrored mappings coincide. The pole fit is the test of record.
   *
   * So: no mirror, and `backgroundRotation` stays at its default. The PNG below
   * is written north-up, in ordinary viewing order so that it can be eyeballed,
   * and `--convert-texcoord-origin bottom-left` performs the single flip that
   * puts `data` row 0 back at v = 0.
   */
  const width = options.width
  const height = width / 2
  const factor = sourceWidth / width
  const rgb = new Uint8Array(width * height * 3)
  let minLinear = Infinity
  let maxLinear = -Infinity
  for (let y = 0; y < height; y += 1) {
    // PNG row 0 is the top of the image and `data` row 0 is the south pole, so
    // the source rows are consumed in reverse to write a north-up PNG.
    const sourceRowBase = sourceHeight - (y + 1) * factor
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          // Averaged in linear light, which is the only place a box filter is
          // correct; averaging sRGB code values would darken the band.
          const p = ((sourceRowBase + dy) * sourceWidth + x * factor + dx) * 4
          r += data[p]!
          g += data[p + 1]!
          b += data[p + 2]!
        }
      }
      const samples = factor * factor
      r /= samples
      g /= samples
      b /= samples
      minLinear = Math.min(minLinear, r, g, b)
      maxLinear = Math.max(maxLinear, r, g, b)
      const out = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        const linear = channel === 0 ? r : channel === 1 ? g : b
        // Triangular dither of plus or minus half a code value. The map is dark
        // and very smooth, so without it 8-bit quantisation shows as contour
        // rings through the diffuse regions once `backgroundIntensity` lifts
        // them.
        const dither = hashNoise(out + channel) - hashNoise(((out + channel) * 2654435761) >>> 0)
        const encoded = linearToSrgb(Math.min(1, Math.max(0, linear))) * 255 + dither * 0.5
        rgb[out + channel] = Math.min(255, Math.max(0, Math.round(encoded)))
      }
    }
  }

  await mkdir(dirname(intermediatePath), { recursive: true })
  await writeFile(intermediatePath, encodePng(rgb, width, height))
  await mkdir(dirname(outputPath), { recursive: true })

  const ktxArguments = [...KTX_ENCODE_ARGUMENTS, intermediatePath, outputPath]
  console.log(`Input            ${inputPath}`)
  console.log(`Source size      ${sourceWidth}x${sourceHeight} linear EXR`)
  console.log(`Linear range     ${minLinear.toExponential(3)} to ${maxLinear.toExponential(3)} after ${factor}x box downsample`)
  console.log(`Intermediate     ${intermediatePath} (${width}x${height}, north-up sRGB)`)
  console.log(`Encode command   ${options.ktx} create ${ktxArguments.join(' ')}`)
  execFileSync(options.ktx, ['create', ...ktxArguments], { stdio: 'inherit' })
  console.log(`Output           ${outputPath}`)
  console.log(`File size        ${(readFileSync(outputPath).byteLength / 1024).toFixed(1)} KiB`)
}

await main()
