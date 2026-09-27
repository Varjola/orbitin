import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the crewed space stations.
 *
 * Membership semantics: a member is the core
 * module of a crewed space station in operation on the review date (the ISS
 * per NASA, the China Space Station per the China Manned Space Agency),
 * identified by NORAD catalogue id. Separately catalogued modules, visiting
 * vehicles and deployed small satellites are not members. */
export const CREWED_SPACE_STATIONS_REVISION = CURATED_CATALOGUE.groups['crewed-space-stations'].revision

export const CREWED_SPACE_STATIONS_CATALOG_IDS = CURATED_CATALOGUE.groups['crewed-space-stations'].catalogIds

export const CREWED_SPACE_STATIONS_GROUP: CatalogueGroupDefinition = {
  id: 'crewed-space-stations',
  kind: 'official-system',
  title: 'Crewed space stations',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: CREWED_SPACE_STATIONS_CATALOG_IDS },
  provenance: {
    authority: 'NASA and the China Manned Space Agency',
    sourceDescription: `The core module of each crewed space station in operation (the International Space Station per NASA, the China Space Station per the China Manned Space Agency), identified by NORAD catalogue id through CelesTrak. Revision ${CREWED_SPACE_STATIONS_REVISION}.`,
    sourceUrl: 'https://www.nasa.gov/international-space-station/',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const CREWED_SPACE_STATIONS_PAGE: CatalogueDiscoveryPage = {
  id: 'crewed-space-stations',
  kind: 'official-system',
  title: 'Crewed space stations',
  summary: 'The crewed space stations in orbit: the International Space Station and China’s Tiangong. Each is represented by its core module.',
  whyItMatters: 'Both stations fly low, near-circular orbits, where astronauts live and work while circling Earth many times a day.',
  membership: { kind: 'official-group', groupId: 'crewed-space-stations' },
}

export const CREWED_SPACE_STATIONS_BUNDLE: OfficialGroupBundle = {
  revision: CREWED_SPACE_STATIONS_REVISION,
  group: CREWED_SPACE_STATIONS_GROUP,
  page: CREWED_SPACE_STATIONS_PAGE,
  education: {
    links: [
      { label: 'NASA: International Space Station', url: 'https://www.nasa.gov/international-space-station/' },
      { label: 'China Manned Space', url: 'https://en.cmse.gov.cn/' },
    ],
    orbitLabExample: 'leo',
  },
}
