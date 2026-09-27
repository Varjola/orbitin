import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of Norway's Arctic highly elliptical orbit satellites.
 *
 * Membership semantics: a member is a satellite of
 * Space Norway's Arctic Satellite Broadband Mission (ASBM 1 and ASBM 2)
 * listed on Space Norway's mission page on the review date, identified by
 * NORAD catalogue id through the satellite catalogue. */
export const ARCTIC_HEO_REVISION = CURATED_CATALOGUE.groups['arctic-heo'].revision

export const ARCTIC_HEO_CATALOG_IDS = CURATED_CATALOGUE.groups['arctic-heo'].catalogIds

export const ARCTIC_HEO_GROUP: CatalogueGroupDefinition = {
  id: 'arctic-heo',
  kind: 'official-system',
  title: 'Norwegian Arctic HEO satellites',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: ARCTIC_HEO_CATALOG_IDS },
  provenance: {
    authority: 'Space Norway',
    sourceDescription: `The two satellites of Space Norway’s Arctic Satellite Broadband Mission (ASBM 1 and ASBM 2) listed on Space Norway’s mission page, identified by NORAD catalogue id through the CelesTrak satellite catalogue. Revision ${ARCTIC_HEO_REVISION}.`,
    sourceUrl: 'https://spacenorway.com/infrastructure/satellite-fleet/asbm-1-asbm-2/',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const ARCTIC_HEO_PAGE: CatalogueDiscoveryPage = {
  id: 'arctic-heo',
  kind: 'official-system',
  title: 'Norwegian Arctic HEO satellites',
  summary: 'The two Space Norway satellites that bring broadband to the Arctic from highly elliptical orbits.',
  whyItMatters: 'A highly elliptical orbit lingers for hours high over the north, where geostationary satellites sit low on the horizon or cannot be seen at all.',
  membership: { kind: 'official-group', groupId: 'arctic-heo' },
}

export const ARCTIC_HEO_BUNDLE: OfficialGroupBundle = {
  revision: ARCTIC_HEO_REVISION,
  group: ARCTIC_HEO_GROUP,
  page: ARCTIC_HEO_PAGE,
  education: {
    links: [
      { label: 'Space Norway: ASBM 1 and ASBM 2', url: 'https://spacenorway.com/infrastructure/satellite-fleet/asbm-1-asbm-2/' },
    ],
    orbitLabExample: 'elliptical',
  },
}
