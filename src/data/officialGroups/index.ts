import type { CatalogueDiscoveryPage } from '../catalogueDiscoveryPages.ts'
import type { CatalogueGroupDefinition } from '../catalogueGroups.ts'
import { CURATED_CATALOGUE } from '../curatedCatalogue.ts'
import { ARCTIC_HEO_BUNDLE } from './arcticHeo.ts'
import { BEIDOU_OPERATIONAL_BUNDLE } from './beidouOperational.ts'
import { COPERNICUS_SENTINELS_BUNDLE } from './copernicusSentinels.ts'
import { CREWED_SPACE_STATIONS_BUNDLE } from './crewedSpaceStations.ts'
import { GALILEO_OPERATIONAL_BUNDLE } from './galileoOperational.ts'
import { GEOSTATIONARY_WEATHER_BUNDLE } from './geostationaryWeather.ts'
import { GLONASS_OPERATIONAL_BUNDLE } from './glonassOperational.ts'
import { GPS_OPERATIONAL_BUNDLE } from './gpsOperational.ts'
import type { OfficialGroupBundle } from './officialGroup.ts'

export type { OfficialGroupBundle, OfficialGroupEducation, OfficialGroupLink } from './officialGroup.ts'

/** Every reviewed official group the build carries, in presentation order:
 *  the navigation systems, then the thematic groups. Each group has its own
 *  membership revision and evidence; the set revision below changes whenever
 *  any of them does. */
export const OFFICIAL_GROUP_BUNDLES: readonly OfficialGroupBundle[] = [
  GPS_OPERATIONAL_BUNDLE,
  GALILEO_OPERATIONAL_BUNDLE,
  GLONASS_OPERATIONAL_BUNDLE,
  BEIDOU_OPERATIONAL_BUNDLE,
  CREWED_SPACE_STATIONS_BUNDLE,
  GEOSTATIONARY_WEATHER_BUNDLE,
  COPERNICUS_SENTINELS_BUNDLE,
  ARCTIC_HEO_BUNDLE,
]

/** The revision of the whole injected set, recorded with each object added
 *  from a group. It lives in `curatedCatalogue.ts` with the
 *  memberships, so a member change there bumps it there. */
export const OFFICIAL_GROUPS_REVISION = CURATED_CATALOGUE.officialGroupsRevision

/** The bundle of one official group. */
export function officialGroupBundle(groupId: string): OfficialGroupBundle | undefined {
  return OFFICIAL_GROUP_BUNDLES.find((bundle) => bundle.group.id === groupId)
}

/** The official groups every build injects. Membership stays a manually
 *  reviewed roster: an authority's change needs a new revision and evidence. */
export function officialCatalogueGroupInjection(): { readonly groupDefinitions: { readonly schemaVersion: 1; readonly revision: string; readonly groups: readonly CatalogueGroupDefinition[] }; readonly discoveryPages: readonly CatalogueDiscoveryPage[] } {
  return {
    groupDefinitions: { schemaVersion: 1, revision: OFFICIAL_GROUPS_REVISION, groups: OFFICIAL_GROUP_BUNDLES.map((bundle) => bundle.group) },
    discoveryPages: OFFICIAL_GROUP_BUNDLES.map((bundle) => bundle.page),
  }
}
