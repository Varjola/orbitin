import { expect, it } from 'vitest'
import { CATALOGUE_DEFINITIONS, CATALOGUE_SELECTION_IDS, EXPECTED_DESIGNATORS, catalogueDefinitionProblems } from './catalogues.ts'
import { FixtureProvider } from './provider/fixture.ts'
import { buildCatalogueSnapshot } from './ingest.ts'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCatalogueShard } from '../../src/data/catalogueSchema.ts'

it('holds a well-formed set of application-owned catalogue definitions', () => {
  expect(catalogueDefinitionProblems()).toEqual([])
  expect(CATALOGUE_DEFINITIONS.map((definition) => definition.id)).toEqual(['space-stations', 'navigation', 'earth-observation', 'space-science'])
})

it('asks for every selected object exactly once, in one bounded list', () => {
  const declared = CATALOGUE_DEFINITIONS.flatMap((definition) => definition.members.map((member) => member.catalogId))
  expect(CATALOGUE_SELECTION_IDS).toHaveLength(new Set(declared).size)
  expect([...CATALOGUE_SELECTION_IDS].sort()).toEqual([...new Set(declared)].sort())
  expect(CATALOGUE_SELECTION_IDS.length).toBeLessThanOrEqual(200)
  expect(EXPECTED_DESIGNATORS.size).toBe(CATALOGUE_SELECTION_IDS.length)
})

it('keeps a catalogue identifier past the legacy five-digit limit in the published selection', () => {
  // Real published data, not only a fixture, exercises the post-five-digit path.
  expect(CATALOGUE_SELECTION_IDS.some((id) => id.length > 5)).toBe(true)
})

it('catches a curation mistake rather than publishing it', () => {
  const problems = catalogueDefinitionProblems([
    { id: 'Bad Id', title: '', purpose: '', membership: 'static', selection: '', members: [] },
    {
      id: 'duplicated', title: 'T', purpose: 'P', membership: 'static', selection: 'S',
      members: [{ catalogId: '25544', designator: '1998-067A', name: 'A' }, { catalogId: '25544', designator: '1998-067A', name: 'A' }, { catalogId: '0', designator: 'nope', name: 'B' }],
    },
  ])
  expect(problems).toEqual(expect.arrayContaining([
    expect.stringContaining('not a stable lower-case slug'),
    expect.stringContaining('has no title'),
    expect.stringContaining('has no members'),
    expect.stringContaining('lists 25544 twice'),
    expect.stringContaining('not a canonical catalogue identifier'),
    expect.stringContaining('malformed international designator'),
  ]))
})

it('publishes a complete decodable snapshot from the offline fixture provider', async () => {
  const fetched = await new FixtureProvider().fetchCurrentGp({ catalogIds: CATALOGUE_SELECTION_IDS, nowUtc: '2026-09-10T00:17:00Z' })
  expect(fetched.upstreamRequestCount).toBe(0)
  expect(fetched.rejectedCount).toBe(0)
  expect(fetched.definitions).toHaveLength(CATALOGUE_SELECTION_IDS.length)

  const snapshot = await buildCatalogueSnapshot(fetched, { nowUtc: '2026-09-10T00:17:00Z', configurationRevision: 'test', shardCount: 8 })
  expect(snapshot.missingMembers).toEqual([])
  expect(snapshot.rejections).toEqual({ unselected: 0, 'designator-mismatch': 0 })

  const manifest = decodeCatalogueManifest(JSON.parse(new TextDecoder().decode(snapshot.manifestBytes)))
  expect(manifest.groups.map((group) => group.id)).toEqual(CATALOGUE_DEFINITIONS.map((definition) => definition.id))
  expect(manifest.groups.every((group) => group.validCount === group.selectedCount)).toBe(true)
  expect(manifest.totals.deduplicatedCount).toBe(CATALOGUE_SELECTION_IDS.length)

  const index = decodeCatalogueIndex(JSON.parse(new TextDecoder().decode(snapshot.indexBytes)), manifest)
  expect(index.entries).toHaveLength(CATALOGUE_SELECTION_IDS.length)
  snapshot.shardBytes.forEach((bytes, shard) => { decodeCatalogueShard(JSON.parse(new TextDecoder().decode(bytes)), manifest, shard) })
})

it('produces byte-identical snapshots for the same inputs', async () => {
  const request = { catalogIds: CATALOGUE_SELECTION_IDS, nowUtc: '2026-09-10T00:17:00Z' }
  const options = { nowUtc: '2026-09-10T00:17:00Z', configurationRevision: 'test', shardCount: 8 } as const
  const first = await buildCatalogueSnapshot(await new FixtureProvider().fetchCurrentGp(request), options)
  const second = await buildCatalogueSnapshot(await new FixtureProvider().fetchCurrentGp(request), options)
  expect(second.snapshotId).toBe(first.snapshotId)
  expect(new TextDecoder().decode(second.manifestBytes)).toBe(new TextDecoder().decode(first.manifestBytes))
})
