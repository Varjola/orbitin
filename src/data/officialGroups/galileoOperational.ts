import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the Galileo constellation.
 *
 * Membership semantics: a member is a
 * satellite the European GNSS Service Centre places in the Galileo reference
 * constellation on the review date, in one of its 24 nominal or 6 auxiliary
 * slots, identified by NORAD catalogue id. Signal status is not membership:
 * GSAT0201 and GSAT0202, in eccentric auxiliary orbits and marked not usable,
 * stay members; satellites the GSC lists as removed from active service do
 * not. Updates are manual re-reviews with a new revision and new evidence. */
export const GALILEO_OPERATIONAL_REVISION = CURATED_CATALOGUE.groups['galileo-operational'].revision

export const GALILEO_OPERATIONAL_CATALOG_IDS = CURATED_CATALOGUE.groups['galileo-operational'].catalogIds

export const GALILEO_OPERATIONAL_GROUP: CatalogueGroupDefinition = {
  id: 'galileo-operational',
  kind: 'official-system',
  title: 'Galileo constellation',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: GALILEO_OPERATIONAL_CATALOG_IDS },
  provenance: {
    authority: 'European GNSS Service Centre',
    sourceDescription: `Galileo satellites the European GNSS Service Centre places in the reference constellation (24 nominal and 6 auxiliary slots), whatever their signal status, identified by NORAD catalogue id through the CelesTrak galileo element set cross-reference. Revision ${GALILEO_OPERATIONAL_REVISION}.`,
    sourceUrl: 'https://www.gsc-europa.eu/system-service-status/constellation-information',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const GALILEO_OPERATIONAL_PAGE: CatalogueDiscoveryPage = {
  id: 'galileo-operational',
  kind: 'official-system',
  title: 'Galileo constellation',
  summary: 'The European navigation satellites in the reviewed Galileo reference constellation. Membership is a reviewed roster, not a live health status: a listed satellite may currently be marked not usable.',
  whyItMatters: 'Three orbital planes in medium Earth orbit give Europe its own global navigation system, and receivers that combine it with GPS see many more satellites at once.',
  membership: { kind: 'official-group', groupId: 'galileo-operational' },
}

export const GALILEO_OPERATIONAL_BUNDLE: OfficialGroupBundle = {
  revision: GALILEO_OPERATIONAL_REVISION,
  group: GALILEO_OPERATIONAL_GROUP,
  page: GALILEO_OPERATIONAL_PAGE,
  education: {
    links: [
      { label: 'European GNSS Service Centre: What is Galileo', url: 'https://www.gsc-europa.eu/galileo/what-is-galileo' },
      { label: 'EUSPA: Galileo', url: 'https://www.euspa.europa.eu/eu-space-programme/galileo' },
    ],
    orbitLabExample: 'meo',
  },
}
