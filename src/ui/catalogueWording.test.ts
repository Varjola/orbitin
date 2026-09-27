import { expect, it } from 'vitest'
import { GROUP_ADD_CONFIRMATION_THRESHOLD } from './catalogueWording.ts'
import {
  catalogueAttribution, catalogueAttributionNotice, catalogueFreshness, catalogueSourceLabel, providerDisplayName,
  quickSearchResultStatus, catalogueResultWindowSummary, catalogueScopeSummary,
  catalogueComparisonCountStatus, catalogueGroupMissingMembersNote,
} from './catalogueWording.ts'
import { text } from '../i18n/index.ts'

const t = text().catalogue
import type { CatalogueManifestV1 } from '../data/catalogueSchema.ts'

const MANIFEST = {
  provider: { id: 'space-track', name: 'Space-Track.org', homepage: 'https://www.space-track.org/', sourceAuthority: 'USSPACECOM / 18th Space Defense Squadron', wireFormat: 'omm-keyed-json', retrievedAtUtc: '2026-09-10T00:17:00Z' },
} as unknown as CatalogueManifestV1
const AUTOMATIC = {
  ...MANIFEST,
  provider: { ...MANIFEST.provider, retrievedAtUtc: '2026-09-14T07:17:03Z' },
  catalogueProfile: { kind: 'automatic-catalogue', contractVersion: 1, normalizationRulesVersion: 'space-track-gp/1', enrichmentRulesVersion: 'orbit-classes/1' },
  sourceRun: { retrievalStartedAtUtc: '2026-09-14T00:17:02Z', retrievedAtUtc: '2026-09-14T07:17:03Z' },
} as unknown as CatalogueManifestV1

it('names a provider for display without depending on which provider it is', () => {
  expect(providerDisplayName('space-track')).toBe('Space-Track.org')
  expect(catalogueSourceLabel('fixture')).toBe('Published catalogue · Local fixture')
  // An unknown provider is shown as itself rather than breaking the panel.
  expect(providerDisplayName('some-future-provider')).toBe('some-future-provider')
})

it('builds the approved 2026-09-10 citation from the snapshot rather than from a constant', () => {
  expect(catalogueAttribution(MANIFEST)).toBe('Orbital data: USSPACECOM / 18th Space Defense Squadron, accessed via Space-Track.org')
})

it('adds the Gate 4 educational-use and derived-data statements, the retrieval time and the source link', () => {
  const format = (iso: string) => `<${iso}>`
  expect(catalogueAttributionNotice(AUTOMATIC, format)).toEqual({
    citation: 'Orbital data: USSPACECOM / 18th Space Defense Squadron, accessed via Space-Track.org',
    sourceLink: 'https://www.space-track.org/',
    retrieval: 'Source data retrieved <2026-09-14T00:17:02Z> to <2026-09-14T07:17:03Z>',
    educationalUse: 'Educational use only; not for conjunction assessment or operational decisions.',
    derivedData: 'Derived classifications and calculations are produced by Orbitin.',
  })
  // A legacy snapshot publishes no derived metadata and keeps one retrieval time.
  expect(catalogueAttributionNotice(MANIFEST, format)).toMatchObject({ retrieval: 'Source data retrieved <2026-09-10T00:17:00Z>', derivedData: null })
  expect(t.educationalUse).toMatch(/conjunction assessment/)
  expect(t.derivedData).toMatch(/Orbitin/)
})

it('warns learners that the catalogue is non-operational and that presence is not activity', () => {
  expect(t.educationalWarning).toMatch(/^Educational visualization only\./)
  for (const phrase of ['conjunction assessment', 'collision avoidance', 'operational decision', 'incomplete or out of date', 'does not mean an object is active']) expect(t.educationalWarning).toContain(phrase)
})

it('labels catalogue freshness against real wall-clock time', () => {
  const retrieved = Date.parse('2026-09-10T00:00:00Z')
  expect(catalogueFreshness('2026-09-10T00:00:00Z', retrieved + 1 * 3_600_000)).toBe('current')
  expect(catalogueFreshness('2026-09-10T00:00:00Z', retrieved + 18 * 3_600_000)).toBe('current')
  expect(catalogueFreshness('2026-09-10T00:00:00Z', retrieved + 24 * 3_600_000)).toBe('delayed')
  expect(catalogueFreshness('2026-09-10T00:00:00Z', retrieved + 40 * 3_600_000)).toBe('stale')
  // A snapshot that claims to come from the future is not "fresher than now".
  expect(catalogueFreshness('2026-09-11T00:00:00Z', retrieved)).toBe('current')
})

it('keeps Quick Search wording bounded to index-visible identity and count state', () => {
  expect(t.quickSearchNoMatch('ISS')).toBe('No catalogue objects match “ISS”.')
  expect(t.quickSearchViewAll(12_345)).toBe('View all 12,345 results in Catalogue')
  expect(t.quickSearchRefreshFailed('The pointer could not be fetched.')).toBe('Catalogue refresh failed: The pointer could not be fetched. Quick Search is using the last loaded catalogue.')
  expect(quickSearchResultStatus({ totalMatches: 1, entries: [{}], hasMore: false })).toBe('1 catalogue result.')
  expect(quickSearchResultStatus({ totalMatches: 10, entries: Array.from({ length: 8 }), hasMore: true })).toBe('10 catalogue results; showing the first 8.')
})

it('states the bounded result window exactly and never implies more rows are reachable by scrolling', () => {
  expect(catalogueResultWindowSummary({ totalMatches: 4218, entries: new Array(100) })).toBe('Showing 100 of 4,218 matching objects')
  expect(catalogueResultWindowSummary({ totalMatches: 37, entries: new Array(37) })).toBe('Showing 37 matching objects')
  expect(catalogueResultWindowSummary({ totalMatches: 1, entries: new Array(1) })).toBe('Showing 1 matching object')
  expect(catalogueResultWindowSummary({ totalMatches: 0, entries: [] })).toBe('No catalogue objects match the current search and filters.')
  for (const total of [0, 1, 37, 4218]) expect(catalogueResultWindowSummary({ totalMatches: total, entries: new Array(Math.min(100, total)) })).not.toMatch(/scroll|more below|load more/i)
})

it('names the workspace scope, counts and comparison capacity', () => {
  expect(catalogueScopeSummary(null)).toBe('All catalogue objects')
  expect(catalogueScopeSummary({ title: 'Debris' })).toBe('Discovery Page: Debris')
  expect(catalogueScopeSummary(null, 'Science')).toBe('Legacy group: Science')
  expect(t.objectCount(1)).toBe('1 object')
  expect(t.objectCount(12345)).toBe('12,345 objects')
  expect(t.compareTab(2, 4)).toBe('Compare (2/4)')
})

it('announces comparison count and failure without claiming data that did not load', () => {
  expect(catalogueComparisonCountStatus(3, 4)).toBe('Comparing 3 of 4 objects.')
  expect(catalogueComparisonCountStatus(0, 4)).toBe('Comparison cleared.')
  expect(t.comparisonLoadFailed('SYNTHETIC NAV 1')).toBe('Could not load SYNTHETIC NAV 1 for comparison. Use Retry in the Compare tab.')
})

it('reports reviewed group members missing from the current catalogue by id only', () => {
  expect(catalogueGroupMissingMembersNote([])).toBeNull()
  expect(catalogueGroupMissingMembersNote(['900015'])).toBe('1 reviewed member is not in the current catalogue and is not listed: NORAD 900015.')
  const many = Array.from({ length: 12 }, (_, index) => String(900100 + index))
  expect(catalogueGroupMissingMembersNote(many)).toBe(`12 reviewed members are not in the current catalogue and are not listed: ${many.slice(0, 10).map((id) => `NORAD ${id}`).join(', ')} and 2 more.`)
})

it('words the whole-group add, its capacity refusal and its confirmation', () => {
  expect(t.groupAdd(32)).toBe('Add all 32 members to scene')
  expect(t.groupAddCapacity(32, 30)).toBe('32 new members need 32 slots; this scene has 30. Remove objects in Scene Objects or add members individually.')
  expect(t.groupAddConfirmation(32)).toBe('Add 32 objects to the Real Objects scene? Orbit paths on; ground tracks, history and sensors off.')
  expect(GROUP_ADD_CONFIRMATION_THRESHOLD).toBe(10)
})
