import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the GLONASS constellation.
 *
 * Membership semantics: a member is a
 * satellite the Information and Analysis Center for Positioning, Navigation
 * and Timing counts in the GLONASS constellation on the review date, in
 * operation or under check by its prime contractor, identified by NORAD
 * catalogue id matched by COSMOS number. Two ids the IAC published wrongly
 * were corrected from the satellite catalogue and are recorded in the
 * evidence. Updates are manual re-reviews with a new revision and evidence. */
export const GLONASS_OPERATIONAL_REVISION = CURATED_CATALOGUE.groups['glonass-operational'].revision

export const GLONASS_OPERATIONAL_CATALOG_IDS = CURATED_CATALOGUE.groups['glonass-operational'].catalogIds

export const GLONASS_OPERATIONAL_GROUP: CatalogueGroupDefinition = {
  id: 'glonass-operational',
  kind: 'official-system',
  title: 'GLONASS constellation',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: GLONASS_OPERATIONAL_CATALOG_IDS },
  provenance: {
    authority: 'Information and Analysis Center for Positioning, Navigation and Timing (Roscosmos)',
    sourceDescription: `GLONASS satellites the Information and Analysis Center for PNT counts in the constellation (in operation, or under check by the prime contractor), identified by NORAD catalogue id through the COSMOS number and the CelesTrak glo-ops element set cross-reference. Revision ${GLONASS_OPERATIONAL_REVISION}.`,
    sourceUrl: 'https://glonass-iac.ru/en/sostavOG/',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const GLONASS_OPERATIONAL_PAGE: CatalogueDiscoveryPage = {
  id: 'glonass-operational',
  kind: 'official-system',
  title: 'GLONASS constellation',
  summary: 'The Russian navigation satellites counted in the reviewed GLONASS constellation. Membership is a reviewed roster, not a live health status: a listed satellite may be under check and not transmitting for navigation.',
  whyItMatters: 'A steeper orbital tilt than GPS keeps more of these medium Earth orbit satellites high in the sky over the far north.',
  membership: { kind: 'official-group', groupId: 'glonass-operational' },
}

export const GLONASS_OPERATIONAL_BUNDLE: OfficialGroupBundle = {
  revision: GLONASS_OPERATIONAL_REVISION,
  group: GLONASS_OPERATIONAL_GROUP,
  page: GLONASS_OPERATIONAL_PAGE,
  education: {
    links: [
      { label: 'IAC: About GLONASS', url: 'https://glonass-iac.ru/en/about_glonass/' },
      { label: 'IAC: GLONASS constellation status', url: 'https://glonass-iac.ru/en/sostavOG/' },
    ],
    orbitLabExample: 'meo',
  },
}
