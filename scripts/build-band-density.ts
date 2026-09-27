/**
 * Bake the NASA Deep Star Maps 2020 starless Milky Way map into the `OETBAND1`
 * density map the runtime samples the Milky Way band's points from.
 *
 * Usage:
 *   node scripts/build-band-density.ts [--input <exr>] [--output <bin>]
 *                                      [--width <px>]
 *
 * ## What this replaces
 *
 * `build-nebulosity.ts` baked the same source into a 2K KTX2 applied as
 * `scene.background`. That layer was retired on 2026-09-07: a raster sky is
 * four to eight times coarser than the screen at the tool's field of view, so
 * it read as blur behind sharp catalogue points, and the resolution that would
 * fix it costs a gigabyte of cube render target. `bandField.ts` records the
 * full reasoning. The same source image is still the right *data* - it is the
 * complement of the HYG catalogue, with the bright Hipparcos and Tycho stars
 * omitted - so it is kept here as a probability density rather than as pixels.
 *
 * ## Input
 *
 * `milkyway_2020_4k.exr` from https://svs.gsfc.nasa.gov/4851/.
 *
 * ## Dependencies
 *
 * Only `three`, which is already a dependency: `EXRLoader` parses the input and
 * the output is a plain binary, so unlike the KTX2 bakes this one needs no
 * external `ktx` executable. It runs under Node's native type stripping, like
 * the other two bake scripts.
 *
 * ## Orientation
 *
 * The source is not stored the way `bandDensity.ts` defines the output, and the
 * difference is not a mirror alone. Measured over the whole image rather than
 * assumed:
 *
 *   source column x is right ascension  PI - 2*PI * (x + 0.5) / width
 *
 * so its column 0 is right ascension 180 degrees and right ascension *decreases*
 * to the right, crossing zero at the centre column. That is the convention a
 * celestial sphere viewed from the inside needs, and it is what three.js's
 * `equirectUv()` expects: at r185 that function is
 * `u = atan(dir.z, dir.x) / 2PI + 0.5`, which for this project's frames works
 * out to `u = 0.5 - rightAscension / 2PI`. The two derivations agree, so the
 * retired KTX2 background was sampled correctly.
 *
 * Rows need no such correction: `EXRLoader` returns them bottom-up, so source
 * row 0 is the south celestial pole, which is what the output wants too.
 *
 * `normaliseOrientation()` folds the horizontal convention away, leaving the
 * runtime with the plain rule `bandDensity.ts` documents, and `verify()` then
 * measures the *output* - the exact array the runtime will sample - rather than
 * the source. The script fails rather than writing a mirrored sky.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { encodeBandDensity, encodeDensityValue, BAND_DENSITY_HEADER_BYTES } from '../src/starfield/bandDensity.ts'
import { equatorialToDirectionEci } from '../src/starfield/celestial.ts'
import { degToRad, radToDeg } from '../src/core/angles.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  input: 'assets-source/originals/milkyway_2020_4k.exr',
  output: 'public/assets/starfield/band-density.bin',
  width: 512,
}

/**
 * 512x256 is 0.7 degrees per cell.
 *
 * The output is a probability density, not an image, so the resolution that
 * matters is the one at which the points themselves sample it. At the default
 * 220,000 points the band region receives roughly a dozen points per cell,
 * which is already fine enough that the point noise, not the cell grid, is what
 * limits the visible structure. Finer cells would cost bytes and show nothing.
 */

/** North galactic pole, J2000, from the IAU 1958 definition. */
const NORTH_GALACTIC_POLE = { rightAscensionRad: degToRad(192.85948), declinationRad: degToRad(27.12825) }

/** Galactic centre, J2000. Sagittarius A*, which is what the bulge surrounds. */
const GALACTIC_CENTRE = { rightAscensionRad: degToRad(266.41683), declinationRad: degToRad(-29.00781) }

interface Options {
  input: string
  output: string
  width: number
}

function parseArguments(argv: string[]): Options {
  const options: Options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    if (flag === '--input') options.input = value
    else if (flag === '--output') options.output = value
    else if (flag === '--width') options.width = Number(value)
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isInteger(options.width) || options.width < 2) throw new Error('--width must be an integer of at least 2')
  return options
}

/** Rec. 709 luminance, which is the transfer the linear EXR data is already in. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

type CellDirection = (x: number, y: number, width: number, height: number) => { x: number; y: number; z: number }

/**
 * The output convention, which is the one `bandDensity.ts` documents and
 * `bandField.ts` samples: column 0 at right ascension 0 increasing eastward,
 * row 0 at declination -90.
 */
const readAsBaked: CellDirection = (x, y, width, height) => equatorialToDirectionEci({
  rightAscensionRad: (2 * Math.PI * (x + 0.5)) / width,
  declinationRad: Math.PI * ((y + 0.5) / height - 0.5),
})

/**
 * Rewrite the source's columns into the output convention.
 *
 * Solving `2*PI * (xOut + 0.5) / width = PI - 2*PI * (xSource + 0.5) / width`
 * for the source column gives `xSource = width / 2 - 1 - xOut`, modulo the
 * width. It is a mirror and a half-turn together; either one alone leaves the
 * sky 180 degrees out, which is the error the galactic centre cannot detect
 * because it sits four degrees from where the two conventions cross.
 */
function normaliseOrientation(source: Float64Array, width: number, height: number): Float64Array {
  const output = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceColumn = (((width / 2 - 1 - x) % width) + width) % width
      output[y * width + x] = source[y * width + sourceColumn]!
    }
  }
  return output
}

/** The same map read with right ascension running the other way. */
const readMirrored: CellDirection = (x, y, width, height) => readAsBaked(width - 1 - x, y, width, height)

/** The same map read with declination flipped. */
const readFlipped: CellDirection = (x, y, width, height) => readAsBaked(x, height - 1 - y, width, height)

function angleBetweenDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))
  // The pole of a plane has no sign, so an anti-parallel fit is the same fit.
  return radToDeg(Math.acos(Math.abs(dot)))
}

/**
 * Eigenvectors of a symmetric 3x3 matrix by cyclic Jacobi rotation.
 *
 * Returns eigenvalues with their eigenvectors as columns of `vectors`. Three
 * dimensions and a handful of sweeps, so the simplest correct method is also
 * fast enough to be invisible next to reading a 36 MB EXR.
 */
function symmetricEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const a = input.map((row) => [...row])
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let offDiagonal = 0
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) offDiagonal += a[p]![q]! * a[p]![q]!
    if (offDiagonal < 1e-24) break
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p]![q]!) < 1e-30) continue
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k]![p]!
          const akq = a[k]![q]!
          a[k]![p] = c * akp - s * akq
          a[k]![q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p]![k]!
          const aqk = a[q]![k]!
          a[p]![k] = c * apk - s * aqk
          a[q]![k] = s * apk + c * aqk
          const vkp = v[k]![p]!
          const vkq = v[k]![q]!
          v[k]![p] = c * vkp - s * vkq
          v[k]![q] = s * vkp + c * vkq
        }
      }
    }
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: v }
}

/**
 * Fit the plane of the band and return its pole: the eigenvector of the
 * luminance-weighted inertia tensor with the smallest eigenvalue, which is the
 * direction the light is least spread along.
 */
function fitBandPole(density: Float64Array, width: number, height: number, direction: CellDirection): { x: number; y: number; z: number } {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let y = 0; y < height; y += 1) {
    const solidAngle = Math.sin(Math.PI * ((y + 1) / height - 0.5)) - Math.sin(Math.PI * (y / height - 0.5))
    for (let x = 0; x < width; x += 1) {
      const weight = density[y * width + x]! * solidAngle
      if (weight <= 0) continue
      const d = direction(x, y, width, height)
      const components = [d.x, d.y, d.z]
      for (let i = 0; i < 3; i += 1) {
        const row = m[i]!
        for (let j = 0; j < 3; j += 1) row[j] = row[j]! + weight * components[i]! * components[j]!
      }
    }
  }
  const { values, vectors } = symmetricEigen(m)
  let smallest = 0
  for (let index = 1; index < 3; index += 1) if (values[index]! < values[smallest]!) smallest = index
  return { x: vectors[0]![smallest]!, y: vectors[1]![smallest]!, z: vectors[2]![smallest]! }
}

/**
 * Luminance-weighted centroid of the brightest cells, normalised back to a
 * direction. The bulge dominates the top percentile, so this lands on the
 * galactic centre.
 */
function brightestCentroid(density: Float64Array, width: number, height: number, topFraction: number): { x: number; y: number; z: number } {
  const sorted = Float64Array.from(density).sort()
  const threshold = sorted[Math.floor(sorted.length * (1 - topFraction))]!
  let x = 0
  let y = 0
  let z = 0
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const weight = density[row * width + column]!
      if (weight < threshold) continue
      const d = readAsBaked(column, row, width, height)
      x += weight * d.x
      y += weight * d.y
      z += weight * d.z
    }
  }
  const length = Math.hypot(x, y, z)
  if (length === 0) throw new Error('The brightest cells sum to a zero direction')
  return { x: x / length, y: y / length, z: z / length }
}

function toEquatorialDeg(direction: { x: number; y: number; z: number }): { rightAscensionDeg: number; declinationDeg: number } {
  const rightAscension = Math.atan2(direction.y, direction.x)
  return {
    rightAscensionDeg: (radToDeg(rightAscension) + 360) % 360,
    declinationDeg: radToDeg(Math.asin(Math.min(1, Math.max(-1, direction.z)))),
  }
}

/**
 * Confirm the map is the way round the runtime will read it.
 *
 * Two measurements, because neither is sufficient alone. The pole fit uses the
 * whole image and separates both axes at once. The centroid is the intuitive
 * check but cannot settle the horizontal convention by itself: the galactic
 * centre sits at right ascension 266 degrees, within four degrees of the 270
 * where the mirrored and unmirrored mappings coincide.
 */
function verify(density: Float64Array, width: number, height: number): void {
  const trueNorthPole = equatorialToDirectionEci(NORTH_GALACTIC_POLE)
  const asBaked = angleBetweenDeg(fitBandPole(density, width, height, readAsBaked), trueNorthPole)
  const mirrored = angleBetweenDeg(fitBandPole(density, width, height, readMirrored), trueNorthPole)
  const flipped = angleBetweenDeg(fitBandPole(density, width, height, readFlipped), trueNorthPole)
  const centre = brightestCentroid(density, width, height, 0.001)
  const centroid = toEquatorialDeg(centre)
  const trueCentre = toEquatorialDeg(equatorialToDirectionEci(GALACTIC_CENTRE))
  const centroidError = angleBetweenDeg(centre, equatorialToDirectionEci(GALACTIC_CENTRE))

  console.log(`Band pole error  ${asBaked.toFixed(1)} deg as written, ${mirrored.toFixed(1)} deg mirrored, ${flipped.toFixed(1)} deg flipped`)
  console.log(`Bulge centroid   RA ${centroid.rightAscensionDeg.toFixed(1)}, Dec ${centroid.declinationDeg.toFixed(1)} against RA ${trueCentre.rightAscensionDeg.toFixed(1)}, Dec ${trueCentre.declinationDeg.toFixed(1)} (${centroidError.toFixed(1)} deg)`)

  // The pole fit is the test of record: it uses the whole image and separates
  // the horizontal and vertical conventions at once. A scan over every
  // combination of right ascension offset, mirror and flip puts the minimum at
  // this reading, at 2.1 degrees, with the next candidate five degrees away and
  // every mirrored or flipped reading beyond 24. The threshold accepts the
  // fit's own bias - the band is not a symmetric great circle, and the bulge
  // and the Magellanic Clouds pull it - while rejecting both errors by a wide
  // margin.
  if (asBaked > 6) throw new Error(`Band plane is ${asBaked.toFixed(1)} degrees from the galactic plane; the source orientation is not what this script assumes`)
  if (mirrored <= asBaked || flipped <= asBaked) throw new Error('A mirrored or flipped reading fits at least as well; the orientation test is not discriminating')
  // The centroid is the secondary check. It measures 4.1 degrees here, but it
  // could not stand alone: the brightest cells spread along the inner plane
  // rather than clustering on the bulge, and the galactic centre sits within
  // four degrees of the right ascension where the mirrored and unmirrored
  // mappings coincide, so it agrees with both. It is here to catch a gross
  // error the pole fit could accept, such as a source that is not this map.
  if (centroidError > 8) throw new Error(`The brightest region is ${centroidError.toFixed(1)} degrees from the galactic centre`)
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const inputPath = resolve(projectRoot, options.input)
  const outputPath = resolve(projectRoot, options.output)

  const file = readFileSync(inputPath)
  const source = new EXRLoader().setDataType(THREE.FloatType)
    .parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) as
    { width: number; height: number; data: Float32Array }
  const { width: sourceWidth, height: sourceHeight, data } = source
  if (sourceWidth !== sourceHeight * 2) throw new Error(`Expected a 2:1 equirectangular map, got ${sourceWidth}x${sourceHeight}`)
  if (sourceWidth % options.width !== 0) throw new Error(`--width ${options.width} does not divide the source width ${sourceWidth}`)

  const width = options.width
  const height = width / 2
  const factor = sourceWidth / width
  // Averaged in linear light, which is the only place a box filter is correct,
  // and averaged as luminance because the output is a scalar weight. Source row
  // 0 is the south pole and output row 0 is too, so rows copy straight across;
  // columns do not, which is what `normaliseOrientation` is for.
  const sourceDensity = new Float64Array(width * height)
  let maximum = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let dy = 0; dy < factor; dy += 1) {
        const sourceRow = y * factor + dy
        for (let dx = 0; dx < factor; dx += 1) {
          const p = (sourceRow * sourceWidth + x * factor + dx) * 4
          sum += luminance(data[p]!, data[p + 1]!, data[p + 2]!)
        }
      }
      const mean = sum / (factor * factor)
      sourceDensity[y * width + x] = mean
      maximum = Math.max(maximum, mean)
    }
  }
  if (maximum <= 0) throw new Error('The source image has no light in it')
  const density = normaliseOrientation(sourceDensity, width, height)

  verify(density, width, height)

  const encoded = new Uint8Array(width * height)
  let quantisedToZero = 0
  for (let index = 0; index < density.length; index += 1) {
    encoded[index] = encodeDensityValue(density[index]! / maximum)
    if (encoded[index] === 0 && density[index]! > 0) quantisedToZero += 1
  }
  const buffer = encodeBandDensity({ width, height, density: encoded })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, new Uint8Array(buffer))

  const mean = density.reduce((sum, value) => sum + value, 0) / density.length
  console.log(`Input            ${inputPath}`)
  console.log(`Source size      ${sourceWidth}x${sourceHeight} linear EXR`)
  console.log(`Output           ${outputPath}`)
  console.log(`Map size         ${width}x${height}, ${BAND_DENSITY_HEADER_BYTES} byte header`)
  console.log(`Linear luminance mean ${mean.toExponential(3)}, max ${maximum.toExponential(3)} after ${factor}x box downsample`)
  console.log(`Quantised to 0   ${quantisedToZero} of ${density.length} cells (${((quantisedToZero / density.length) * 100).toFixed(2)}%)`)
  console.log(`File size        ${(buffer.byteLength / 1024).toFixed(1)} KiB`)
}

await main()
