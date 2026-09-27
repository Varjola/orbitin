import { expect, it } from 'vitest'
import { runQuickCatalogueQuery, searchCatalogue } from './catalogueSearch.ts'
import type { CatalogueSearchEntryV1 } from './catalogueSchema.ts'

const entries: CatalogueSearchEntryV1[] = [
  { catalogId: '10', name: 'Éducational Alpha', normalizedName: 'educational alpha', internationalDesignator: '2020-001A', epochUtc: '2026-01-01T00:00:00Z', groups: ['science'], shard: 0 },
  { catalogId: '20', name: 'Weather Beta', normalizedName: 'weather beta', internationalDesignator: '2021-002B', epochUtc: '2026-01-01T00:00:00Z', groups: ['weather'], shard: 1 },
]

it('searches normalized multi-term fields and applies group filters', () => {
  expect(searchCatalogue(entries, { query: 'educational alpha', group: null }).entries.map((entry) => entry.catalogId)).toEqual(['10'])
  expect(searchCatalogue(entries, { query: '2021-002B', group: 'weather' }).entries.map((entry) => entry.catalogId)).toEqual(['20'])
  expect(searchCatalogue(entries, { query: 'weather', group: 'science' }).entries).toHaveLength(0)
})

const automatic: CatalogueSearchEntryV1[] = [
  { catalogId: '255', name: 'Synthetic rocket body', normalizedName: 'synthetic rocket body', internationalDesignator: '2020-010B', epochUtc: '2026-09-12T00:00:00Z', groups: [], shard: 2, src: { t: 'ROCKET BODY', k: 'rb', c: 'PRC', l: '2020-05-05' }, drv: { o: 'ellip', b: 'cross', r: 'deep', f: 4 } },
  { catalogId: '25544', name: 'Synthetic station', normalizedName: 'synthetic station', internationalDesignator: '1998-067A', epochUtc: '2026-09-12T00:00:00Z', groups: [], shard: 3, src: { t: 'PAYLOAD', k: 'pay', c: 'ISS', l: '1998-11-20' }, drv: { o: 'leo', b: 'leo', r: 'near', f: 1 } },
  { catalogId: '1255', name: 'Legacy object', normalizedName: 'legacy object', internationalDesignator: null, epochUtc: '2026-09-12T00:00:00Z', groups: [], shard: 4 },
]
const ids = (query: string) => searchCatalogue(automatic, { query, group: null }).entries.map((entry) => entry.catalogId)

it('searches automatic source codes, launch date and year, and derived classes (test 28)', () => {
  expect(ids('rocket body')).toEqual(['255'])
  expect(ids('debris')).toEqual([])
  expect(ids('payload iss')).toEqual(['25544'])
  expect(ids('prc')).toEqual(['255'])
  expect(ids('1998')).toEqual(['25544'])
  expect(ids('2020-05')).toEqual(['255'])
  expect(ids('polar leo')).toEqual(['25544'])
  expect(ids('highly elliptical')).toEqual(['255'])
  expect(ids('deep space eccentric')).toEqual(['255'])
  expect(ids('near-earth')).toEqual(['25544'])
})

it('creates no token for missing metadata and keeps element epochs out of year searches (test 29)', () => {
  expect(ids('leo')).not.toContain('1255')
  expect(ids('unknown')).toEqual([])
  expect(ids('2026')).toEqual([])
  expect(ids('epoch-2026-09')).toEqual(['255', '25544', '1255'])
  // Word-start matching for keywords; substring matching for names stays.
  expect(ids('olar')).toEqual([])
  expect(ids('tation')).toEqual(['25544'])
})

it('ranks an exact catalogue id, then id prefixes, ahead of other matches (test 30)', () => {
  expect(ids('255')).toEqual(['255', '25544', '1255'])
  expect(ids('0255')).toEqual(['255', '25544', '1255'])
  expect(ids('25544')).toEqual(['25544'])
})

it('bounds rendered results and reports more records', () => {
  const many = Array.from({ length: 101 }, (_, index) => ({ ...entries[0], catalogId: String(index), name: `Object ${index}`, normalizedName: `object ${index}` }))
  const result = searchCatalogue(many, { query: '', group: null })
  expect(result.entries).toHaveLength(100)
  expect(result.hasMore).toBe(true)
})

it('provides a bounded whole-index quick-query result and count', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...entries[0], catalogId: `8${index}`, name: `Quick ${index}`, normalizedName: `quick ${index}` }))
  const result = runQuickCatalogueQuery(many, 'quick', 8)
  expect(result.entries).toHaveLength(8)
  expect(result.totalMatches).toBe(12)
  expect(result.hasMore).toBe(true)
  expect(runQuickCatalogueQuery(many, '   ', 8)).toEqual({ entries: [], totalMatches: 0, hasMore: false })
})
