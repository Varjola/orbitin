import { expect, it } from 'vitest'
import { decodeCatalogueIndex, decodeCatalogueManifest } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { EMPTY_CATALOGUE_QUERY, runCatalogueQuery, type CatalogueQuery } from '../data/catalogueQuery.ts'
import { generateCatalogueIndex } from '../test-fixtures/generatedCatalogueIndex.ts'
import { allFiltersActiveCount, buildCatalogueResultsModel, catalogueResultColumns, catalogueResultRow, clearCatalogueFilters, MISSING_VALUE, reconcileQueryWithSnapshot } from './catalogueResultsModel.ts'

const legacyFiles = import.meta.glob('../../workers/catalogue/fixtures/legacy-snapshot/manifest.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const reference = Date.parse('2026-09-15T00:00:00Z')

function automaticFixture() {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const index = decodeCatalogueIndex(fixture.index, manifest)
  const overview = runCatalogueQuery(index.entries, EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 }, limit: 1 })
  return { manifest, index, overview }
}

it('builds fixed-order filter labels and counts, keeping checked zero options enabled', () => {
  const { manifest, index, overview } = automaticFixture()
  const query: CatalogueQuery = { ...EMPTY_CATALOGUE_QUERY, typeCategories: ['debris'], countryOrSourceCode: 'ISS' }
  const result = runCatalogueQuery(index.entries, query, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 } })
  const model = buildCatalogueResultsModel({ manifest, query, result, overviewFacets: overview.facets })
  expect(model.typeOptions.map((item) => item.value)).toEqual(['payload', 'rocket-body', 'debris', 'unknown'])
  expect(model.typeOptions.find((item) => item.value === 'debris')).toMatchObject({ label: 'Debris (0)', checked: true, disabled: false })
  expect(model.countryOptions.find((item) => item.value === 'ISS')).toMatchObject({ label: 'ISS (0)', checked: true, disabled: false })
  expect(model.summary).toBe('No catalogue objects match the current search and filters.')
})

it('keeps object type and orbit class visible and counts only the remaining filters behind All filters', () => {
  const { manifest, index, overview } = automaticFixture()
  const visibleOnly: CatalogueQuery = { ...EMPTY_CATALOGUE_QUERY, typeCategories: ['payload'], primaryOrbitClasses: ['low-earth'] }
  const result = runCatalogueQuery(index.entries, visibleOnly, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 } })
  const model = buildCatalogueResultsModel({ manifest, query: visibleOnly, result, overviewFacets: overview.facets })
  expect(model.allFiltersActiveCount).toBe(0)
  expect(model.allFiltersLabel).toBe('All filters')
  expect(model.clearFiltersEnabled).toBe(true)

  const hidden: CatalogueQuery = { ...visibleOnly, sgp4Regime: 'near-earth', requiredFlags: ['nearPolar', 'geoLike'], countryOrSourceCode: 'ISS', launchYearMin: 1990, maxElementAgeDays: 3 }
  expect(allFiltersActiveCount(hidden)).toBe(6)
  const hiddenModel = buildCatalogueResultsModel({ manifest, query: hidden, result, overviewFacets: overview.facets })
  expect(hiddenModel.allFiltersLabel).toBe('All filters (6 active)')
  expect(hiddenModel).toMatchObject({ launchYearMin: 1990, launchYearMax: null, maxElementAgeDays: 3 })
})

it('clears filters without leaving the search text, sort or legacy group', () => {
  const query: CatalogueQuery = { ...EMPTY_CATALOGUE_QUERY, text: 'station', group: 'science', sort: 'name', typeCategories: ['payload'], requiredFlags: ['nearPolar'], maxElementAgeDays: 1 }
  expect(clearCatalogueFilters(query)).toEqual({ ...EMPTY_CATALOGUE_QUERY, text: 'station', group: 'science', sort: 'name' })
})

it('uses the exact bounded-window summary and only index fields in default columns', () => {
  const entries = generateCatalogueIndex().entries
  const result = runCatalogueQuery(entries, EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 }, limit: 100 })
  const { manifest } = automaticFixture()
  const model = buildCatalogueResultsModel({ manifest, query: EMPTY_CATALOGUE_QUERY, result, overviewFacets: result.facets })
  expect(model.summary).toBe('Showing 100 of 40,000 matching objects')
  expect(model.rows).toHaveLength(100)
  expect(model.columns.map((column) => column.key)).toEqual(['select', 'name', 'catalog-id', 'object-type', 'orbit-class', 'launch-date', 'epoch', 'status'])
  expect(model.columns.filter((column) => !column.narrow).map((column) => column.key)).toEqual(['launch-date', 'epoch'])

  const small = runCatalogueQuery(entries.slice(0, 37), EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 }, limit: 100 })
  expect(buildCatalogueResultsModel({ manifest, query: EMPTY_CATALOGUE_QUERY, result: small, overviewFacets: small.facets }).summary).toBe('Showing 37 matching objects')
  const one = runCatalogueQuery(entries.slice(0, 1), EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 }, limit: 100 })
  expect(buildCatalogueResultsModel({ manifest, query: EMPTY_CATALOGUE_QUERY, result: one, overviewFacets: one.facets }).summary).toBe('Showing 1 matching object')
})

it('decodes row cells from the compact index projection with the provider type first', () => {
  const { index } = automaticFixture()
  const [leo, geo, rocket] = index.entries.map(catalogueResultRow)
  expect(leo).toEqual({ catalogId: '900001', name: 'SYNTHETIC 900001', internationalDesignator: '2026-900A', objectType: 'PAYLOAD', orbitClass: 'Low Earth orbit band', launchDate: '1998-11-20', epoch: '2026-09-13 18:00 UTC' })
  // No provider metadata: every automatic column shows the presentation placeholder, never an inferred value.
  expect(geo).toMatchObject({ internationalDesignator: null, objectType: MISSING_VALUE, launchDate: MISSING_VALUE, orbitClass: 'Near-geosynchronous period' })
  expect(rocket).toMatchObject({ objectType: 'ROCKET BODY', orbitClass: 'Highly elliptical' })
})

it('omits automatic columns and fields for a legacy snapshot rather than fabricating them', () => {
  expect(catalogueResultColumns('legacy').map((column) => column.key)).toEqual(['select', 'name', 'catalog-id', 'epoch', 'status'])
  const legacy = catalogueResultRow({ catalogId: '700001', name: 'Legacy', normalizedName: 'legacy', internationalDesignator: '2026-001A', epochUtc: '2026-01-01T00:00:00Z', groups: [], shard: 0 })
  expect(legacy).toMatchObject({ objectType: MISSING_VALUE, orbitClass: MISSING_VALUE, launchDate: MISSING_VALUE, epoch: '2026-01-01 00:00 UTC' })
})

it('uses the manifest profile for legacy controls and reconciles stale capabilities', () => {
  const manifest = decodeCatalogueManifest(JSON.parse(legacyFiles['../../workers/catalogue/fixtures/legacy-snapshot/manifest.json']!))
  const query: CatalogueQuery = {
    ...EMPTY_CATALOGUE_QUERY, text: 'ISS', group: 'missing', typeCategories: ['payload'], primaryOrbitClasses: ['low-earth'],
    sgp4Regime: 'deep-space', requiredFlags: ['nearPolar'], countryOrSourceCode: 'ISS', launchYearMin: 2000, launchYearMax: 2010,
    maxElementAgeDays: 1, sort: 'launch-newest',
  }
  expect(reconcileQueryWithSnapshot(query, manifest, null)).toEqual({ ...EMPTY_CATALOGUE_QUERY, text: 'ISS', sort: 'relevance' })
  const result = { entries: [], totalMatches: 0, hasMore: false, facets: null }
  const model = buildCatalogueResultsModel({ manifest, query: reconcileQueryWithSnapshot(query, manifest, null), result, overviewFacets: null })
  expect(model.automatic).toBe(false)
  expect(model.columns.map((column) => column.key)).toEqual(['select', 'name', 'catalog-id', 'epoch', 'status'])
  expect(model.sortOptions.map((item) => item.value)).not.toContain('launch-newest')
})

it('keeps a country when only current filters exclude it, but drops it when absent from the snapshot', () => {
  const { manifest, overview } = automaticFixture()
  const query = { ...EMPTY_CATALOGUE_QUERY, countryOrSourceCode: 'ISS' }
  expect(reconcileQueryWithSnapshot(query, manifest, overview.facets).countryOrSourceCode).toBe('ISS')
  expect(reconcileQueryWithSnapshot({ ...query, countryOrSourceCode: 'NOPE' }, manifest, overview.facets).countryOrSourceCode).toBeNull()
})

it('carries the controller query text so a Quick Search View all handoff fills the full search field', () => {
  const { manifest, index, overview } = automaticFixture()
  const query: CatalogueQuery = { ...EMPTY_CATALOGUE_QUERY, text: 'synthetic', typeCategories: ['payload'] }
  const result = runCatalogueQuery(index.entries, query, { referenceUnixMs: reference, profile: { mode: 'automatic', contractVersion: 1 } })
  expect(buildCatalogueResultsModel({ manifest, query, result, overviewFacets: overview.facets }).searchText).toBe('synthetic')
})
