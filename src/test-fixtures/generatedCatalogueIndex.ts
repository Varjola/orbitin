import { CATALOGUE_ENRICHMENT_RULES_VERSION } from '../data/catalogueEnrichment.ts'
import { catalogueProfileFor, type CatalogueProfileV1 } from '../data/catalogueProfile.ts'
import { normalizeSearchText, type CatalogueSearchEntryV1, type CatalogueSearchIndexV1 } from '../data/catalogueSchema.ts'

/**
 * A deterministic, synthetic automatic-profile index for catalogue scale
 * tests and measurements. It deliberately contains no production catalogue
 * data and does not construct record shards.
 */
export const GENERATED_CATALOGUE_ENTRY_COUNT = 40_000
export const GENERATED_CATALOGUE_SHARD_COUNT = 64
export const GENERATED_CATALOGUE_SNAPSHOT_ID = '20260920T120000Z-022000000000'
export const GENERATED_CATALOGUE_PROFILE: CatalogueProfileV1 = catalogueProfileFor('fixture-generated/1', CATALOGUE_ENRICHMENT_RULES_VERSION)

const TYPES = [
  { text: 'PAYLOAD', code: 'pay' },
  { text: 'ROCKET BODY', code: 'rb' },
  { text: 'DEBRIS', code: 'deb' },
  { text: 'UNKNOWN', code: 'unk' },
] as const

const CLASSES = ['leo', 'meo', 'high', 'geo', 'ellip', 'cross'] as const
const COUNTRIES = ['US', 'PRC', 'ESA', 'ISS'] as const

export interface GeneratedCatalogueIndexOptions {
  readonly count?: number
  readonly shardCount?: number
}

/** Build a reproducible automatic-profile index with canonical ids. */
export function generateCatalogueIndex(options: GeneratedCatalogueIndexOptions = {}): CatalogueSearchIndexV1 {
  const count = options.count ?? GENERATED_CATALOGUE_ENTRY_COUNT
  const shardCount = options.shardCount ?? GENERATED_CATALOGUE_SHARD_COUNT
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error('Generated catalogue count must be an integer from 1 to 100000.')
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 256) throw new Error('Generated catalogue shard count must be an integer from 1 to 256.')

  const entries: CatalogueSearchEntryV1[] = []
  for (let index = 0; index < count; index += 1) entries.push(generateEntry(index, shardCount))
  return {
    schemaVersion: 1,
    snapshotId: GENERATED_CATALOGUE_SNAPSHOT_ID,
    catalogueProfile: GENERATED_CATALOGUE_PROFILE,
    entries,
  }
}

function generateEntry(index: number, shardCount: number): CatalogueSearchEntryV1 {
  const catalogId = String(100_000 + index)
  const type = TYPES[index % TYPES.length]
  const orbitClass = CLASSES[index % CLASSES.length]
  const designator = index % 5 === 0 ? null : `${2010 + (index % 16)}-${String(index % 1_000).padStart(3, '0')}${String.fromCharCode(65 + (index % 26))}`
  const launchYear = 2010 + (index % 16)
  const launchDate = `${launchYear}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`
  const name = `Orbitin Fixture ${type.text} ${orbitClass.toUpperCase()} ${catalogId}`

  return {
    catalogId,
    name,
    normalizedName: normalizeSearchText(name),
    internationalDesignator: designator,
    epochUtc: new Date(Date.UTC(2025 + (index % 2), index % 12, (index % 28) + 1, index % 24, index % 60, index % 60)).toISOString(),
    groups: [],
    shard: index % shardCount,
    src: { t: type.text, k: type.code, c: COUNTRIES[index % COUNTRIES.length], l: launchDate },
    drv: derivedProjection(orbitClass, index),
  }
}

function derivedProjection(orbitClass: typeof CLASSES[number], index: number): NonNullable<CatalogueSearchEntryV1['drv']> {
  const nearPolar = index % 2 === 0
  if (orbitClass === 'geo') {
    const geoLike = index % 2 === 0
    return { o: 'geo', b: 'high', r: index % 3 === 0 ? 'deep' : 'near', f: 8 | (geoLike ? 16 | 2 : 1) }
  }
  if (orbitClass === 'ellip') return { o: 'ellip', b: 'cross', r: index % 3 === 0 ? 'deep' : 'near', f: 4 | (nearPolar ? 1 : 2) }
  if (orbitClass === 'cross') return { o: 'cross', b: 'cross', r: index % 3 === 0 ? 'deep' : 'near', f: nearPolar ? 1 : 2 }
  return { o: orbitClass, b: orbitClass, r: index % 3 === 0 ? 'deep' : 'near', f: nearPolar ? 1 : 2 }
}
