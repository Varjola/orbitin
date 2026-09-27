import { automaticSearchProjection, catalogueProfileMode, type CatalogueProfileMode } from '../data/catalogueProfile.ts'
import type { CatalogueManifestV1, CatalogueSearchEntryV1 } from '../data/catalogueSchema.ts'
import {
  activeFilterCount, EMPTY_CATALOGUE_QUERY, ORBIT_FLAGS, PRIMARY_ORBIT_CLASSES, SGP4_REGIMES, TYPE_CATEGORIES,
  type CatalogueFacetCounts, type CatalogueQuery, type CatalogueQueryResult, type CatalogueSortKey, type OrbitFlag,
} from '../data/catalogueQuery.ts'
import type { PrimaryOrbitClass, Sgp4Regime } from '../data/catalogueEnrichment.ts'
import type { CatalogueObjectTypeCategory } from '../data/catalogueSourceRecord.ts'
import { text } from '../i18n/index.ts'
import { catalogueResultWindowSummary } from './catalogueWording.ts'

export interface FilterOptionModel<T extends string> {
  readonly value: T
  readonly label: string
  readonly checked: boolean
  readonly count: number
  readonly disabled: boolean
}

export type CatalogueResultColumnKey = 'select' | 'name' | 'catalog-id' | 'object-type' | 'orbit-class' | 'launch-date' | 'epoch' | 'status'

export interface CatalogueResultColumn {
  readonly key: CatalogueResultColumnKey
  readonly label: string
  /** False for columns omitted from the compact narrow row; Details keeps them. */
  readonly narrow: boolean
}

/** One dense row, decoded once from the lightweight index entry. Shard records
 *  never participate, so rendering a result window cannot request one. */
export interface CatalogueResultRow {
  readonly catalogId: string
  readonly name: string
  readonly internationalDesignator: string | null
  readonly objectType: string
  readonly orbitClass: string
  readonly launchDate: string
  readonly epoch: string
}

export interface CatalogueResultsModel {
  readonly automatic: boolean
  /** Full-search text owned by the controller query, including Quick Search View all handoff. */
  readonly searchText: string
  readonly clearFiltersEnabled: boolean
  /** Object type and orbit class stay visible in the normal Find surface. */
  readonly typeOptions: readonly FilterOptionModel<CatalogueObjectTypeCategory>[]
  readonly classOptions: readonly FilterOptionModel<PrimaryOrbitClass>[]
  /** Remaining supported filters, disclosed behind All filters. */
  readonly allFiltersLabel: string
  readonly allFiltersActiveCount: number
  readonly flagOptions: readonly FilterOptionModel<OrbitFlag>[]
  readonly regimeOptions: readonly FilterOptionModel<Sgp4Regime | 'any'>[]
  readonly countryOptions: readonly FilterOptionModel<string>[]
  readonly launchYearMin: number | null
  readonly launchYearMax: number | null
  readonly maxElementAgeDays: number | null
  readonly sortOptions: readonly { readonly value: CatalogueSortKey; readonly label: string; readonly selected: boolean }[]
  readonly summary: string
  readonly columns: readonly CatalogueResultColumn[]
  readonly rows: readonly CatalogueResultRow[]
}

export const MISSING_VALUE = '—'
export function elementAgeOptions(): readonly { readonly value: string; readonly label: string }[] {
  const ages = text().catalogue.elementAges
  return [{ value: '', label: ages.any }, { value: '1', label: ages[1] }, { value: '3', label: ages[3] }, { value: '7', label: ages[7] }]
}

const LEGACY_SORTS: readonly CatalogueSortKey[] = ['relevance', 'name', 'catalog-id', 'epoch-newest']
const AUTOMATIC_SORTS: readonly CatalogueSortKey[] = ['relevance', 'name', 'catalog-id', 'launch-newest', 'launch-oldest', 'epoch-newest']

const AUTOMATIC_COLUMNS: readonly { readonly key: CatalogueResultColumnKey; readonly narrow: boolean }[] = [
  { key: 'select', narrow: true }, { key: 'name', narrow: true }, { key: 'catalog-id', narrow: true }, { key: 'object-type', narrow: true },
  { key: 'orbit-class', narrow: true }, { key: 'launch-date', narrow: false }, { key: 'epoch', narrow: false }, { key: 'status', narrow: true },
]
/** Legacy snapshots show only the identity/epoch fields they possess. */
const LEGACY_COLUMNS = AUTOMATIC_COLUMNS.filter((column) => !['object-type', 'orbit-class', 'launch-date'].includes(column.key))

export function catalogueResultColumns(mode: CatalogueProfileMode): readonly CatalogueResultColumn[] {
  const labels = text().catalogue.columns
  return (mode === 'automatic' ? AUTOMATIC_COLUMNS : LEGACY_COLUMNS).map((column) => ({ ...column, label: labels[column.key] }))
}

export function catalogueResultRow(entry: CatalogueSearchEntryV1): CatalogueResultRow {
  const projection = automaticSearchProjection(entry)
  const category = projection?.source.typeCategory
  return {
    catalogId: entry.catalogId,
    name: entry.name,
    internationalDesignator: entry.internationalDesignator,
    // The provider's own type code is shown as published; the category word is ours.
    objectType: projection?.source.type ?? (category ? text().catalogue.typeCategories[category] : MISSING_VALUE),
    orbitClass: projection ? text().catalogue.orbitClasses[projection.derived.primaryOrbitClass] : MISSING_VALUE,
    launchDate: projection?.source.launchDate ?? MISSING_VALUE,
    epoch: formatEpoch(entry.epochUtc),
  }
}

/** Filters behind All filters: SGP4 regime, geometry flags, country/source
 *  code, launch-year range and maximum element age. */
export function allFiltersActiveCount(query: CatalogueQuery): number {
  return activeFilterCount(query) - (query.typeCategories.length > 0 ? 1 : 0) - (query.primaryOrbitClasses.length > 0 ? 1 : 0)
}

/** Clear filters keeps search text, sort and legacy group; a Discovery Page scope is not part of the query. */
export function clearCatalogueFilters(query: CatalogueQuery): CatalogueQuery {
  return { ...EMPTY_CATALOGUE_QUERY, text: query.text, group: query.group, sort: query.sort }
}

export function buildCatalogueResultsModel(input: {
  readonly manifest: CatalogueManifestV1
  readonly query: CatalogueQuery
  readonly result: CatalogueQueryResult
  readonly overviewFacets: CatalogueFacetCounts | null
}): CatalogueResultsModel {
  const t = text().catalogue
  const mode = catalogueProfileMode(input.manifest)
  const automatic = mode === 'automatic'
  const facets = input.result.facets
  const checkedTypes = new Set(input.query.typeCategories)
  const checkedClasses = new Set(input.query.primaryOrbitClasses)
  const checkedFlags = new Set(input.query.requiredFlags)
  const typeOptions = TYPE_CATEGORIES.map((value) => option(value, t.typeCategories[value], facets?.typeCategories[value] ?? 0, checkedTypes.has(value)))
  const classOptions = PRIMARY_ORBIT_CLASSES.map((value) => option(value, t.orbitClasses[value], facets?.primaryOrbitClasses[value] ?? 0, checkedClasses.has(value)))
  const flagOptions = ORBIT_FLAGS.map((value) => option(value, t.orbitFlags[value], facets?.flags[value] ?? 0, checkedFlags.has(value)))
  const regimeOptions: FilterOptionModel<Sgp4Regime | 'any'>[] = [
    option('any', t.any, input.result.totalMatches, input.query.sgp4Regime === null),
    ...SGP4_REGIMES.map((value) => option(value, t.sgp4Regimes[value], facets?.sgp4Regimes[value] ?? 0, input.query.sgp4Regime === value)),
  ]
  const countryOptions: FilterOptionModel<string>[] = [option('', t.anyCode, input.result.totalMatches, input.query.countryOrSourceCode === null)]
  for (const item of facets?.countryOrSourceCodes ?? []) countryOptions.push(option(item.code, item.code, item.count, input.query.countryOrSourceCode === item.code))
  if (input.query.countryOrSourceCode !== null && !countryOptions.some((item) => item.value === input.query.countryOrSourceCode)) {
    const existsInSnapshot = input.overviewFacets?.countryOrSourceCodes.some((item) => item.code === input.query.countryOrSourceCode) ?? false
    if (existsInSnapshot) countryOptions.push(option(input.query.countryOrSourceCode, input.query.countryOrSourceCode, 0, true))
  }
  const hiddenActive = allFiltersActiveCount(input.query)
  const sorts = automatic ? AUTOMATIC_SORTS : LEGACY_SORTS
  return {
    automatic,
    searchText: input.query.text,
    clearFiltersEnabled: activeFilterCount(input.query) > 0,
    typeOptions, classOptions,
    allFiltersLabel: hiddenActive === 0 ? t.allFilters : t.allFiltersActive(hiddenActive),
    allFiltersActiveCount: hiddenActive,
    flagOptions, regimeOptions, countryOptions,
    launchYearMin: input.query.launchYearMin,
    launchYearMax: input.query.launchYearMax,
    maxElementAgeDays: input.query.maxElementAgeDays,
    sortOptions: sorts.map((value) => ({ value, label: t.sortLabels[value], selected: input.query.sort === value })),
    summary: catalogueResultWindowSummary(input.result),
    columns: catalogueResultColumns(mode),
    rows: input.result.entries.map(catalogueResultRow),
  }
}

export function reconcileQueryWithSnapshot(query: CatalogueQuery, manifest: CatalogueManifestV1, wholeCatalogueFacets: CatalogueFacetCounts | null): CatalogueQuery {
  const mode: CatalogueProfileMode = catalogueProfileMode(manifest)
  if (mode === 'legacy') {
    const group = query.group !== null && manifest.groups.some((candidate) => candidate.id === query.group) ? query.group : null
    const sort = LEGACY_SORTS.includes(query.sort) ? query.sort : 'relevance'
    return { ...EMPTY_CATALOGUE_QUERY, text: query.text, group, sort }
  }
  const country = query.countryOrSourceCode !== null && wholeCatalogueFacets?.countryOrSourceCodes.some((item) => item.code === query.countryOrSourceCode)
    ? query.countryOrSourceCode : null
  return {
    ...query,
    group: null,
    countryOrSourceCode: country,
    sort: AUTOMATIC_SORTS.includes(query.sort) ? query.sort : 'relevance',
  }
}

function formatEpoch(epochUtc: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(epochUtc) ? `${epochUtc.slice(0, 10)} ${epochUtc.slice(11, 16)} UTC` : epochUtc
}

function option<T extends string>(value: T, label: string, count: number, checked: boolean): FilterOptionModel<T> {
  return { value, label: value === '' || value === 'any' ? label : text().catalogue.optionCount(label, count), checked, count, disabled: count === 0 && !checked }
}
