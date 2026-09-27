import { expect, it } from 'vitest'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { decodeCatalogueManifest, decodeCatalogueShard, type CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { buildComparisonTable, comparisonFocusCandidates, MAX_COMPARED_RECORDS, type CatalogueComparisonItem } from './catalogueComparison.ts'

function record(): CatalogueRecordV1 {
  const fixture = buildAutomaticSnapshotFixture(); const manifest = decodeCatalogueManifest(fixture.manifest)
  return decodeCatalogueShard(fixture.shards[0], manifest, 0).records['900001']
}

it('keeps insertion order and labels provider and derived values separately', () => {
  const loaded = record()
  const legacy = { ...loaded } as CatalogueRecordV1 & { source?: unknown; derived?: unknown }
  delete legacy.source; delete legacy.derived
  const table = buildComparisonTable([
    { catalogId: '900001', name: 'Automatic', state: 'loaded', record: loaded },
    { catalogId: '900002', name: 'Legacy', state: 'loaded', record: legacy },
  ])
  expect(table.columns.map((column) => column.catalogId)).toEqual(['900001', '900002'])
  expect(table.rows.map((row) => row.label)).toContain('Object type (provider)')
  expect(table.rows.map((row) => row.label)).toContain('Perigee altitude (derived)')
  expect(table.rows.find((row) => row.label === 'Object type (provider)')?.values).toEqual(['PAYLOAD', '—'])
  expect(table.rows.find((row) => row.label === 'Perigee altitude (derived)')?.values[1]).toBe('—')
})

it('keeps loading and failed columns rectangular without fabricating values', () => {
  const items: CatalogueComparisonItem[] = [
    { catalogId: '1', name: 'Loading', state: 'loading' },
    { catalogId: '2', name: 'Failed', state: 'error', failure: { kind: 'http', message: 'Catalogue request failed with HTTP 503.', status: 503 } },
  ]
  const table = buildComparisonTable(items)
  expect(table.columns[1].failure?.kind).toBe('http')
  expect(table.rows.every((row) => row.values.length === items.length && row.values.every((value) => value === '—'))).toBe(true)
  expect(MAX_COMPARED_RECORDS).toBe(4)
})

it('keeps focus on a stable Compare control when the panel re-renders', () => {
  // A background load for another column keeps focus on the same control.
  expect(comparisonFocusCandidates({ action: 'compare-remove', catalogId: 'a', column: 0 }, ['a', 'b'])[0]).toEqual({ action: 'compare-remove', catalogId: 'a' })
  // Retry disappears while the column loads again: fall back to that column's Remove.
  expect(comparisonFocusCandidates({ action: 'compare-retry', catalogId: 'b', column: 1 }, ['a', 'b'])).toEqual([{ action: 'compare-retry', catalogId: 'b' }, { action: 'compare-remove', catalogId: 'b' }])
  // Removing a column moves to the column that took its place, or the new last column.
  expect(comparisonFocusCandidates({ action: 'compare-remove', catalogId: 'b', column: 1 }, ['a', 'c'])).toEqual([{ action: 'compare-remove', catalogId: 'c' }])
  expect(comparisonFocusCandidates({ action: 'compare-remove', catalogId: 'c', column: 2 }, ['a', 'b'])).toEqual([{ action: 'compare-remove', catalogId: 'b' }])
  // Clear, or removing the last column, leaves nothing in the panel: the caller focuses the Compare tab.
  expect(comparisonFocusCandidates({ action: 'compare-clear', catalogId: null, column: -1 }, [])).toEqual([])
  expect(comparisonFocusCandidates({ action: 'compare-remove', catalogId: 'a', column: 0 }, [])).toEqual([])
  expect(comparisonFocusCandidates({ action: 'compare-clear', catalogId: null, column: -1 }, ['a'])).toEqual([{ action: 'compare-clear', catalogId: null }])
})
