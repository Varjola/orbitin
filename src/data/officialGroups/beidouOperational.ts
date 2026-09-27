import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the BeiDou constellation.
 *
 * Membership semantics: a member is a
 * BeiDou satellite (BDS-2 or BDS-3; medium Earth, inclined geosynchronous or
 * geostationary orbit) marked Operational in the China Satellite Navigation
 * Office Test and Assessment Research Center constellation status on the
 * review date, identified by the NORAD catalogue id published there.
 * Decommissioned and experimental satellites still in orbit are not members.
 * Updates are manual re-reviews with a new revision and new evidence. */
export const BEIDOU_OPERATIONAL_REVISION = CURATED_CATALOGUE.groups['beidou-operational'].revision

export const BEIDOU_OPERATIONAL_CATALOG_IDS = CURATED_CATALOGUE.groups['beidou-operational'].catalogIds

export const BEIDOU_OPERATIONAL_GROUP: CatalogueGroupDefinition = {
  id: 'beidou-operational',
  kind: 'official-system',
  title: 'BeiDou constellation',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: BEIDOU_OPERATIONAL_CATALOG_IDS },
  provenance: {
    authority: 'Test and Assessment Research Center of China Satellite Navigation Office',
    sourceDescription: `BeiDou satellites marked Operational in the China Satellite Navigation Office Test and Assessment Research Center constellation status, identified by the NORAD catalogue id published there and checked against CelesTrak. Revision ${BEIDOU_OPERATIONAL_REVISION}.`,
    sourceUrl: 'https://www.csno-tarc.cn/status/constellation?lang=en',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const BEIDOU_OPERATIONAL_PAGE: CatalogueDiscoveryPage = {
  id: 'beidou-operational',
  kind: 'official-system',
  title: 'BeiDou constellation',
  summary: 'The Chinese navigation satellites marked operational in the reviewed BeiDou roster, in three kinds of orbit. Membership is a reviewed roster, not a live health status.',
  whyItMatters: 'BeiDou mixes medium Earth orbits for worldwide coverage with geostationary and inclined geosynchronous satellites that stay high over Asia.',
  membership: { kind: 'official-group', groupId: 'beidou-operational' },
}

export const BEIDOU_OPERATIONAL_BUNDLE: OfficialGroupBundle = {
  revision: BEIDOU_OPERATIONAL_REVISION,
  group: BEIDOU_OPERATIONAL_GROUP,
  page: BEIDOU_OPERATIONAL_PAGE,
  education: {
    links: [
      { label: 'BeiDou Navigation Satellite System', url: 'http://en.beidou.gov.cn/' },
      { label: 'CSNO-TARC: Constellation status', url: 'https://www.csno-tarc.cn/status/constellation?lang=en' },
    ],
    orbitLabExample: 'geo',
  },
}
