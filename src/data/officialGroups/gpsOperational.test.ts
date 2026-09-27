import { expect, it } from 'vitest'
import { normalizeCatalogueGroupDefinitionSet, validateCatalogueGroupDefinitionSet } from '../catalogueGroups.ts'
import { CATALOGUE_DISCOVERY_PAGES, validateCatalogueDiscoveryPages } from '../catalogueDiscoveryPages.ts'
import { resolveDiscoveryMembership } from '../../ui/catalogueDiscoveryModel.ts'
import { GPS_OPERATIONAL_CATALOG_IDS, GPS_OPERATIONAL_GROUP, GPS_OPERATIONAL_PAGE, GPS_OPERATIONAL_REVISION } from './gpsOperational.ts'
import { officialCatalogueGroupInjection, OFFICIAL_GROUPS_REVISION } from './index.ts'

/** The 32 NORAD ids of the 2026-09-24 NAVCEN review. */
const EVIDENCE_IDS = `26407 27663 28190 28474 28874 29486 29601 32260 32384 32711 35752 36585
38833 39166 39533 39741 40105 40294 40534 40730 41019 41328 43873 44506
45854 46826 48859 55268 62339 64202 67588 68791`.split(/\s+/)

it('holds exactly the 32 reviewed GPS NORAD ids with NAVCEN provenance', () => {
  expect(GPS_OPERATIONAL_CATALOG_IDS).toEqual(EVIDENCE_IDS)
  expect(new Set(GPS_OPERATIONAL_CATALOG_IDS).size).toBe(32)
  expect(GPS_OPERATIONAL_GROUP.provenance).toMatchObject({
    authority: 'U.S. Coast Guard Navigation Center GPS Constellation Status',
    sourceUrl: 'https://www.navcen.uscg.gov/gps-constellation',
    reviewedAtUtc: '2026-09-24T00:00:00Z',
  })
  expect(GPS_OPERATIONAL_GROUP.provenance.sourceDescription).toContain('CelesTrak')
  expect(GPS_OPERATIONAL_REVISION).toBe('gps-operational-2026-09-24')
  // Membership is a reviewed roster, not a live health status.
  expect(GPS_OPERATIONAL_PAGE.summary).toContain('not a live health status')
})

it('validates as a definition set whose Discovery Page resolves', () => {
  const injection = officialCatalogueGroupInjection()
  const pages = [...CATALOGUE_DISCOVERY_PAGES, ...injection.discoveryPages]
  expect(() => validateCatalogueDiscoveryPages(pages)).not.toThrow()
  expect(() => validateCatalogueGroupDefinitionSet(injection.groupDefinitions, pages)).not.toThrow()
  expect(normalizeCatalogueGroupDefinitionSet(injection.groupDefinitions).groups.map((group) => group.id)).toContain('gps-operational')
})

it('injects the reviewed GPS bundle, definition and page together, in every build', () => {
  const injection = officialCatalogueGroupInjection()
  expect(injection.groupDefinitions.groups[0]).toEqual(GPS_OPERATIONAL_GROUP)
  expect(injection.groupDefinitions.revision).toBe(OFFICIAL_GROUPS_REVISION)
  expect(injection.discoveryPages[0]).toEqual(GPS_OPERATIONAL_PAGE)
})

it('reports absent members and offers only present ones for Add all, in reviewed order', () => {
  const injection = officialCatalogueGroupInjection()
  const present = [EVIDENCE_IDS[5], EVIDENCE_IDS[0], EVIDENCE_IDS[31]]
  const entries = present.map((catalogId) => ({ catalogId, name: `GPS ${catalogId}`, designator: null, epochUtc: '2026-09-20T00:00:00Z', shard: 0 }))
  const membership = resolveDiscoveryMembership(GPS_OPERATIONAL_PAGE, entries as never, injection.groupDefinitions)
  expect(membership.memberCount).toBe(3)
  expect(membership.missingCatalogIds).toHaveLength(29)
  expect(GPS_OPERATIONAL_GROUP.membership.catalogIds.filter((id) => membership.catalogIds.includes(id))).toEqual([EVIDENCE_IDS[0], EVIDENCE_IDS[5], EVIDENCE_IDS[31]])
})
