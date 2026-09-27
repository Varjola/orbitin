import { expect, it } from 'vitest'
import { searchCatalogue } from '../data/catalogueSearch.ts'
import { decodeCatalogueIndex, type CatalogueManifestV1 } from '../data/catalogueSchema.ts'
import {
  GENERATED_CATALOGUE_ENTRY_COUNT, GENERATED_CATALOGUE_PROFILE, GENERATED_CATALOGUE_SHARD_COUNT,
  GENERATED_CATALOGUE_SNAPSHOT_ID, generateCatalogueIndex,
} from './generatedCatalogueIndex.ts'

const manifest = {
  schemaVersion: 1,
  snapshotId: GENERATED_CATALOGUE_SNAPSHOT_ID,
  shardCount: GENERATED_CATALOGUE_SHARD_COUNT,
  catalogueProfile: GENERATED_CATALOGUE_PROFILE,
} as CatalogueManifestV1

it('generates exactly 40,000 unique canonical automatic-profile entries', () => {
  const index = generateCatalogueIndex()
  expect(index.entries).toHaveLength(GENERATED_CATALOGUE_ENTRY_COUNT)
  expect(new Set(index.entries.map((entry) => entry.catalogId)).size).toBe(GENERATED_CATALOGUE_ENTRY_COUNT)
  expect(index.entries.every((entry) => /^[1-9]\d{0,8}$/.test(entry.catalogId))).toBe(true)
  expect(() => decodeCatalogueIndex(index, manifest)).not.toThrow()
})

it('covers representative types, orbit classes, designators and compact projections', () => {
  const entries = generateCatalogueIndex().entries
  expect(new Set(entries.map((entry) => entry.src?.k))).toEqual(new Set(['pay', 'rb', 'deb', 'unk']))
  expect(new Set(entries.map((entry) => entry.drv?.o))).toEqual(new Set(['leo', 'meo', 'high', 'geo', 'ellip', 'cross']))
  expect(entries.some((entry) => entry.internationalDesignator === null)).toBe(true)
  expect(entries.some((entry) => entry.internationalDesignator !== null)).toBe(true)
  expect(entries.every((entry) => entry.src?.t !== undefined && entry.src.k !== undefined && entry.drv !== undefined)).toBe(true)
})

it('is deterministic and preserves repeatable id ranking', () => {
  const first = generateCatalogueIndex()
  const second = generateCatalogueIndex()
  expect(first).toEqual(second)

  const result = searchCatalogue(first.entries, { query: '10000', group: null, limit: 8 })
  expect(result.entries.map((entry) => entry.catalogId)).toEqual(['100000', '100001', '100002', '100003', '100004', '100005', '100006', '100007'])
  expect(searchCatalogue(first.entries, { query: 'rocket body', group: null, limit: 8 }).entries.every((entry) => entry.src?.k === 'rb')).toBe(true)
})
