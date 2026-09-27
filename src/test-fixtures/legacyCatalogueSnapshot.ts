import { parseOmmJson } from '../data/omm.ts'
import { buildCatalogueSnapshot } from '../../workers/catalogue/ingest.ts'
import { sha256Hex, stableJson, type CataloguePointerV1 } from '../data/catalogueSchema.ts'

/** A complete one-record legacy-profile publication served from same-origin
 * paths. The fixture is generated through the real legacy snapshot builder so
 * client/controller tests exercise the pointer, manifest and index contract. */
export async function legacySnapshotPayloads(nowUtc: string): Promise<Map<string, Uint8Array>> {
  const parsed = parseOmmJson(JSON.stringify({
    OBJECT_NAME: 'Client Fixture', OBJECT_ID: '2026-001A', EPOCH: '2026-03-20T12:00:00Z',
    MEAN_MOTION: 15, ECCENTRICITY: 0.001, INCLINATION: 51, RA_OF_ASC_NODE: 120,
    ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 220, EPHEMERIS_TYPE: 0,
    NORAD_CAT_ID: '700001', BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  }))
  if (!parsed.ok) throw new Error('The legacy catalogue fixture did not parse.')
  const snapshot = await buildCatalogueSnapshot(
    {
      providerId: 'fixture', providerName: 'Local fixture', providerHomepage: 'https://example.invalid/',
      sourceAuthority: 'Synthetic fixture data', retrievedAtUtc: nowUtc,
      upstreamRequestCount: 0, receivedCount: 1, rejectedCount: 0,
      definitions: [parsed.definition],
    },
    {
      nowUtc, configurationRevision: 'test', shardCount: 8,
      definitions: [{ id: 'space-science', title: 'Science', purpose: 'Observatories.', membership: 'static', selection: 'One record.', members: [{ catalogId: '700001', designator: '2026-001A', name: 'Client Fixture' }] }],
    },
  )
  const manifestPath = `/catalog/v1/snapshots/${snapshot.snapshotId}/manifest.json`
  const pointer: CataloguePointerV1 = {
    schemaVersion: 1, snapshotId: snapshot.snapshotId,
    publishedAtUtc: snapshot.manifest.generatedAtUtc,
    providerRetrievedAtUtc: snapshot.manifest.provider.retrievedAtUtc,
    manifestPath, manifestSha256: await sha256Hex(snapshot.manifestBytes),
  }
  return new Map<string, Uint8Array>([
    ['/catalog/v1/current.json', new TextEncoder().encode(stableJson(pointer))],
    ...[...snapshot.bytes].map(([key, bytes]) => [`/${key}`, bytes] as const),
  ])
}
