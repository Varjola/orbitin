import { expect, it } from 'vitest'
import { CatalogueClient } from './CatalogueClient.ts'
import { catalogueProfileMode } from './catalogueProfile.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from './fixtures/automaticCatalogueSnapshot.ts'
import { EMPTY_CATALOGUE_QUERY } from './catalogueQuery.ts'
import { legacySnapshotPayloads } from '../test-fixtures/legacyCatalogueSnapshot.ts'

it('validates the pointer chain, shares shard fetches and keeps the last good snapshot', async () => {
  const payloads = await legacySnapshotPayloads('2026-09-10T00:17:00Z')
  const calls = new Map<string, number>()
  const fetchImpl: typeof fetch = async (input) => {
    const path = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    calls.set(path, (calls.get(path) ?? 0) + 1)
    const bytes = payloads.get(path)
    return bytes ? new Response(new Uint8Array(bytes).buffer, { status: 200 }) : new Response(null, { status: 503 })
  }
  const client = new CatalogueClient({ fetch: fetchImpl, pointerSessionTtlMs: 0 })
  const loaded = await client.load()
  expect(loaded.manifest.snapshotId).toBeTruthy()
  await Promise.all([client.loadRecord('700001'), client.loadRecord('700001')])
  const shard = loaded.index.entries[0].shard
  expect(calls.get(loaded.manifest.shards[shard].path)).toBe(1)
  const before = client.current
  payloads.set('/catalog/v1/current.json', new TextEncoder().encode('{"schemaVersion":1}'))
  await expect(client.refresh()).rejects.toThrow('last valid catalogue')
  expect(client.current).toBe(before)
  client.dispose()
})

function servingFetch(payloads: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return async (input) => {
    const path = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    const bytes = payloads.get(path)
    return bytes ? new Response(new Uint8Array(bytes).buffer, { status: 200 }) : new Response(null, { status: 404 })
  }
}

it('loads a complete automatic snapshot and refuses a record that disagrees with its index entry', async () => {
  const client = new CatalogueClient({ fetch: servingFetch(await servedSnapshotPayloads(buildAutomaticSnapshotFixture())), pointerSessionTtlMs: 0 })
  const loaded = await client.load()
  expect(catalogueProfileMode(loaded.manifest)).toBe('automatic')
  expect((await client.loadRecord('900001')).source?.object.typeCategory).toBe('payload')
  client.dispose()

  // Every hash is valid, so only the cross-part consistency check can catch it.
  const tampered = buildAutomaticSnapshotFixture()
  tampered.index.entries.find((entry: { catalogId: string }) => entry.catalogId === '900001').src.c = 'US'
  const strict = new CatalogueClient({ fetch: servingFetch(await servedSnapshotPayloads(tampered)), pointerSessionTtlMs: 0 })
  await strict.load()
  await expect(strict.loadRecord('900001')).rejects.toThrow('does not match its search index entry')
  strict.dispose()
})

it('queries the loaded snapshot with manifest-declared automatic facets', async () => {
  const client = new CatalogueClient({ fetch: servingFetch(await servedSnapshotPayloads(buildAutomaticSnapshotFixture())), pointerSessionTtlMs: 0 })
  const loaded = await client.load()
  const result = client.query(EMPTY_CATALOGUE_QUERY, Date.parse('2026-09-15T00:00:00Z'))
  expect(result.totalMatches).toBe(3)
  expect(result.entries.map((entry) => entry.catalogId)).toEqual(['900001', '900002', '900003'])
  expect(result.facets?.typeCategories.payload).toBe(1)
  expect(result.facets?.primaryOrbitClasses.geosynchronous).toBe(1)
  expect(loaded.manifest.catalogueProfile?.contractVersion).toBe(1)
  client.dispose()
})
