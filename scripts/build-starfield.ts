/**
 * Bake a star catalogue CSV into the `OETSTAR1` binary the runtime loads.
 *
 * Usage:
 *   node scripts/build-starfield.ts [--input <csv>] [--output <bin>]
 *                                   [--limit-magnitude <number>]
 *
 * The raw catalogue is not committed; it lives under `assets-source/catalogs/`,
 * which is gitignored. The derived binary is committed, like the KTX2 textures
 * under `public/assets/`.
 *
 * This is TypeScript rather than a `.mjs` sibling so that `starBinary.ts`
 * defines the format once for both the writer here and the decoder at runtime,
 * instead of a hand-copied encoder drifting from the decoder it has to match.
 * It runs under Node's native type stripping (verified on Node 24).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { equatorialToDirectionEci, rightAscensionHoursToRad } from '../src/starfield/celestial.ts'
import { encodeStarBinary } from '../src/starfield/starBinary.ts'
import { degToRad } from '../src/core/angles.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  input: 'assets-source/catalogs/hygdata_v41.csv',
  output: 'public/assets/starfield/stars.bin',
  limitMagnitude: 7.0,
}

interface CatalogueRow {
  rightAscensionRad: number
  declinationRad: number
  visualMagnitude: number
  colorIndexBv: number
}

function parseArguments(argv: string[]): typeof DEFAULTS {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    if (flag === '--input') options.input = value
    else if (flag === '--output') options.output = value
    else if (flag === '--limit-magnitude') options.limitMagnitude = Number(value)
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isFinite(options.limitMagnitude)) throw new Error('--limit-magnitude must be a number')
  return options
}

/**
 * Split one CSV line, honouring double-quoted fields. HYG quotes a handful of
 * name fields that can contain commas, so a naive split would misalign those
 * rows.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (inQuotes) {
      if (character !== '"') current += character
      else if (line[index + 1] === '"') { current += '"'; index += 1 }
      else inQuotes = false
    } else if (character === '"') inQuotes = true
    else if (character === ',') { fields.push(current); current = '' }
    else current += character
  }
  fields.push(current)
  return fields
}

/**
 * Parse the HYG database CSV. Right ascension is published in hours and
 * declination in degrees; `mag` is visual magnitude and `ci` the B-V colour
 * index, blank where the catalogue has none.
 *
 * The Sun is row `id` 0 in HYG, at distance 0 and magnitude -26.7. It is a
 * catalogue entry rather than a background star and has to be dropped, or it
 * bakes to a single overwhelming point at the vernal equinox.
 */
function parseHygCsv(text: string): { rows: CatalogueRow[]; skippedSun: number; skippedInvalid: number } {
  const lines = text.split(/\r?\n/)
  const header = splitCsvLine(lines[0] ?? '')
  const columnOf = (name: string): number => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`Catalogue is missing the "${name}" column; is this the HYG CSV?`)
    return index
  }
  const idColumn = columnOf('id')
  const raColumn = columnOf('ra')
  const decColumn = columnOf('dec')
  const magColumn = columnOf('mag')
  const ciColumn = columnOf('ci')
  const rows: CatalogueRow[] = []
  let skippedSun = 0
  let skippedInvalid = 0
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    const fields = splitCsvLine(line)
    if (fields[idColumn] === '0') { skippedSun += 1; continue }
    const rightAscensionHours = Number(fields[raColumn])
    const declinationDeg = Number(fields[decColumn])
    const visualMagnitude = Number(fields[magColumn])
    if (!Number.isFinite(rightAscensionHours) || !Number.isFinite(declinationDeg) || !Number.isFinite(visualMagnitude)) {
      skippedInvalid += 1
      continue
    }
    const rawColorIndex = (fields[ciColumn] ?? '').trim()
    rows.push({
      rightAscensionRad: rightAscensionHoursToRad(rightAscensionHours),
      declinationRad: degToRad(declinationDeg),
      visualMagnitude,
      colorIndexBv: rawColorIndex === '' ? Number.NaN : Number(rawColorIndex),
    })
  }
  return { rows, skippedSun, skippedInvalid }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const inputPath = resolve(projectRoot, options.input)
  const outputPath = resolve(projectRoot, options.output)
  const text = await readFile(inputPath, 'utf8')
  const { rows, skippedSun, skippedInvalid } = parseHygCsv(text)

  const retained = rows
    .filter((row) => row.visualMagnitude <= options.limitMagnitude)
    // Brightest first. Nothing at runtime depends on the order, but it makes a
    // truncated read during development degrade to a shallower sky rather than
    // an arbitrary patch of one.
    .sort((a, b) => a.visualMagnitude - b.visualMagnitude)

  const directionEci = new Float32Array(retained.length * 3)
  const visualMagnitude = new Float32Array(retained.length)
  const colorIndexBv = new Float32Array(retained.length)
  let missingColorIndex = 0
  let worstUnitLengthError = 0
  for (let index = 0; index < retained.length; index += 1) {
    const row = retained[index]!
    const direction = equatorialToDirectionEci(row)
    directionEci[index * 3] = direction.x
    directionEci[index * 3 + 1] = direction.y
    directionEci[index * 3 + 2] = direction.z
    const length = Math.hypot(direction.x, direction.y, direction.z)
    worstUnitLengthError = Math.max(worstUnitLengthError, Math.abs(length - 1))
    visualMagnitude[index] = row.visualMagnitude
    const colorIndex = Number.isFinite(row.colorIndexBv) ? row.colorIndexBv : Number.NaN
    if (!Number.isFinite(colorIndex)) missingColorIndex += 1
    colorIndexBv[index] = colorIndex
  }
  if (worstUnitLengthError > 1e-6) throw new Error(`Direction vectors are not unit length; worst error ${worstUnitLengthError}`)

  const buffer = encodeStarBinary({ limitingMagnitude: options.limitMagnitude, directionEci, visualMagnitude, colorIndexBv })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, new Uint8Array(buffer))

  const brightest = retained[0]?.visualMagnitude ?? Number.NaN
  const faintest = retained[retained.length - 1]?.visualMagnitude ?? Number.NaN
  console.log(`Input            ${inputPath}`)
  console.log(`Output           ${outputPath}`)
  console.log(`Catalogue rows   ${rows.length} (skipped: Sun ${skippedSun}, unparsable ${skippedInvalid})`)
  console.log(`Limit magnitude  ${options.limitMagnitude}`)
  console.log(`Stars written    ${retained.length}`)
  console.log(`Magnitude range  ${brightest.toFixed(2)} to ${faintest.toFixed(2)}`)
  console.log(`Missing B-V      ${missingColorIndex} (${((missingColorIndex / Math.max(1, retained.length)) * 100).toFixed(2)}%)`)
  console.log(`File size        ${(buffer.byteLength / 1024).toFixed(1)} KiB`)
}

await main()
