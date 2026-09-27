import { expect, it } from 'vitest'
import { parseOmmJson, type OmmDefinition } from '../../src/data/omm.ts'
import { buildCatalogueSnapshot } from './ingest.ts'
import type { CatalogueDefinition } from './catalogues.ts'
import type { GpFetchResult } from './provider/types.ts'

function record(id: string, designator: string, name: string, overrides: Record<string, unknown> = {}): OmmDefinition {
  const parsed = parseOmmJson(JSON.stringify({
    OBJECT_NAME: name, OBJECT_ID: designator, EPOCH: '2026-03-20T12:00:00Z', MEAN_MOTION: 15, ECCENTRICITY: 0.001,
    INCLINATION: 51, RA_OF_ASC_NODE: 120, ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 220, EPHEMERIS_TYPE: 0,
    NORAD_CAT_ID: id, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0, ...overrides,
  }))
  if (!parsed.ok) throw new Error(parsed.errors.map((error) => error.message).join('; '))
  return parsed.definition
}

function fetched(definitions: readonly OmmDefinition[], overrides: Partial<GpFetchResult> = {}): GpFetchResult {
  return {
    providerId: 'test-provider', providerName: 'Test provider', providerHomepage: 'https://example.invalid/',
    sourceAuthority: 'Test authority', retrievedAtUtc: '2026-09-10T00:17:00Z', upstreamRequestCount: 3,
    receivedCount: definitions.length, rejectedCount: 0, definitions, ...overrides,
  }
}

const STATIONS: CatalogueDefinition = {
  id: 'space-stations', title: 'Crewed space stations', purpose: 'Stations.', membership: 'static',
  selection: 'Two station cores.',
  members: [{ catalogId: '100', designator: '1998-067A', name: 'Alpha' }, { catalogId: '200000', designator: '2021-035A', name: 'Beta' }],
}
const SCIENCE: CatalogueDefinition = {
  id: 'space-science', title: 'Science', purpose: 'Observatories.', membership: 'static',
  selection: 'One observatory.',
  members: [{ catalogId: '100', designator: '1998-067A', name: 'Alpha' }],
}

const BUILD = { nowUtc: '2026-09-10T00:17:00Z', configurationRevision: 'test' } as const

it('partitions one batched provider response into the application-owned catalogues', async () => {
  const alpha = record('000100', '1998-067A', 'Alpha')
  const beta = record('200000', '2021-035A', 'Beta')
  const snapshot = await buildCatalogueSnapshot(fetched([alpha, beta]), { ...BUILD, definitions: [STATIONS, SCIENCE], shardCount: 8 })
  expect(snapshot.manifest.totals.deduplicatedCount).toBe(2)
  expect(snapshot.index.entries.find((entry) => entry.catalogId === '100')?.groups).toEqual(['space-science', 'space-stations'])
  expect(snapshot.shards).toHaveLength(8)
  expect(snapshot.manifest.shards.every((shard) => shard.sha256.length === 64)).toBe(true)
  expect(snapshot.manifest.index.byteLength).toBe(snapshot.indexBytes.byteLength)
  expect(snapshot.manifest.groups.map((group) => group.id)).toEqual(['space-stations', 'space-science'])
  expect(snapshot.manifest.groups[0]).toMatchObject({ selectedCount: 2, receivedCount: 2, validCount: 2, rejectedCount: 0, membership: 'static' })
})

it('records provider provenance without letting the provider shape the catalogue', async () => {
  const snapshot = await buildCatalogueSnapshot(fetched([record('100', '1998-067A', 'Alpha')]), { ...BUILD, definitions: [SCIENCE] })
  expect(snapshot.manifest.provider).toMatchObject({ id: 'test-provider', name: 'Test provider', wireFormat: 'omm-keyed-json' })
  const shard = snapshot.shards.find((candidate) => Object.keys(candidate.records).length > 0)!
  expect(Object.values(shard.records)[0].provenance).toMatchObject({ kind: 'catalogue', providerId: 'test-provider', groups: ['space-science'] })
  // The catalogue ids in a published record are the application's own, never an
  // upstream group name.
  expect(JSON.stringify(snapshot.manifest)).not.toMatch(/GROUP=|basicspacedata|celestrak/i)
})

it('refuses a record whose international designator disagrees with the curated member', async () => {
  const impostor = record('100', '1999-001A', 'Not Alpha')
  await expect(buildCatalogueSnapshot(fetched([impostor]), { ...BUILD, definitions: [SCIENCE] }))
    .rejects.toThrow('retained no valid record')
})

it('reports selected members the provider did not return without failing the run', async () => {
  const snapshot = await buildCatalogueSnapshot(fetched([record('100', '1998-067A', 'Alpha')]), { ...BUILD, definitions: [STATIONS] })
  expect(snapshot.missingMembers).toEqual(['200000'])
  expect(snapshot.manifest.groups[0]).toMatchObject({ selectedCount: 2, receivedCount: 1, validCount: 1 })
})

it('rejects conflicting duplicate propagation records and suspicious drops', async () => {
  const alpha = record('100', '1998-067A', 'Alpha')
  const conflict: OmmDefinition = { ...alpha, meanElements: { ...alpha.meanElements, meanAnomalyRad: alpha.meanElements.meanAnomalyRad + 0.1 } }
  await expect(buildCatalogueSnapshot(fetched([alpha, conflict], { receivedCount: 2 }), { ...BUILD, definitions: [SCIENCE] })).rejects.toThrow('Conflicting')

  const wide: CatalogueDefinition = {
    ...SCIENCE,
    members: Array.from({ length: 10 }, (_, index) => ({ catalogId: String(index + 1), designator: '1998-067A', name: `Object ${index}` })),
  }
  const full = await buildCatalogueSnapshot(
    fetched(Array.from({ length: 10 }, (_, index) => record(String(index + 1), '1998-067A', `Object ${index}`)), { receivedCount: 10 }),
    { ...BUILD, nowUtc: '2026-09-09T00:17:00Z', definitions: [wide] },
  )
  await expect(buildCatalogueSnapshot(fetched([record('1', '1998-067A', 'Object 0')]), { ...BUILD, definitions: [wide], previousManifest: full.manifest }))
    .rejects.toThrow('dropped')
})
