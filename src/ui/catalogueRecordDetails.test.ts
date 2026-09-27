import { expect, it } from 'vitest'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { decodeCatalogueManifest, decodeCatalogueShard, type CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { buildCatalogueRecordDetails } from './catalogueRecordDetails.ts'

function automaticRecord(): { record: CatalogueRecordV1; manifest: ReturnType<typeof decodeCatalogueManifest> } {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const shard = decodeCatalogueShard(fixture.shards[0], manifest, 0)
  return { record: shard.records['900001'], manifest }
}

it('builds automatic details with source and derived groups', () => {
  const { record, manifest } = automaticRecord()
  const groups = buildCatalogueRecordDetails(record, manifest, Date.parse('2026-09-15T00:00:00Z'))
  expect(groups.map((group) => group.heading)).toEqual(['Identity', 'Synthetic automatic fixture information', 'Element set', 'Derived by Orbitin', 'Time since launch'])
  expect(groups[1].rows).toContainEqual({ label: 'Object type', value: 'PAYLOAD' })
  expect(groups[2].rows).toContainEqual({ label: 'Inclination (deg)', value: '51.64' })
  expect(groups[3].rows.some((row) => row.label === 'Primary orbit class')).toBe(true)
  expect(groups.flatMap((group) => group.rows).map((row) => `${row.label} ${row.value}`).join(' ')).not.toMatch(/\bactive\b|operational|status/i)
})

it('omits missing optional source rows and preserves legacy absence', () => {
  const { record, manifest } = automaticRecord()
  const withoutOptional = { ...record, source: { ...record.source, object: { type: record.source!.object.type }, gp: {} } }
  const groups = buildCatalogueRecordDetails(withoutOptional, manifest, Date.parse('2026-09-15T00:00:00Z'))
  expect(groups[1].rows.some((row) => row.label === 'Country or source code')).toBe(false)
  const legacy = { ...record } as CatalogueRecordV1 & { source?: unknown; derived?: unknown }
  delete legacy.source; delete legacy.derived
  const legacyGroups = buildCatalogueRecordDetails(legacy, manifest, Date.parse('2026-09-15T00:00:00Z'))
  expect(legacyGroups.map((group) => group.heading)).toEqual(['Identity', 'Element set', 'Catalogue metadata'])
})

it('renders signed element age and launch timing deterministically', () => {
  const { record, manifest } = automaticRecord()
  const before = buildCatalogueRecordDetails(record, manifest, Date.parse('2026-09-10T00:00:00Z'))
  const after = buildCatalogueRecordDetails(record, manifest, Date.parse('2026-09-15T00:00:00Z'))
  expect(before[2].rows.find((row) => row.label === 'Element age')?.value).toContain('after now')
  expect(after[2].rows.find((row) => row.label === 'Element age')?.value).toContain('before now')
  expect(after.at(-1)?.rows[0].value).toMatch(/^About \d+ years$/)
})
