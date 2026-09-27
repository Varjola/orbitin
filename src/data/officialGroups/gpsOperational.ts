import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the operational GPS constellation.
 *
 * Membership semantics: a member is a space
 * vehicle listed in the U.S. Coast Guard Navigation Center GPS Constellation
 * Status table on the review date, identified by NORAD catalogue id. PRN, SVN,
 * plane and block are informational. Signal health is not membership: a
 * vehicle marked unusable stays a member while NAVCEN lists it.
 *
 * Updates are manual re-reviews with a new revision and new evidence; nothing
 * here changes automatically, and it never overrides catalogue validity.
 * Members absent from the loaded catalogue are reported, never added. */
export const GPS_OPERATIONAL_REVISION = CURATED_CATALOGUE.groups['gps-operational'].revision

export const GPS_OPERATIONAL_CATALOG_IDS = CURATED_CATALOGUE.groups['gps-operational'].catalogIds

export const GPS_OPERATIONAL_GROUP: CatalogueGroupDefinition = {
  id: 'gps-operational',
  kind: 'official-system',
  title: 'GPS constellation',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: GPS_OPERATIONAL_CATALOG_IDS },
  provenance: {
    authority: 'U.S. Coast Guard Navigation Center GPS Constellation Status',
    sourceDescription: `Vehicles listed on the NAVCEN GPS Constellation Status page, identified by NORAD catalogue id through the CelesTrak gps-ops element set cross-reference. Revision ${GPS_OPERATIONAL_REVISION}.`,
    sourceUrl: 'https://www.navcen.uscg.gov/gps-constellation',
    reviewedAtUtc: '2026-09-24T00:00:00Z',
  },
}

/** The Discovery Page ships with its definition as one bundle, so a page can
 *  never reference a missing group. */
export const GPS_OPERATIONAL_PAGE: CatalogueDiscoveryPage = {
  id: 'gps-operational',
  kind: 'official-system',
  title: 'GPS constellation',
  summary: 'The navigation satellites listed in the reviewed GPS constellation roster. Membership is a reviewed roster, not a live health status: a listed satellite may currently be marked unusable.',
  whyItMatters: 'Six orbital planes of medium Earth orbit satellites let receivers almost anywhere see enough of them at once to compute a position.',
  membership: { kind: 'official-group', groupId: 'gps-operational' },
}

export const GPS_OPERATIONAL_BUNDLE: OfficialGroupBundle = {
  revision: GPS_OPERATIONAL_REVISION,
  group: GPS_OPERATIONAL_GROUP,
  page: GPS_OPERATIONAL_PAGE,
  education: {
    links: [
      { label: 'GPS.gov: Space Segment', url: 'https://www.gps.gov/systems/gps/space/' },
      { label: 'NAVCEN: GPS Constellation Status', url: 'https://www.navcen.uscg.gov/gps-constellation' },
    ],
    orbitLabExample: 'meo',
  },
}
