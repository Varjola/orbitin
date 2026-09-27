import { describe, expect, it } from 'vitest'
import { normalizeSearchText, type CatalogueSearchEntryV1 } from './catalogueSchema.ts'
import { runQuickCatalogueQuery, searchCatalogue } from './catalogueSearch.ts'
import { aliasKey, aliasMatches, SEARCH_ALIASES } from './searchAliases.ts'
import { FEATURED_PICKS } from './featuredPicks.ts'

/** Real published names; decoys come first in index order, so only the
 *  ranking can put the expected object on top. */
const NAMES: readonly (readonly [string, string])[] = [
  ['99001', 'ISS DEB'], ['69796', 'ISS OBJECT YL'], ['49044', 'ISS (NAUKA)'], ['25575', 'ISS (UNITY)'], ['35932', 'SWISSCUBE'], ['36797', 'AISSAT 1'],
  ['25544', 'ISS (ZARYA)'], ['53239', 'CSS (WENTIAN)'], ['48274', 'CSS (TIANHE)'], ['20580', 'HST'],
  ['99002', 'FALCON 9 DEB (STARLINK)'], ['44713', 'STARLINK-1007'], ['99003', 'NAVSTAR GPS DEB'], ['26407', 'GPS BIIR-5'],
  ['37846', 'GSAT0101 (GALILEO-PFM)'], ['32275', 'COSMOS 2424'], ['99004', 'SENTINEL 1 DEB'], ['40697', 'SENTINEL-2A'],
  ['25682', 'LANDSAT 7'], ['39084', 'LANDSAT 8'], ['49260', 'LANDSAT 9'], ['99005', 'DELTA 2 DEB (NOAA)'], ['43013', 'NOAA 20 (JPSS-1)'],
  ['29155', 'GOES 13'], ['51850', 'GOES 18'], ['60133', 'GOES 19'], ['99006', 'IRIDIUM 33 DEB'], ['41917', 'IRIDIUM 106'],
  ['99007', 'ONEWEB DEB'], ['44057', 'ONEWEB-0012'], ['27386', 'ENVISAT'], ['31698', 'TERRASAR-X'], ['25994', 'TERRA'], ['27424', 'AQUA'],
  ['5', 'VANGUARD 1'], ['25847', 'MOLNIYA 3-50'], ['60989', 'SENTINEL-2C'],
]
const ENTRIES: readonly CatalogueSearchEntryV1[] = NAMES.map(([catalogId, name]) => ({ catalogId, name, normalizedName: normalizeSearchText(name), internationalDesignator: null, epochUtc: '2026-09-26T00:00:00Z', groups: [], shard: 0 }))

const top = (query: string, count = 3) => runQuickCatalogueQuery(ENTRIES, query).entries.slice(0, count).map((entry) => entry.name)

describe('Quick Search common names and ranking', () => {
  it('puts the station first for ISS, never its modules or debris', () => {
    expect(top('ISS', 1)).toEqual(['ISS (ZARYA)'])
    expect(top('iss', 1)).toEqual(['ISS (ZARYA)'])
    expect(top('International Space Station', 1)).toEqual(['ISS (ZARYA)'])
  })

  it.each([
    ['Hubble', 'HST'], ['Tiangong', 'CSS (TIANHE)'], ['Starlink', 'STARLINK-1007'], ['GPS', 'GPS BIIR-5'], ['Galileo', 'GSAT0101 (GALILEO-PFM)'],
    ['GLONASS', 'COSMOS 2424'], ['Sentinel', 'SENTINEL-2A'], ['Landsat', 'LANDSAT 9'], ['NOAA', 'NOAA 20 (JPSS-1)'], ['GOES', 'GOES 19'],
    ['Iridium', 'IRIDIUM 106'], ['OneWeb', 'ONEWEB-0012'], ['Envisat', 'ENVISAT'], ['Terra', 'TERRA'], ['Aqua', 'AQUA'],
  ])('finds %s within the first three results', (query, expected) => {
    expect(top(query)).toContain(expected)
  })

  it('ranks whole names and name prefixes above other substrings, and matches the start of an alias', () => {
    expect(top('Terra', 1)).toEqual(['TERRA'])
    expect(top('Hubb', 1)).toEqual(['HST'])
    expect(top('GOES-East', 1)).toEqual(['GOES 19'])
    // Two letters are too few to expand an alias.
    expect(aliasMatches('is').size).toBe(0)
    // An exact catalogue id still wins over everything.
    expect(top('5', 1)).toEqual(['VANGUARD 1'])
  })

  it('leaves the full catalogue search order unchanged', () => {
    const plain = searchCatalogue(ENTRIES, { query: 'iss', group: null })
    expect(plain.entries[0].name).toBe('ISS DEB')
    expect(plain.entries.map((entry) => entry.name)).not.toContain('HST')
  })

  it('keeps every alias well formed and every featured pick findable by its common name', () => {
    for (const alias of SEARCH_ALIASES) {
      expect(alias.catalogIds.length).toBeGreaterThan(0)
      for (const name of alias.names) expect(aliasKey(name)).not.toBe('')
      for (const id of alias.catalogIds) expect(id).toMatch(/^[1-9]\d{0,8}$/)
    }
    expect(new Set(FEATURED_PICKS.map((pick) => pick.id)).size).toBe(FEATURED_PICKS.length)
    for (const pick of FEATURED_PICKS) expect(ENTRIES.some((entry) => entry.catalogId === pick.catalogId), pick.id).toBe(true)
  })
})
