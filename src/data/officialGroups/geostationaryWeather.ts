import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

/** Reviewed membership of the geostationary weather satellites.
 *
 * Membership semantics: a member is the primary
 * operational meteorological imaging satellite at a nominal longitude of the
 * WMO OSCAR/Space geostationary core constellation on the review date, whose
 * satellite-catalogue orbit confirms that slot. Stand-by, back-up and
 * commissioning satellites are not members, and where two share a slot the
 * newer generation is. Updates are manual re-reviews with a new revision. */
export const GEOSTATIONARY_WEATHER_REVISION = CURATED_CATALOGUE.groups['geostationary-weather'].revision

export const GEOSTATIONARY_WEATHER_CATALOG_IDS = CURATED_CATALOGUE.groups['geostationary-weather'].catalogIds

export const GEOSTATIONARY_WEATHER_GROUP: CatalogueGroupDefinition = {
  id: 'geostationary-weather',
  kind: 'official-system',
  title: 'Geostationary weather satellites',
  membership: { kind: 'reviewed-catalog-ids', catalogIds: GEOSTATIONARY_WEATHER_CATALOG_IDS },
  provenance: {
    authority: 'WMO OSCAR/Space',
    sourceDescription: `The primary operational meteorological imaging satellite at each nominal longitude of the WMO OSCAR/Space geostationary core constellation, where the satellite is operational in OSCAR and its catalogue orbit confirms the slot, identified by NORAD catalogue id through CelesTrak. Revision ${GEOSTATIONARY_WEATHER_REVISION}.`,
    sourceUrl: 'https://space.oscar.wmo.int/satellitestatuses/status',
    reviewedAtUtc: '2026-09-26T00:00:00Z',
  },
}

export const GEOSTATIONARY_WEATHER_PAGE: CatalogueDiscoveryPage = {
  id: 'geostationary-weather',
  kind: 'official-system',
  title: 'Geostationary weather satellites',
  summary: 'The main weather-imaging satellites of the geostationary ring, one for each position the world’s weather services share. Stand-by and back-up satellites are left out.',
  whyItMatters: 'From geostationary orbit a satellite watches the same half of Earth all the time, so forecasters can follow storms as they grow.',
  membership: { kind: 'official-group', groupId: 'geostationary-weather' },
}

export const GEOSTATIONARY_WEATHER_BUNDLE: OfficialGroupBundle = {
  revision: GEOSTATIONARY_WEATHER_REVISION,
  group: GEOSTATIONARY_WEATHER_GROUP,
  page: GEOSTATIONARY_WEATHER_PAGE,
  education: {
    links: [
      { label: 'WMO OSCAR/Space: Satellite status', url: 'https://space.oscar.wmo.int/satellitestatuses/status' },
      { label: 'NOAA NESDIS: Geostationary satellites', url: 'https://www.nesdis.noaa.gov/our-satellites/currently-flying/geostationary-satellites' },
    ],
    orbitLabExample: 'geo',
  },
}
