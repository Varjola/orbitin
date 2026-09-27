import type { CatalogueDiscoveryPage } from '../data/catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition, CatalogueGroupDefinitionSet } from '../data/catalogueGroups.ts'

/** Test-only official-group seam proof.
 *
 * Nothing here is a production catalogue promise: production code injects the
 * empty definition set, and this module lives outside the shipped modules so
 * no fixture group or page can reach the browser bundle. The four present ids
 * are the synthetic navigation payloads added by
 * `buildAutomaticSnapshotFixture({ syntheticNavigationMembers: true })`; the
 * fifth is deliberately absent from every fixture index so the resolver's
 * missing-member report is exercised. */
export const FIXTURE_GPS_PRESENT_MEMBER_IDS = ['900011', '900012', '900013', '900014'] as const
export const FIXTURE_GPS_ABSENT_MEMBER_ID = '900015'

export const FIXTURE_GPS_GROUP_DEFINITION: CatalogueGroupDefinition = {
  id: 'gps-system', kind: 'official-system', title: 'GPS system',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: [...FIXTURE_GPS_PRESENT_MEMBER_IDS, FIXTURE_GPS_ABSENT_MEMBER_ID] },
  provenance: {
    authority: 'Orbitin test maintainer', sourceDescription: 'Synthetic automatic-profile fixture membership',
    sourceUrl: 'https://example.invalid/orbitin/gps-system', reviewedAtUtc: '2026-09-20T12:00:00Z',
  },
}

export const FIXTURE_CATALOGUE_GROUP_DEFINITIONS: CatalogueGroupDefinitionSet = {
  schemaVersion: 1, revision: 'fixture-groups-1', groups: [FIXTURE_GPS_GROUP_DEFINITION],
}

/** Fixture-only official-system Discovery Page for the group above. */
export const FIXTURE_GPS_DISCOVERY_PAGE: CatalogueDiscoveryPage = {
  id: 'gps-system', kind: 'official-system', title: 'GPS system',
  summary: 'Fixture-only reviewed membership for testing the official-group seam.',
  whyItMatters: 'This definition is synthetic and is not a production catalogue promise.',
  membership: { kind: 'official-group', groupId: 'gps-system' },
}
