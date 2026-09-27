import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the Copernicus Sentinels.
 *
 * Membership semantics: a member is a
 * free-flying Copernicus Sentinel satellite that ESA or EUMETSAT lists as in
 * orbit and in service (operational, extension campaign or commissioning) on
 * the review date, identified by NORAD catalogue id. Retired Sentinels and
 * the Sentinel-4 and Sentinel-5 instruments hosted on other satellites are
 * not members. Updates are manual re-reviews with a new revision. */
export const COPERNICUS_SENTINELS_REVISION = CURATED_CATALOGUE.groups['copernicus-sentinels'].revision

export const COPERNICUS_SENTINELS_CATALOG_IDS = CURATED_CATALOGUE.groups['copernicus-sentinels'].catalogIds

export const COPERNICUS_SENTINELS_GROUP: CatalogueGroupDefinition = {
  id: 'copernicus-sentinels',
  kind: 'official-system',
  title: 'Copernicus Sentinels',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: COPERNICUS_SENTINELS_CATALOG_IDS },
  provenance: {
    authority: 'European Space Agency and EUMETSAT',
    sourceDescription: `Free-flying Copernicus Sentinel satellites that ESA or EUMETSAT list as in orbit and in service (operational, extension campaign or commissioning), identified by NORAD catalogue id through CelesTrak; retired Sentinel-1A and Sentinel-1B and the hosted Sentinel-4 and Sentinel-5 instruments are excluded. Revision ${COPERNICUS_SENTINELS_REVISION}.`,
    sourceUrl: 'https://www.esa.int/Applications/Observing_the_Earth/Copernicus/The_Sentinel_missions',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const COPERNICUS_SENTINELS_PAGE: CatalogueDiscoveryPage = {
  id: 'copernicus-sentinels',
  kind: 'official-system',
  title: 'Copernicus Sentinels',
  summary: 'The European Union’s Copernicus Earth observation satellites that are in service, from radar imagers to sea-level altimeters.',
  whyItMatters: 'Most Sentinels fly Sun-synchronous orbits, so they pass over each place at the same local time and see it in similar light.',
  membership: { kind: 'official-group', groupId: 'copernicus-sentinels' },
}

export const COPERNICUS_SENTINELS_BUNDLE: OfficialGroupBundle = {
  revision: COPERNICUS_SENTINELS_REVISION,
  group: COPERNICUS_SENTINELS_GROUP,
  page: COPERNICUS_SENTINELS_PAGE,
  education: {
    links: [
      { label: 'ESA: The Sentinel missions', url: 'https://www.esa.int/Applications/Observing_the_Earth/Copernicus/The_Sentinel_missions' },
      { label: 'Copernicus: About Copernicus', url: 'https://www.copernicus.eu/en/about-copernicus' },
    ],
    orbitLabExample: 'sso',
  },
}
