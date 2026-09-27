import { expect, it } from 'vitest'
import type { CatalogueSearchEntryV1 } from './catalogueSchema.ts'
import {
  EMPTY_CATALOGUE_QUERY, ORBIT_FLAG_BITS, runCatalogueQuery, activeFilterCount, type CatalogueQuery, type CatalogueQueryProfile,
} from './catalogueQuery.ts'

const automaticProfile: CatalogueQueryProfile = { mode: 'automatic', contractVersion: 1 }
const legacyProfile: CatalogueQueryProfile = { mode: 'legacy', contractVersion: null }
const reference = Date.parse('2026-01-11T00:00:00Z')

function entry(overrides: Partial<CatalogueSearchEntryV1> = {}): CatalogueSearchEntryV1 {
  return {
    catalogId: '100', name: 'Object 100', normalizedName: 'object 100', internationalDesignator: '2020-001A', epochUtc: '2026-01-10T00:00:00Z', groups: [], shard: 0,
    src: { t: 'PAYLOAD', k: 'pay', c: 'US', l: '2020-01-01' }, drv: { o: 'leo', b: 'leo', r: 'near', f: 0 }, ...overrides,
  }
}

function query(overrides: Partial<CatalogueQuery>): CatalogueQuery { return { ...EMPTY_CATALOGUE_QUERY, ...overrides } }
function ids(result: ReturnType<typeof runCatalogueQuery>): string[] { return result.entries.map((candidate) => candidate.catalogId) }

it('returns the whole list and explicit automatic zero-valued facets', () => {
  const result = runCatalogueQuery([entry({ catalogId: '2' }), entry({ catalogId: '10', src: undefined, drv: undefined })], EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: automaticProfile })
  expect(ids(result)).toEqual(['2', '10'])
  expect(result.totalMatches).toBe(2)
  expect(result.facets?.typeCategories).toEqual({ payload: 1, 'rocket-body': 0, debris: 0, unknown: 0 })
})

it('applies metadata filters with OR within type/class and AND across groups', () => {
  const entries = [
    entry({ catalogId: '1', src: { t: 'PAYLOAD', k: 'pay', c: 'US', l: '2020-01-01' }, drv: { o: 'leo', b: 'leo', r: 'near', f: ORBIT_FLAG_BITS.nearPolar } }),
    entry({ catalogId: '2', src: { t: 'DEBRIS', k: 'deb', c: 'PRC', l: '2010-01-01' }, drv: { o: 'meo', b: 'meo', r: 'deep', f: ORBIT_FLAG_BITS.highEccentricity } }),
    entry({ catalogId: '3', src: { t: 'ROCKET BODY', k: 'rb', c: 'US', l: '2020-01-01' }, drv: { o: 'leo', b: 'leo', r: 'near', f: ORBIT_FLAG_BITS.nearPolar | ORBIT_FLAG_BITS.highEccentricity } }),
  ]
  expect(ids(runCatalogueQuery(entries, query({ typeCategories: ['payload', 'rocket-body'] }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['1', '3'])
  expect(ids(runCatalogueQuery(entries, query({ primaryOrbitClasses: ['low-earth', 'medium-earth'], sgp4Regime: 'near-earth', requiredFlags: ['nearPolar'] }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['1', '3'])
  expect(ids(runCatalogueQuery(entries, query({ countryOrSourceCode: 'PRC', launchYearMin: 2010, launchYearMax: 2010 }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['2'])
})

it('counts exclusive facets outside their own selection and flags additively', () => {
  const entries = [
    entry({ catalogId: '1', src: { t: 'PAYLOAD', k: 'pay', c: 'US', l: '2020-01-01' }, drv: { o: 'leo', b: 'leo', r: 'near', f: ORBIT_FLAG_BITS.nearPolar } }),
    entry({ catalogId: '2', src: { t: 'DEBRIS', k: 'deb', c: 'US', l: '2020-01-01' }, drv: { o: 'leo', b: 'leo', r: 'near', f: ORBIT_FLAG_BITS.highEccentricity } }),
    entry({ catalogId: '3', src: { t: 'ROCKET BODY', k: 'rb', c: 'PRC', l: '2010-01-01' }, drv: { o: 'meo', b: 'meo', r: 'deep', f: ORBIT_FLAG_BITS.nearPolar | ORBIT_FLAG_BITS.highEccentricity } }),
  ]
  const result = runCatalogueQuery(entries, query({ typeCategories: ['payload'], requiredFlags: ['nearPolar'] }), { referenceUnixMs: reference, profile: automaticProfile })
  expect(result.totalMatches).toBe(1)
  expect(result.facets?.typeCategories).toEqual({ payload: 1, 'rocket-body': 1, debris: 0, unknown: 0 })
  expect(result.facets?.flags.nearPolar).toBe(1)
  expect(result.facets?.flags.highEccentricity).toBe(0)
  expect(result.facets?.countryOrSourceCodes).toEqual([{ code: 'US', count: 1 }])
})

it('excludes legacy entries from metadata filters but keeps them for empty and text queries', () => {
  const legacy = entry({ catalogId: '9', name: 'Legacy Object', normalizedName: 'legacy object', src: undefined, drv: undefined })
  const entries = [legacy, entry({ catalogId: '10' })]
  expect(ids(runCatalogueQuery(entries, EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: legacyProfile }))).toEqual(['9', '10'])
  expect(ids(runCatalogueQuery(entries, query({ typeCategories: ['payload'] }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['10'])
  expect(ids(runCatalogueQuery(entries, query({ text: 'legacy' }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['9'])
  expect(runCatalogueQuery([], EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: automaticProfile }).facets).not.toBeNull()
  expect(runCatalogueQuery([], EMPTY_CATALOGUE_QUERY, { referenceUnixMs: reference, profile: legacyProfile }).facets).toBeNull()
})

it('handles age, deterministic sorting, missing launch dates and limits', () => {
  const entries = [
    entry({ catalogId: '20', name: 'Zeta', normalizedName: 'zeta', epochUtc: '2026-01-01T00:00:00Z', src: { t: 'PAYLOAD', k: 'pay', c: 'US' } }),
    entry({ catalogId: '2', name: 'Alpha', normalizedName: 'alpha', epochUtc: '2026-01-10T00:00:00Z', src: { t: 'PAYLOAD', k: 'pay', c: 'US', l: '2020-01-01' } }),
    entry({ catalogId: '10', name: 'Alpha two', normalizedName: 'alpha two', epochUtc: '2026-01-09T00:00:00Z', src: { t: 'PAYLOAD', k: 'pay', c: 'US', l: '2022-01-01' } }),
  ]
  expect(ids(runCatalogueQuery(entries, query({ maxElementAgeDays: 2, sort: 'epoch-newest' }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['2', '10'])
  expect(ids(runCatalogueQuery(entries, query({ sort: 'name' }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['2', '10', '20'])
  expect(ids(runCatalogueQuery(entries, query({ sort: 'launch-newest' }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['10', '2', '20'])
  expect(ids(runCatalogueQuery(entries, query({ sort: 'launch-oldest' }), { referenceUnixMs: reference, profile: automaticProfile }))).toEqual(['2', '10', '20'])
  const limited = runCatalogueQuery(entries, query({}), { referenceUnixMs: reference, profile: automaticProfile, limit: 2 })
  expect(limited.totalMatches).toBe(3)
  expect(limited.hasMore).toBe(true)
  expect(limited.entries).toHaveLength(2)
})

it('reports active filter fields, not text, group or sort', () => {
  expect(activeFilterCount(EMPTY_CATALOGUE_QUERY)).toBe(0)
  expect(activeFilterCount(query({ text: 'x', group: 'g', sort: 'name', typeCategories: ['payload'], primaryOrbitClasses: ['low-earth'], sgp4Regime: 'near-earth', requiredFlags: ['nearPolar', 'geoLike'], countryOrSourceCode: 'US', launchYearMin: 2000, maxElementAgeDays: 3 }))).toBe(8)
})

it('applies a resolved membership scope before text, filters, facets and sorting', () => {
  const entries = [entry({ catalogId: '2' }), entry({ catalogId: '20' }), entry({ catalogId: '30' })]
  const result = runCatalogueQuery(entries, query({}), {
    referenceUnixMs: reference, profile: automaticProfile, candidateIds: new Set(['2', '20']), limit: 100,
  })
  expect(ids(result)).toEqual(['2', '20'])
  expect(result.totalMatches).toBe(2)
  expect(result.facets?.typeCategories.payload).toBe(2)
})
