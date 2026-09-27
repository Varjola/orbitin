import { automaticSearchProjection } from './catalogueProfile.ts'
import { compareCatalogIds, type CatalogueObjectTypeCategory } from './catalogueSourceRecord.ts'
import type { CatalogueSearchEntryV1 } from './catalogueSchema.ts'
import { MAX_CATALOGUE_RESULTS, compileTextQuery, matchCatalogueText, preparedSearchTexts } from './catalogueSearch.ts'
import type { PrimaryOrbitClass, Sgp4Regime } from './catalogueEnrichment.ts'

export type OrbitFlag = 'nearPolar' | 'nearEquatorial' | 'highEccentricity' | 'nearGeosynchronous' | 'geoLike'
export const ORBIT_FLAGS: readonly OrbitFlag[] = ['nearPolar', 'nearEquatorial', 'highEccentricity', 'nearGeosynchronous', 'geoLike']
export const ORBIT_FLAG_BITS: Readonly<Record<OrbitFlag, number>> = { nearPolar: 1, nearEquatorial: 2, highEccentricity: 4, nearGeosynchronous: 8, geoLike: 16 }
export const TYPE_CATEGORIES: readonly CatalogueObjectTypeCategory[] = ['payload', 'rocket-body', 'debris', 'unknown']
export const PRIMARY_ORBIT_CLASSES: readonly PrimaryOrbitClass[] = ['low-earth', 'medium-earth', 'high-earth', 'geosynchronous', 'highly-elliptical', 'crossing-bands']
export const SGP4_REGIMES: readonly Sgp4Regime[] = ['near-earth', 'deep-space']

export type CatalogueSortKey = 'relevance' | 'name' | 'catalog-id' | 'launch-newest' | 'launch-oldest' | 'epoch-newest'

export interface CatalogueQuery {
  readonly text: string
  /** Legacy snapshots only; null means all groups. */
  readonly group: string | null
  readonly typeCategories: readonly CatalogueObjectTypeCategory[]
  readonly primaryOrbitClasses: readonly PrimaryOrbitClass[]
  readonly sgp4Regime: Sgp4Regime | null
  readonly requiredFlags: readonly OrbitFlag[]
  readonly countryOrSourceCode: string | null
  readonly launchYearMin: number | null
  readonly launchYearMax: number | null
  readonly maxElementAgeDays: number | null
  readonly sort: CatalogueSortKey
}

export const EMPTY_CATALOGUE_QUERY: CatalogueQuery = {
  text: '', group: null, typeCategories: [], primaryOrbitClasses: [], sgp4Regime: null, requiredFlags: [],
  countryOrSourceCode: null, launchYearMin: null, launchYearMax: null, maxElementAgeDays: null, sort: 'relevance',
}

export interface CountryCodeCount { readonly code: string; readonly count: number }

export interface CatalogueFacetCounts {
  readonly typeCategories: Readonly<Record<CatalogueObjectTypeCategory, number>>
  readonly primaryOrbitClasses: Readonly<Record<PrimaryOrbitClass, number>>
  readonly sgp4Regimes: Readonly<Record<Sgp4Regime, number>>
  readonly flags: Readonly<Record<OrbitFlag, number>>
  /** Count descending, then code ascending. Codes with a zero count are omitted. */
  readonly countryOrSourceCodes: readonly CountryCodeCount[]
}

export interface CatalogueQueryResult {
  readonly entries: readonly CatalogueSearchEntryV1[]
  readonly totalMatches: number
  readonly hasMore: boolean
  /** Null for a legacy snapshot, which has no metadata to count. */
  readonly facets: CatalogueFacetCounts | null
}

export type CatalogueQueryProfile =
  | { readonly mode: 'legacy'; readonly contractVersion: null }
  | { readonly mode: 'automatic'; readonly contractVersion: number }

export interface CatalogueQueryOptions {
  readonly referenceUnixMs: number
  readonly profile: CatalogueQueryProfile
  readonly limit?: number
  /** Optional resolved Discovery Page membership. User filters are applied
   * after this scope; the scope itself never causes record loading. */
  readonly candidateIds?: ReadonlySet<string> | readonly string[]
}

export interface CatalogueFacetRow {
  readonly typeCategory: CatalogueObjectTypeCategory | null
  readonly primaryOrbitClass: PrimaryOrbitClass | null
  readonly sgp4Regime: Sgp4Regime | null
  /** Automatic-profile flag bits; 0 for legacy. */
  readonly flagBits: number
  readonly countryOrSourceCode: string | null
  readonly launchDate: string | null
  readonly launchYear: number | null
  readonly epochUnixMs: number
}

const DAY_MS = 86_400_000
const facetRows = new WeakMap<readonly CatalogueSearchEntryV1[], readonly CatalogueFacetRow[]>()

/** Build compact metadata rows once per decoded index. */
export function preparedFacetRows(entries: readonly CatalogueSearchEntryV1[]): readonly CatalogueFacetRow[] {
  let rows = facetRows.get(entries)
  if (!rows) {
    rows = entries.map((entry) => {
      const projection = automaticSearchProjection(entry)
      const launchDate = projection?.source.launchDate ?? null
      return {
        typeCategory: projection?.source.typeCategory ?? null,
        primaryOrbitClass: projection?.derived.primaryOrbitClass ?? null,
        sgp4Regime: projection?.derived.sgp4Regime ?? null,
        flagBits: projection ? (entry.drv?.f ?? 0) : 0,
        countryOrSourceCode: projection?.source.countryOrSourceCode ?? null,
        launchDate,
        launchYear: launchDate === null ? null : Number(launchDate.slice(0, 4)),
        epochUnixMs: Date.parse(entry.epochUtc),
      }
    })
    facetRows.set(entries, rows)
  }
  return rows
}

export function runCatalogueQuery(entries: readonly CatalogueSearchEntryV1[], query: CatalogueQuery, options: CatalogueQueryOptions): CatalogueQueryResult {
  const limit = Math.max(1, Math.min(MAX_CATALOGUE_RESULTS, Math.floor(options.limit ?? MAX_CATALOGUE_RESULTS)))
  const candidateIds = asCandidateSet(options.candidateIds)
  const texts = preparedSearchTexts(entries)
  const rows = preparedFacetRows(entries)
  const compiledText = compileTextQuery(query.text)
  const requiredBits = query.requiredFlags.reduce((bits, flag) => bits | ORBIT_FLAG_BITS[flag], 0)
  const automatic = options.profile.mode === 'automatic'
  const typeCounts = zeroRecord(TYPE_CATEGORIES)
  const classCounts = zeroRecord(PRIMARY_ORBIT_CLASSES)
  const regimeCounts = zeroRecord(SGP4_REGIMES)
  const flagCounts = zeroRecord(ORBIT_FLAGS)
  const countryCounts = new Map<string, number>()
  const exact: number[] = []
  const prefixes: number[] = []
  const other: number[] = []
  let totalMatches = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (candidateIds !== null && !candidateIds.has(entry.catalogId)) continue
    const row = rows[index]
    const textMatch = matchCatalogueText(compiledText, entry, texts[index])
    if (textMatch === null || !matchesBase(entry, row, query, options.referenceUnixMs)) continue

    const typeMatches = query.typeCategories.length === 0 || (row.typeCategory !== null && query.typeCategories.includes(row.typeCategory))
    const classMatches = query.primaryOrbitClasses.length === 0 || (row.primaryOrbitClass !== null && query.primaryOrbitClasses.includes(row.primaryOrbitClass))
    const regimeMatches = query.sgp4Regime === null || row.sgp4Regime === query.sgp4Regime
    const flagsMatch = (row.flagBits & requiredBits) === requiredBits
    const countryMatches = query.countryOrSourceCode === null || row.countryOrSourceCode === query.countryOrSourceCode
    if (typeMatches && classMatches && regimeMatches && flagsMatch && countryMatches) {
      totalMatches += 1
      if (query.sort === 'relevance') {
        if (textMatch === 'exact-id') exact.push(index)
        else if (textMatch === 'id-prefix') prefixes.push(index)
        else other.push(index)
      }
    }

    if (automatic) {
      if (classMatches && regimeMatches && flagsMatch && countryMatches && row.typeCategory !== null) typeCounts[row.typeCategory] += 1
      if (typeMatches && regimeMatches && flagsMatch && countryMatches && row.primaryOrbitClass !== null) classCounts[row.primaryOrbitClass] += 1
      if (typeMatches && classMatches && flagsMatch && countryMatches && row.sgp4Regime !== null) regimeCounts[row.sgp4Regime] += 1
      if (typeMatches && classMatches && regimeMatches && flagsMatch && row.countryOrSourceCode !== null) increment(countryCounts, row.countryOrSourceCode)
      if (typeMatches && classMatches && regimeMatches && countryMatches) {
        for (const flag of ORBIT_FLAGS) {
          const candidateBits = requiredBits | ORBIT_FLAG_BITS[flag]
          if ((row.flagBits & candidateBits) === candidateBits) flagCounts[flag] += 1
        }
      }
    }
  }

  const positions = query.sort === 'relevance'
    ? [...exact, ...prefixes, ...other]
    : matchingPositions(entries, rows, texts, query, options.referenceUnixMs, compiledText, query.sort, candidateIds)
  const facets = automatic ? {
    typeCategories: typeCounts,
    primaryOrbitClasses: classCounts,
    sgp4Regimes: regimeCounts,
    flags: flagCounts,
    countryOrSourceCodes: [...countryCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
  } : null
  return {
    entries: positions.slice(0, limit).map((index) => entries[index]),
    totalMatches,
    hasMore: totalMatches > limit,
    facets,
  }
}

export function activeFilterCount(query: CatalogueQuery): number {
  return (query.typeCategories.length > 0 ? 1 : 0) +
    (query.primaryOrbitClasses.length > 0 ? 1 : 0) +
    (query.sgp4Regime === null ? 0 : 1) +
    new Set(query.requiredFlags).size +
    (query.countryOrSourceCode === null ? 0 : 1) +
    (query.launchYearMin === null && query.launchYearMax === null ? 0 : 1) +
    (query.maxElementAgeDays === null ? 0 : 1)
}

function matchesBase(entry: CatalogueSearchEntryV1, row: CatalogueFacetRow, query: CatalogueQuery, referenceUnixMs: number): boolean {
  if (query.group !== null && !entry.groups.includes(query.group)) return false
  if (query.launchYearMin !== null || query.launchYearMax !== null) {
    if (row.launchYear === null || (query.launchYearMin !== null && row.launchYear < query.launchYearMin) || (query.launchYearMax !== null && row.launchYear > query.launchYearMax)) return false
  }
  if (query.maxElementAgeDays !== null) {
    const ageDays = Math.max(0, (referenceUnixMs - row.epochUnixMs) / DAY_MS)
    if (!Number.isFinite(ageDays) || ageDays > query.maxElementAgeDays) return false
  }
  return true
}

function matchingPositions(
  entries: readonly CatalogueSearchEntryV1[],
  rows: readonly CatalogueFacetRow[],
  texts: readonly { readonly text: string; readonly keywords: string }[],
  query: CatalogueQuery,
  referenceUnixMs: number,
  compiledText: ReturnType<typeof compileTextQuery>,
  sort: Exclude<CatalogueSortKey, 'relevance'>,
  candidateIds: ReadonlySet<string> | null,
): number[] {
  const positions: number[] = []
  for (let index = 0; index < entries.length; index += 1) {
    if (candidateIds !== null && !candidateIds.has(entries[index].catalogId)) continue
    if (matchCatalogueText(compiledText, entries[index], texts[index]) === null || !matchesBase(entries[index], rows[index], query, referenceUnixMs)) continue
    if (!matchesMetadata(rows[index], query)) continue
    positions.push(index)
  }
  positions.sort((left, right) => compareSort(entries[left], rows[left], entries[right], rows[right], sort))
  return positions
}

function matchesMetadata(row: CatalogueFacetRow, query: CatalogueQuery): boolean {
  const requiredBits = query.requiredFlags.reduce((bits, flag) => bits | ORBIT_FLAG_BITS[flag], 0)
  return (query.typeCategories.length === 0 || (row.typeCategory !== null && query.typeCategories.includes(row.typeCategory))) &&
    (query.primaryOrbitClasses.length === 0 || (row.primaryOrbitClass !== null && query.primaryOrbitClasses.includes(row.primaryOrbitClass))) &&
    (query.sgp4Regime === null || row.sgp4Regime === query.sgp4Regime) &&
    (row.flagBits & requiredBits) === requiredBits &&
    (query.countryOrSourceCode === null || row.countryOrSourceCode === query.countryOrSourceCode)
}

function compareSort(a: CatalogueSearchEntryV1, ar: CatalogueFacetRow, b: CatalogueSearchEntryV1, br: CatalogueFacetRow, sort: Exclude<CatalogueSortKey, 'relevance'>): number {
  let result = 0
  if (sort === 'name') result = a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0
  else if (sort === 'catalog-id') result = compareCatalogIds(a.catalogId, b.catalogId)
  else if (sort === 'launch-newest' || sort === 'launch-oldest') {
    if (ar.launchDate === null && br.launchDate !== null) result = 1
    else if (ar.launchDate !== null && br.launchDate === null) result = -1
    else if (ar.launchDate !== null && br.launchDate !== null) result = sort === 'launch-newest'
      ? (br.launchDate < ar.launchDate ? -1 : br.launchDate > ar.launchDate ? 1 : 0)
      : (ar.launchDate < br.launchDate ? -1 : ar.launchDate > br.launchDate ? 1 : 0)
  } else if (sort === 'epoch-newest') result = br.epochUnixMs - ar.epochUnixMs
  return result || compareCatalogIds(a.catalogId, b.catalogId)
}

function zeroRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
}

function increment(map: Map<string, number>, key: string): void { map.set(key, (map.get(key) ?? 0) + 1) }

function asCandidateSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> | null {
  if (value === undefined) return null
  return value instanceof Set ? value : new Set(value)
}
