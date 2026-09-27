import { expect, it } from 'vitest'
import { EMPTY_CATALOGUE_GROUP_DEFINITIONS, EMPTY_CATALOGUE_GROUP_INJECTION, decodeCatalogueGroupDefinitionSet, normalizeCatalogueGroupDefinitionSet, validateCatalogueGroupDefinitionSet } from './catalogueGroups.ts'
import { CATALOGUE_DISCOVERY_PAGES } from './catalogueDiscoveryPages.ts'
import { FIXTURE_CATALOGUE_GROUP_DEFINITIONS, FIXTURE_GPS_DISCOVERY_PAGE, FIXTURE_GPS_GROUP_DEFINITION } from '../test-fixtures/catalogueGroupFixtures.ts'

it('validates and normalizes the injected official-group contract', () => {
  const normalized = normalizeCatalogueGroupDefinitionSet({
    schemaVersion: 1, revision: '  fixture-groups-1 ', groups: [{ ...FIXTURE_GPS_GROUP_DEFINITION, membership: { ...FIXTURE_GPS_GROUP_DEFINITION.membership, catalogIds: ['900003', '900001', '900002'] } }],
  })
  expect(normalized.revision).toBe('fixture-groups-1')
  expect(normalized.groups[0].membership.catalogIds).toEqual(['900001', '900002', '900003'])
  expect(decodeCatalogueGroupDefinitionSet(FIXTURE_CATALOGUE_GROUP_DEFINITIONS)).toEqual(normalizeCatalogueGroupDefinitionSet(FIXTURE_CATALOGUE_GROUP_DEFINITIONS))
  expect(EMPTY_CATALOGUE_GROUP_DEFINITIONS.groups).toEqual([])
})

it('rejects duplicate members, invalid provenance and missing page references', () => {
  expect(() => validateCatalogueGroupDefinitionSet({ ...FIXTURE_CATALOGUE_GROUP_DEFINITIONS, groups: [{ ...FIXTURE_GPS_GROUP_DEFINITION, membership: { ...FIXTURE_GPS_GROUP_DEFINITION.membership, catalogIds: ['900001', '900001'] } }] })).toThrow(/repeats/)
  expect(() => validateCatalogueGroupDefinitionSet({ ...FIXTURE_CATALOGUE_GROUP_DEFINITIONS, groups: [{ ...FIXTURE_GPS_GROUP_DEFINITION, provenance: { ...FIXTURE_GPS_GROUP_DEFINITION.provenance, sourceUrl: 'http://example.invalid' } }] })).toThrow(/provenance/)
  expect(() => validateCatalogueGroupDefinitionSet(EMPTY_CATALOGUE_GROUP_DEFINITIONS, [FIXTURE_GPS_DISCOVERY_PAGE])).toThrow(/missing/)
})

it('rejects every contract violation named by the official-group seam before it reaches the controller', () => {
  const group = FIXTURE_GPS_GROUP_DEFINITION
  const set = (groups: unknown[], extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, revision: 'r1', groups, ...extra })
  const invalid: [string, unknown][] = [
    ['schema version', set([group], { schemaVersion: 2 })],
    ['empty revision', set([group], { revision: '  ' })],
    ['duplicate group id', set([group, group])],
    ['invalid group id', set([{ ...group, id: 'GPS System' }])],
    ['empty title', set([{ ...group, title: ' ' }])],
    ['empty authority', set([{ ...group, provenance: { ...group.provenance, authority: '' } }])],
    ['empty source description', set([{ ...group, provenance: { ...group.provenance, sourceDescription: ' ' } }])],
    ['invalid review date', set([{ ...group, provenance: { ...group.provenance, reviewedAtUtc: '2026-02-30T00:00:00Z' } }])],
    ['non-UTC review date', set([{ ...group, provenance: { ...group.provenance, reviewedAtUtc: '2026-09-20T12:00:00+02:00' } }])],
    ['non-HTTPS source', set([{ ...group, provenance: { ...group.provenance, sourceUrl: 'ftp://example.invalid/list' } }])],
    ['non-canonical id', set([{ ...group, membership: { ...group.membership, catalogIds: ['0900011'] } }])],
    ['empty membership', set([{ ...group, membership: { ...group.membership, catalogIds: [] } }])],
  ]
  for (const [reason, value] of invalid) expect(() => validateCatalogueGroupDefinitionSet(value), reason).toThrow()
  expect(() => validateCatalogueGroupDefinitionSet(set([group]), [FIXTURE_GPS_DISCOVERY_PAGE])).not.toThrow()
})

it('keeps the fixture GPS proof distinct and the generic module free of official groups', () => {
  // The fixture carries its own revision and provenance, and at least four members.
  expect(FIXTURE_CATALOGUE_GROUP_DEFINITIONS.revision).toBe('fixture-groups-1')
  expect(FIXTURE_GPS_GROUP_DEFINITION.provenance).toMatchObject({ authority: 'Orbitin test maintainer', sourceDescription: 'Synthetic automatic-profile fixture membership' })
  expect(FIXTURE_GPS_GROUP_DEFINITION.membership.catalogIds.length).toBeGreaterThanOrEqual(5)
  expect(EMPTY_CATALOGUE_GROUP_INJECTION.groupDefinitions.groups).toEqual([])
  expect(CATALOGUE_DISCOVERY_PAGES.every((page) => page.kind === 'educational-view' && page.membership.kind === 'index-query')).toBe(true)
  expect(CATALOGUE_DISCOVERY_PAGES.some((page) => /gps/i.test(`${page.id} ${page.title} ${page.summary}`))).toBe(false)
})
