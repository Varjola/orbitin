import { expect, it } from 'vitest'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { CATALOGUE_DISCOVERY_PAGES } from '../data/catalogueDiscoveryPages.ts'
import { FIXTURE_CATALOGUE_GROUP_DEFINITIONS, FIXTURE_GPS_ABSENT_MEMBER_ID, FIXTURE_GPS_DISCOVERY_PAGE, FIXTURE_GPS_PRESENT_MEMBER_IDS } from '../test-fixtures/catalogueGroupFixtures.ts'
import { generateCatalogueIndex } from '../test-fixtures/generatedCatalogueIndex.ts'
import { buildCatalogueDiscoveryNavigationModel, buildCatalogueDiscoveryPresentation, resolveDiscoveryMembership } from './catalogueDiscoveryModel.ts'

const entries = () => buildAutomaticSnapshotFixture().index.entries

it('derives starter-page membership, current counts and index facts', () => {
  const index = entries()
  const low = resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[0], index)
  expect(low.supported).toBe(true)
  expect(low.catalogIds).toEqual(['900001'])
  expect(low.memberCount).toBe(1)
  expect(low.facts[0].items).toEqual([{ value: 'payload', count: 1 }])

  const rocket = resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[4], index)
  expect(rocket.catalogIds).toEqual(['900003'])
  expect(rocket.facts[0].items[0].value).toBe('highly-elliptical')
})

it('keeps unsupported broad pages out of legacy navigation without inventing zero membership', () => {
  const legacy = [{ catalogId: '700001', name: 'Legacy', normalizedName: 'legacy', internationalDesignator: null, epochUtc: '2026-01-01T00:00:00Z', groups: [], shard: 0 }]
  expect(buildCatalogueDiscoveryNavigationModel(legacy)).toEqual([])
})

it('intersects fixture official-group members with the current index and reports, never fabricates, missing ids', () => {
  const index = buildAutomaticSnapshotFixture({ syntheticNavigationMembers: true }).index.entries
  const model = resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, index, FIXTURE_CATALOGUE_GROUP_DEFINITIONS, 'automatic')
  expect(model.supported).toBe(true)
  expect(model.catalogIds).toEqual([...FIXTURE_GPS_PRESENT_MEMBER_IDS])
  expect(model.memberCount).toBe(4)
  expect(model.missingCatalogIds).toEqual([FIXTURE_GPS_ABSENT_MEMBER_ID])
  expect(model).toMatchObject({ group: { id: 'gps-system', provenance: { reviewedAtUtc: '2026-09-20T12:00:00Z' } }, groupRevision: 'fixture-groups-1' })

  // The count follows the current index: a member absent from it is reported as missing.
  const smaller = resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, index.filter((entry: { catalogId: string }) => entry.catalogId !== '900012'), FIXTURE_CATALOGUE_GROUP_DEFINITIONS, 'automatic')
  expect(smaller.memberCount).toBe(3)
  expect(smaller.missingCatalogIds).toEqual(['900012', FIXTURE_GPS_ABSENT_MEMBER_ID])
  // The default fixture has none of the navigation members; the page stays available with zero members.
  expect(resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, entries(), FIXTURE_CATALOGUE_GROUP_DEFINITIONS)).toMatchObject({ supported: true, memberCount: 0, catalogIds: [] })
  // Without an injected definition the official page is unsupported rather than empty.
  expect(resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, index).supported).toBe(false)
})

it('presents official-group provenance, revision and missing members without whole-group actions', () => {
  const index = buildAutomaticSnapshotFixture({ syntheticNavigationMembers: true }).index.entries
  const pages = [...CATALOGUE_DISCOVERY_PAGES, FIXTURE_GPS_DISCOVERY_PAGE]
  const navigation = buildCatalogueDiscoveryNavigationModel(index, pages, FIXTURE_CATALOGUE_GROUP_DEFINITIONS, 'automatic')
  const active = resolveDiscoveryMembership(FIXTURE_GPS_DISCOVERY_PAGE, index, FIXTURE_CATALOGUE_GROUP_DEFINITIONS, 'automatic')
  const model = buildCatalogueDiscoveryPresentation({ mode: 'automatic', navigation, active, legacyGroups: [], activeLegacyGroup: null })
  expect(model.cards.at(-1)).toEqual({ id: 'gps-system', kind: 'official-system', title: 'GPS system', summary: FIXTURE_GPS_DISCOVERY_PAGE.summary, kindLabel: 'Official system', countLabel: '4 objects', active: true })
  expect(model.cards.find((card) => card.id === 'medium-earth-orbit')?.countLabel).toBe('4 objects')
  expect(model.active).toMatchObject({
    kindLabel: 'Official system', memberCountLabel: '4 objects in the current catalogue', facts: [],
    missingMembersNote: '1 reviewed member is not in the current catalogue and is not listed: NORAD 900015.',
    provenance: {
      rows: [
        { label: 'Membership reviewed by', text: 'Orbitin test maintainer' },
        { label: 'Membership source', text: 'Synthetic automatic-profile fixture membership' },
        { label: 'Reviewed', text: '2026-09-20 (UTC)' },
        { label: 'Definition revision', text: 'fixture-groups-1' },
      ],
      sourceUrl: 'https://example.invalid/orbitin/gps-system',
    },
  })
  expect(model.scopeSummary).toBe('Discovery Page: GPS system')
  // Broad educational pages carry neither provenance nor a missing-member note.
  const broad = buildCatalogueDiscoveryPresentation({ mode: 'automatic', navigation, active: resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[1], index, FIXTURE_CATALOGUE_GROUP_DEFINITIONS, 'automatic'), legacyGroups: [], activeLegacyGroup: null })
  expect(broad.active).toMatchObject({ provenance: null, missingMembersNote: null })
})

it('ships exactly the six reviewed broad starter pages, with declarative membership and no counts in their copy', () => {
  expect(CATALOGUE_DISCOVERY_PAGES.map((page) => [page.id, page.kind, page.membership])).toEqual([
    ['low-earth-orbit', 'educational-view', { kind: 'index-query', primaryOrbitClasses: ['low-earth'] }],
    ['medium-earth-orbit', 'educational-view', { kind: 'index-query', primaryOrbitClasses: ['medium-earth'] }],
    ['geosynchronous-orbit', 'educational-view', { kind: 'index-query', primaryOrbitClasses: ['geosynchronous'] }],
    ['highly-elliptical-orbits', 'educational-view', { kind: 'index-query', primaryOrbitClasses: ['highly-elliptical'] }],
    ['rocket-bodies', 'educational-view', { kind: 'index-query', typeCategories: ['rocket-body'] }],
    ['debris', 'educational-view', { kind: 'index-query', typeCategories: ['debris'] }],
  ])
  for (const page of CATALOGUE_DISCOVERY_PAGES) {
    for (const copy of [page.title, page.summary, page.whyItMatters ?? '']) expect(copy, page.id).not.toMatch(/\d/)
  }
})

it('presents Explore cards and the active page from current-index membership only', () => {
  const index = entries()
  const navigation = buildCatalogueDiscoveryNavigationModel(index, CATALOGUE_DISCOVERY_PAGES, undefined, 'automatic')
  const active = resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[0], index, undefined, 'automatic')
  const model = buildCatalogueDiscoveryPresentation({ mode: 'automatic', navigation, active, legacyGroups: [], activeLegacyGroup: null })
  // Automatic snapshots keep all six pages, including zero-member pages.
  expect(model.cards.map((card) => [card.id, card.countLabel, card.active])).toEqual([
    ['low-earth-orbit', '1 object', true], ['medium-earth-orbit', '0 objects', false], ['geosynchronous-orbit', '1 object', false],
    ['highly-elliptical-orbits', '1 object', false], ['rocket-bodies', '1 object', false], ['debris', '0 objects', false],
  ])
  expect(model.active).toMatchObject({ title: 'Low Earth orbit', kindLabel: 'Broad educational view', memberCountLabel: '1 object in the current catalogue', facts: [{ label: 'Object type composition', text: 'Payload 1' }] })
  expect(model.scopeSummary).toBe('Discovery Page: Low Earth orbit')
  expect(model.legacyIntro).toBeNull()

  const none = buildCatalogueDiscoveryPresentation({ mode: 'automatic', navigation, active: null, legacyGroups: [], activeLegacyGroup: null })
  expect(none.active).toBeNull()
  expect(none.scopeSummary).toBe('All catalogue objects')
})

it('recomputes counts and facts when the index changes', () => {
  const index = generateCatalogueIndex().entries
  const debris = resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[5], index, undefined, 'automatic')
  const smaller = resolveDiscoveryMembership(CATALOGUE_DISCOVERY_PAGES[5], index.slice(0, 1000), undefined, 'automatic')
  expect(debris.memberCount).toBeGreaterThan(smaller.memberCount)
  expect(debris.facts[0].items.reduce((sum, item) => sum + item.count, 0)).toBe(debris.memberCount)
})

it('offers labelled legacy groups, or a Browse all introduction, instead of broad pages for legacy snapshots', () => {
  // An unknown group shows the label the Worker published; a reviewed one its catalogue words.
  const withGroups = buildCatalogueDiscoveryPresentation({ mode: 'legacy', navigation: [], active: null, legacyGroups: [{ id: 'future-science', label: 'Science' }, { id: 'space-science', label: 'Published label' }], activeLegacyGroup: 'future-science' })
  expect(withGroups.cards).toEqual([])
  expect(withGroups.legacyGroups).toEqual([{ id: 'future-science', label: 'Science', active: true }, { id: 'space-science', label: 'Space science observatories', active: false }])
  expect(withGroups.legacyIntro).toBeNull()
  expect(withGroups.scopeSummary).toBe('Legacy group: Science')
  const withoutGroups = buildCatalogueDiscoveryPresentation({ mode: 'legacy', navigation: [], active: null, legacyGroups: [], activeLegacyGroup: null })
  expect(withoutGroups.legacyIntro).toMatch(/Browse all objects/)
})
