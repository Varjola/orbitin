import { expect, it } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { EMPTY_CATALOGUE_QUERY } from '../data/catalogueQuery.ts'
import { CATALOGUE_DISCOVERY_PAGES } from '../data/catalogueDiscoveryPages.ts'
import { FIXTURE_CATALOGUE_GROUP_DEFINITIONS, FIXTURE_GPS_ABSENT_MEMBER_ID, FIXTURE_GPS_DISCOVERY_PAGE, FIXTURE_GPS_PRESENT_MEMBER_IDS } from '../test-fixtures/catalogueGroupFixtures.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads, type AutomaticSnapshotFixtureOptions } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import type { CatalogueComparisonItem } from '../ui/catalogueComparison.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'
import { legacySnapshotPayloads } from '../test-fixtures/legacyCatalogueSnapshot.ts'
import { clearCatalogueFilters } from '../ui/catalogueResultsModel.ts'
import type { CatalogueDiscoveryPresentation } from '../ui/catalogueDiscoveryModel.ts'
import { CatalogueController, type CatalogueControllerOptions, type CataloguePresenter } from './CatalogueController.ts'

type PresenterCall = { readonly method: keyof CataloguePresenter; readonly args: readonly unknown[] }

function recordingPresenter(): { presenter: CataloguePresenter; calls: PresenterCall[] } {
  const calls: PresenterCall[] = []
  const record = <K extends keyof CataloguePresenter>(method: K) => (...args: Parameters<NonNullable<CataloguePresenter[K]>>) => { calls.push({ method, args }) }
  return {
    calls,
    presenter: {
      syncWorkspace: record('syncWorkspace'), setSnapshot: record('setSnapshot'), setError: record('setError'),
      renderQuickSearch: record('renderQuickSearch'), setCatalogueNotice: record('setCatalogueNotice'),
      renderQuery: record('renderQuery'), renderDiscovery: record('renderDiscovery'), showDetails: record('showDetails'), showDetailsError: record('showDetailsError'),
      clearDetails: record('clearDetails'), setComparison: record('setComparison'), clearComparison: record('clearComparison'),
    },
  }
}

async function harness(options: { honorAbort?: boolean; fixture?: AutomaticSnapshotFixtureOptions; controller?: Partial<CatalogueControllerOptions> } = {}) {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture(options.fixture))
  const counted = createCountingFetch(payloads, options)
  const client = new CatalogueClient({ fetch: counted.fetch, pointerSessionTtlMs: 60_000 })
  const recorded = recordingPresenter()
  const controller = new CatalogueController({ presenter: recorded.presenter, client, now: () => Date.parse('2026-09-15T00:00:00Z'), ...options.controller })
  return { payloads, counted, client, controller, ...recorded }
}

/** The fixture-only official-group proof: four synthetic navigation members
 *  in the index, one reviewed id absent from it. */
const gpsHarness = () => harness({
  fixture: { syntheticNavigationMembers: true },
  controller: { discoveryPages: [...CATALOGUE_DISCOVERY_PAGES, FIXTURE_GPS_DISCOVERY_PAGE], groupDefinitions: FIXTURE_CATALOGUE_GROUP_DEFINITIONS },
})

function lastComparison(calls: readonly PresenterCall[]): readonly CatalogueComparisonItem[] | null {
  const last = calls.filter((call) => call.method === 'setComparison' || call.method === 'clearComparison').at(-1)
  return last === undefined || last.method === 'clearComparison' ? null : last.args[0] as readonly CatalogueComparisonItem[]
}
const comparisonStates = (calls: readonly PresenterCall[]) => lastComparison(calls)?.map((item) => `${item.catalogId}:${item.state}`) ?? []

it('fetches nothing before explicit load and keeps load/search index-only', async () => {
  const { counted, controller, calls } = await harness()
  expect(counted.requests).toEqual([])
  controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '900001' })
  await controller.changeDetails('900001')
  await controller.changeComparison(['900001'])
  await expect(controller.resolveRecords(['900001'])).rejects.toThrow('Load the catalogue')
  expect(counted.requests).toEqual([])
  expect(calls.some((call) => call.method === 'renderQuery' || call.method === 'showDetails')).toBe(false)

  await controller.load()
  const snapshot = controller.snapshot!
  expect(counted.requests).toEqual(['/catalog/v1/current.json', `/catalog/v1/snapshots/${snapshot.manifest.snapshotId}/manifest.json`, snapshot.manifest.index.path])
  const requestCount = counted.requests.length
  for (const text of ['', '900001', 'synthetic', 'no match']) controller.query({ ...EMPTY_CATALOGUE_QUERY, text })
  await controller.load()
  expect(counted.requests).toHaveLength(requestCount)
  expect(counted.requests.some((path) => path.includes('records-'))).toBe(false)
})

it('loads only distinct record pages and rejects all-or-nothing requests before fetching', async () => {
  const { counted, client, controller } = await harness()
  await controller.load()
  const before = counted.requests.length
  const ids = controller.snapshot!.index.entries.map((entry) => entry.catalogId)
  const distinctPaths = new Set(ids.map((id) => {
    const shard = client.indexEntry(id)!.shard
    return controller.snapshot!.manifest.shards[shard].path
  }))
  const resolved = await controller.resolveRecords(ids)
  expect(resolved.records.map((record) => record.NORAD_CAT_ID)).toEqual(ids)
  expect(counted.requests.slice(before).sort()).toEqual([...distinctPaths].sort())
  await controller.changeDetails(ids[0])
  await controller.changeComparison(ids)
  expect(counted.requests).toHaveLength(before + distinctPaths.size)

  const requestCount = counted.requests.length
  const missing = await controller.resolveRecords([ids[0], '999999999'], { requireAll: true })
  expect(missing).toMatchObject({ records: [], missingIds: ['999999999'] })
  expect(counted.requests).toHaveLength(requestCount)
})

it('does not publish stale details and stops all publication after dispose', async () => {
  const { counted, client, controller, calls } = await harness({ honorAbort: false })
  await controller.load()
  const entries = controller.snapshot!.index.entries
  const first = entries[0]
  const second = entries.find((entry) => entry.shard !== first.shard)!
  const path = controller.snapshot!.manifest.shards[first.shard].path
  counted.gate(path)
  const stale = controller.changeDetails(first.catalogId)
  await Promise.resolve()
  await controller.changeDetails(second.catalogId)
  counted.release(path)
  await stale
  const shown = calls.filter((call) => call.method === 'showDetails').map((call) => (call.args[0] as { NORAD_CAT_ID: string }).NORAD_CAT_ID)
  expect(shown).toEqual([second.catalogId])

  const uncached = entries.find((entry) => entry.catalogId !== first.catalogId && entry.catalogId !== second.catalogId) ?? first
  const uncachedPath = controller.snapshot!.manifest.shards[client.indexEntry(uncached.catalogId)!.shard].path
  counted.gate(uncachedPath)
  const pending = controller.changeDetails(uncached.catalogId)
  await Promise.resolve()
  const callCount = calls.length
  controller.dispose()
  counted.release(uncachedPath)
  await pending
  expect(calls).toHaveLength(callCount)
  await controller.load()
  expect(calls).toHaveLength(callCount)
})

it('clears browse selection and caches when a new snapshot is refreshed', async () => {
  const { payloads, controller, calls } = await harness()
  await controller.load()
  const ids = controller.snapshot!.index.entries.map((entry) => entry.catalogId)
  await controller.changeDetails(ids[0])
  await controller.changeComparison(ids.slice(0, 2))
  const replacement = await legacySnapshotPayloads('2026-09-10T00:17:00Z')
  payloads.clear()
  for (const [path, bytes] of replacement) payloads.set(path, bytes)
  await controller.refresh()
  expect(controller.workspace.focusedCatalogId).toBeNull()
  expect(controller.workspace.comparedCatalogIds).toEqual([])
  expect(calls.some((call) => call.method === 'clearDetails')).toBe(true)
  expect(calls.some((call) => call.method === 'clearComparison')).toBe(true)
  const snapshots = calls.filter((call) => call.method === 'setSnapshot')
  expect(snapshots.at(-1)?.args[1]).toBe(true)
})

it('runs Quick Search against the loaded index without inheriting full-query filters or fetching shards', async () => {
  const { counted, controller, calls } = await harness()
  await controller.load()
  controller.query({ ...EMPTY_CATALOGUE_QUERY, typeCategories: ['payload'], text: 'does-not-matter' })
  const requestCount = counted.requests.length
  const result = controller.quickSearch('synthetic', 8)
  expect(result.totalMatches).toBe(3)
  expect(result.entries.map((entry) => entry.catalogId)).toEqual(['900001', '900002', '900003'])
  expect(controller.workspace.quickSearchText).toBe('synthetic')
  expect(counted.requests).toHaveLength(requestCount)
  expect(counted.requests.some((path) => path.includes('records-'))).toBe(false)
  expect(calls.filter((call) => call.method === 'renderQuickSearch').at(-1)?.args[0]).toEqual(result)
})

it('resolves a Discovery Page once from index data and scopes the full query', async () => {
  const { controller, calls } = await harness()
  await controller.load()
  const membership = controller.openDiscoveryPage('low-earth-orbit')
  expect(membership?.catalogIds).toEqual(['900001'])
  expect(controller.workspace.activeDiscoveryPageId).toBe('low-earth-orbit')
  expect(controller.workspace.query).toEqual(EMPTY_CATALOGUE_QUERY)
  const rendered = calls.filter((call) => call.method === 'renderQuery').at(-1)
  expect((rendered?.args[2] as { totalMatches: number }).totalMatches).toBe(1)
  controller.query({ ...EMPTY_CATALOGUE_QUERY, text: 'station' })
  expect(controller.workspace.activeDiscoveryPageId).toBeNull()
})

it('accepts the fixture-only official-group page while production defaults stay empty', async () => {
  const production = await harness()
  await production.controller.load()
  expect(production.controller.discoveryNavigation().map((item) => item.page.id)).toEqual(CATALOGUE_DISCOVERY_PAGES.map((page) => page.id))
  expect(production.controller.openDiscoveryPage('gps-system')).toBeNull()
  expect(production.controller.workspace.activeDiscoveryPageId).toBeNull()
  // A page that references a group the injected set lacks is rejected before any load.
  expect(() => new CatalogueController({ presenter: production.presenter, discoveryPages: [FIXTURE_GPS_DISCOVERY_PAGE] })).toThrow(/missing catalogue group gps-system/)

  const { controller, calls } = await gpsHarness()
  await controller.load()
  expect(controller.discoveryNavigation().map((item) => [item.page.id, item.memberCount])).toContainEqual(['gps-system', 4])
  expect(controller.openDiscoveryPage('gps-system')?.missingCatalogIds).toEqual([FIXTURE_GPS_ABSENT_MEMBER_ID])
  const discovery = calls.filter((call) => call.method === 'renderDiscovery').at(-1)?.args[0] as CatalogueDiscoveryPresentation
  expect(discovery.active).toMatchObject({ kindLabel: 'Official system', memberCountLabel: '4 objects in the current catalogue' })
  expect(discovery.active?.provenance?.rows.map((row) => row.text)).toContain('fixture-groups-1')
})

it('browses fixture GPS members from the current index and focuses or checks them one at a time', async () => {
  const { controller, counted, calls } = await gpsHarness()
  await controller.load()
  const beforeBrowse = counted.requests.length
  controller.changeWorkingSelection('900001')
  controller.openDiscoveryPage('gps-system')
  const rendered = () => calls.filter((call) => call.method === 'renderQuery').at(-1)?.args[2] as { entries: readonly { catalogId: string }[]; totalMatches: number }
  // The member window holds only present members; the absent reviewed id never becomes a row.
  expect(rendered().entries.map((entry) => entry.catalogId)).toEqual([...FIXTURE_GPS_PRESENT_MEMBER_IDS])
  expect(rendered().totalMatches).toBe(4)
  expect(controller.quickSearch(FIXTURE_GPS_ABSENT_MEMBER_ID).totalMatches).toBe(0)
  // Ordinary filters narrow page members without leaving the page.
  controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '', launchYearMin: 2026, launchYearMax: 2026, primaryOrbitClasses: ['medium-earth'] })
  expect(controller.workspace.activeDiscoveryPageId).toBe('gps-system')
  expect(rendered().totalMatches).toBe(4)

  // Checking members is individual and index-only.
  controller.changeWorkingSelection('900012')
  controller.changeWorkingSelection('900014')
  expect(controller.workspace.workingSelectionIds).toEqual(['900001', '900012', '900014'])
  expect(controller.workspace.focusedCatalogId).toBeNull()
  expect(counted.requests).toHaveLength(beforeBrowse)

  // Focusing one member loads only its owning shard.
  await controller.changeDetails('900013')
  const shard = controller.snapshot!.manifest.shards[controller.snapshot!.index.entries.find((entry) => entry.catalogId === '900013')!.shard].path
  expect(counted.requests.slice(beforeBrowse)).toEqual([shard])
  expect(controller.workspace).toMatchObject({ focusedCatalogId: '900013', workingSelectionIds: ['900001', '900012', '900014'], comparedCatalogIds: [], activeDiscoveryPageId: 'gps-system' })
  expect(calls.filter((call) => call.method === 'showDetails').map((call) => (call.args[0] as { NORAD_CAT_ID: string }).NORAD_CAT_ID)).toEqual(['900013'])

  // Missing reviewed ids cannot be resolved into records, so no add can fabricate them.
  const resolved = await controller.resolveRecords(['900012', FIXTURE_GPS_ABSENT_MEMBER_ID], { requireAll: true })
  expect(resolved).toMatchObject({ records: [], missingIds: [FIXTURE_GPS_ABSENT_MEMBER_ID] })
})

it('caps comparison at four and keeps every compared record removable and clearable', async () => {
  const { controller, calls } = await gpsHarness()
  await controller.load()
  const five = ['900011', '900012', '900013', '900014', '900001']
  await controller.changeComparison(five)
  expect(controller.workspace.comparedCatalogIds).toEqual(five.slice(0, 4))
  expect(comparisonStates(calls)).toEqual(five.slice(0, 4).map((id) => `${id}:loaded`))
  await controller.changeComparison(['900011', '900013', '900014'])
  expect(comparisonStates(calls)).toEqual(['900011:loaded', '900013:loaded', '900014:loaded'])
  await controller.changeComparison([...controller.workspace.comparedCatalogIds, '900001'])
  expect(controller.workspace.comparedCatalogIds).toEqual(['900011', '900013', '900014', '900001'])
  await controller.changeComparison([])
  expect(controller.workspace.comparedCatalogIds).toEqual([])
  expect(lastComparison(calls)).toBeNull()
  expect(controller.workspace).toMatchObject({ focusedCatalogId: null, workingSelectionIds: [] })
})

it('shows per-column loading and failure, retries one column and keeps the others usable', async () => {
  const { controller, counted, payloads, calls } = await gpsHarness()
  await controller.load()
  const manifest = controller.snapshot!.manifest
  const shardOf = (id: string) => manifest.shards[controller.snapshot!.index.entries.find((entry) => entry.catalogId === id)!.shard].path
  // 900011 and 900013 share one shard; 900012 is in the other.
  expect(shardOf('900011')).toBe(shardOf('900013'))
  expect(shardOf('900012')).not.toBe(shardOf('900011'))
  const failing = shardOf('900012'); const bytes = payloads.get(failing)!
  payloads.delete(failing)
  counted.gate(shardOf('900011'))
  const pending = controller.changeComparison(['900011', '900012'])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(comparisonStates(calls)).toEqual(['900011:loading', '900012:error'])
  counted.release(shardOf('900011'))
  await pending
  expect(comparisonStates(calls)).toEqual(['900011:loaded', '900012:error'])

  payloads.set(failing, bytes)
  const before = counted.requests.length
  await controller.retryComparison('900012')
  expect(comparisonStates(calls)).toEqual(['900011:loaded', '900012:loaded'])
  // Retry refetches only the failed shard; the loaded column is reused.
  expect(counted.requests.slice(before)).toEqual([failing])
  expect(controller.workspace.comparedCatalogIds).toEqual(['900011', '900012'])
})

it('never publishes a stale comparison after removal, clear or snapshot replacement', async () => {
  const { controller, counted, payloads, calls } = await harness({ honorAbort: false })
  await controller.load()
  const manifest = controller.snapshot!.manifest
  const shard0 = manifest.shards[0].path
  counted.gate(shard0)
  const removed = controller.changeComparison(['900001'])
  await Promise.resolve()
  await controller.changeComparison([])
  counted.release(shard0)
  await removed
  expect(lastComparison(calls)).toBeNull()
  expect(calls.filter((call) => call.method === 'setComparison').every((call) => (call.args[0] as CatalogueComparisonItem[]).every((item) => item.state !== 'loaded'))).toBe(true)

  // A replacement snapshot clears comparison; the old in-flight record never lands.
  const shard1 = manifest.shards[1].path
  counted.gate(shard1)
  const stale = controller.changeComparison(['900002'])
  await Promise.resolve()
  const replacement = await legacySnapshotPayloads('2026-09-10T00:17:00Z')
  for (const [path, value] of replacement) payloads.set(path, value)
  await controller.refresh()
  counted.release(shard1)
  await stale
  expect(controller.workspace.comparedCatalogIds).toEqual([])
  expect(lastComparison(calls)).toBeNull()
})

it('shares cached shards across Details, Compare and Add selected', async () => {
  const { controller, counted } = await gpsHarness()
  await controller.load()
  const before = counted.requests.length
  await controller.changeDetails('900011')
  await controller.changeComparison(['900013', '900012'])
  await controller.resolveRecords(['900011', '900012', '900013', '900014'], { requireAll: true })
  await controller.changeDetails('900014')
  // Two shards hold all four members; each is fetched exactly once.
  expect(counted.requests.slice(before).sort()).toEqual(controller.snapshot!.manifest.shards.map((shard) => shard.path).sort())
})

it('keeps focused, working and compared ids independent in every order of explicit actions', async () => {
  const { controller } = await gpsHarness()
  await controller.load()
  const actions: Record<string, () => Promise<void> | void> = {
    focus: () => controller.changeDetails('900011'),
    check: () => controller.changeWorkingSelection('900012'),
    compare: () => controller.changeComparison([...controller.workspace.comparedCatalogIds, '900013']),
  }
  const undo: Record<string, () => Promise<void> | void> = {
    focus: () => controller.changeDetails(null),
    check: () => controller.changeWorkingSelection('900012'),
    compare: () => controller.changeComparison(controller.workspace.comparedCatalogIds.filter((id) => id !== '900013')),
  }
  const expected = (done: ReadonlySet<string>) => ({
    focusedCatalogId: done.has('focus') ? '900011' : null,
    workingSelectionIds: done.has('check') ? ['900012'] : [],
    comparedCatalogIds: done.has('compare') ? ['900013'] : [],
  })
  const orders = [['focus', 'check', 'compare'], ['focus', 'compare', 'check'], ['check', 'focus', 'compare'], ['check', 'compare', 'focus'], ['compare', 'focus', 'check'], ['compare', 'check', 'focus']]
  for (const order of orders) {
    for (const undoOrder of orders) {
      const done = new Set<string>()
      for (const action of order) { await actions[action](); done.add(action); expect(controller.workspace, `${order} then ${action}`).toMatchObject(expected(done)) }
      for (const action of undoOrder) { await undo[action](); done.delete(action); expect(controller.workspace, `${order} undo ${undoOrder} at ${action}`).toMatchObject(expected(done)) }
    }
  }
})

it('reconciles a replacement snapshot: keeps quick text, clears page/working/focus/comparison and announces why', async () => {
  const { payloads, controller, calls } = await harness()
  await controller.load()
  controller.openDiscoveryPage('low-earth-orbit')
  controller.changeWorkingSelection('900002'); controller.changeWorkingSelection('900001')
  controller.quickSearch('synthetic')
  await controller.changeDetails('900001')
  const replacement = await legacySnapshotPayloads('2026-09-10T00:17:00Z')
  payloads.clear()
  for (const [path, bytes] of replacement) payloads.set(path, bytes)
  const before = calls.length
  await controller.refresh()
  expect(controller.workspace.quickSearchText).toBe('synthetic')
  expect(controller.workspace.activeDiscoveryPageId).toBeNull()
  expect(controller.workspace.workingSelectionIds).toEqual([])
  expect(controller.workspace.focusedCatalogId).toBeNull()
  const after = calls.slice(before)
  expect(after.filter((call) => call.method === 'setCatalogueNotice').map((call) => call.args[0])).toEqual([
    'Catalogue updated; working selection was cleared.',
    'This Discovery Page is not available in the current catalogue snapshot.',
  ])
  const quick = after.filter((call) => call.method === 'renderQuickSearch')
  expect(quick).toHaveLength(1)
  expect(quick[0].args[1]).toBe('snapshot')
})

it('keeps catalogue working state and does not reopen Quick Search after a same-snapshot refresh', async () => {
  const { controller, calls } = await harness()
  await controller.load()
  controller.openDiscoveryPage('low-earth-orbit')
  controller.changeWorkingSelection('900001')
  controller.quickSearch('synthetic')
  const before = calls.length
  await controller.refresh()
  expect(controller.workspace.activeDiscoveryPageId).toBe('low-earth-orbit')
  expect(controller.workspace.workingSelectionIds).toEqual(['900001'])
  expect(controller.workspace.quickSearchText).toBe('synthetic')
  expect(calls.slice(before).some((call) => call.method === 'renderQuickSearch' || call.method === 'setCatalogueNotice')).toBe(false)
})

it('checks, discovers and navigates without requesting a record shard', async () => {
  const { counted, controller } = await harness()
  await controller.load()
  const requestCount = counted.requests.length
  controller.changeWorkingSelection('900001'); controller.changeWorkingSelection('900003'); controller.changeWorkingSelection('900001')
  expect(controller.workspace.workingSelectionIds).toEqual(['900003'])
  expect(controller.discoveryNavigation().map((item) => item.page.id)).toEqual(['low-earth-orbit', 'medium-earth-orbit', 'geosynchronous-orbit', 'highly-elliptical-orbits', 'rocket-bodies', 'debris'])
  controller.openDiscoveryPage('debris'); controller.browseAll()
  controller.setFullQuery({ ...EMPTY_CATALOGUE_QUERY, text: 'synthetic' })
  controller.clearWorkingSelection()
  expect(controller.workspace.workingSelectionIds).toEqual([])
  expect(counted.requests).toHaveLength(requestCount)
})

const lastDiscovery = (calls: readonly PresenterCall[]) => calls.filter((call) => call.method === 'renderDiscovery').at(-1)?.args[0] as CatalogueDiscoveryPresentation | undefined
const lastResult = (calls: readonly PresenterCall[]) => calls.filter((call) => call.method === 'renderQuery').at(-1)?.args[2] as { totalMatches: number; entries: readonly { catalogId: string }[] }

it('lands on Explore plus the first bounded all-catalogue window, and follows the page/search transitions', async () => {
  const { controller, calls } = await harness()
  await controller.load()
  expect(lastDiscovery(calls)?.cards.map((card) => card.id)).toHaveLength(6)
  expect(lastDiscovery(calls)?.active).toBeNull()
  expect(lastResult(calls).totalMatches).toBe(3)

  controller.openDiscoveryPage('rocket-bodies')
  expect(lastDiscovery(calls)).toMatchObject({ scopeSummary: 'Discovery Page: Rocket bodies', active: { memberCountLabel: '1 object in the current catalogue' } })
  expect(lastResult(calls).entries.map((entry) => entry.catalogId)).toEqual(['900003'])

  // Filters and sorting narrow page members; Clear filters stays on the page.
  controller.query({ ...controller.workspace.query, primaryOrbitClasses: ['low-earth'], sort: 'name' })
  expect(controller.workspace.activeDiscoveryPageId).toBe('rocket-bodies')
  expect(lastResult(calls).totalMatches).toBe(0)
  controller.query(clearCatalogueFilters(controller.workspace.query))
  expect(controller.workspace.activeDiscoveryPageId).toBe('rocket-bodies')
  expect(controller.workspace.query.sort).toBe('name')
  expect(lastResult(calls).totalMatches).toBe(1)

  // Global search typing returns to all-catalogue scope and keeps the non-text filters.
  controller.query({ ...controller.workspace.query, typeCategories: ['payload'] })
  controller.query({ ...controller.workspace.query, text: 'synthetic' })
  expect(controller.workspace.activeDiscoveryPageId).toBeNull()
  expect(controller.workspace.query).toMatchObject({ text: 'synthetic', typeCategories: ['payload'], sort: 'name' })
  expect(lastDiscovery(calls)?.scopeSummary).toBe('All catalogue objects')

  controller.openDiscoveryPage('debris')
  expect(lastDiscovery(calls)?.cards.find((card) => card.id === 'debris')).toMatchObject({ countLabel: '0 objects', active: true })
  controller.browseAll()
  expect(controller.workspace.activeDiscoveryPageId).toBeNull()
  expect(controller.workspace.query).toEqual(EMPTY_CATALOGUE_QUERY)
})

it('keeps focus, comparison and working selection unchanged by search, filters, sort and page browsing', async () => {
  const { counted, controller } = await harness()
  await controller.load()
  await controller.changeDetails('900002')
  await controller.changeComparison(['900001'])
  controller.changeWorkingSelection('900003')
  const requestCount = counted.requests.length
  controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '9000', sort: 'catalog-id' })
  controller.openDiscoveryPage('low-earth-orbit')
  controller.query({ ...controller.workspace.query, requiredFlags: ['nearPolar'] })
  controller.browseAll()
  expect(controller.workspace).toMatchObject({ focusedCatalogId: '900002', comparedCatalogIds: ['900001'], workingSelectionIds: ['900003'] })
  expect(counted.requests).toHaveLength(requestCount)
})

it('loads only the focused record shard for Details and reuses it when Details reopens', async () => {
  const { counted, client, controller, calls } = await harness()
  await controller.load()
  const before = counted.requests.length
  await controller.changeDetails('900001')
  const shardPath = controller.snapshot!.manifest.shards[client.indexEntry('900001')!.shard].path
  expect(counted.requests.slice(before)).toEqual([shardPath])
  expect(calls.filter((call) => call.method === 'showDetails').at(-1)?.args[0]).toMatchObject({ NORAD_CAT_ID: '900001' })
  await controller.changeDetails(null)
  expect(controller.workspace.focusedCatalogId).toBeNull()
  await controller.changeDetails('900001')
  await controller.retryDetails('900001')
  expect(counted.requests.slice(before)).toEqual([shardPath])
})

it('keeps focused, working-selection and compared ids independent under every action order', async () => {
  const { controller, counted } = await harness()
  await controller.load()
  const snapshot = controller.snapshot!
  const shardOf = (id: string) => snapshot.manifest.shards[controller.snapshot!.index.entries.find((entry) => entry.catalogId === id)!.shard].path
  const before = counted.requests.length
  controller.changeWorkingSelection('900001')
  expect(controller.workspace).toMatchObject({ focusedCatalogId: null, workingSelectionIds: ['900001'], comparedCatalogIds: [] })
  expect(counted.requests).toHaveLength(before)
  await controller.changeDetails('900002')
  expect(controller.workspace).toMatchObject({ focusedCatalogId: '900002', workingSelectionIds: ['900001'], comparedCatalogIds: [] })
  await controller.changeComparison(['900003'])
  expect(controller.workspace).toMatchObject({ focusedCatalogId: '900002', workingSelectionIds: ['900001'], comparedCatalogIds: ['900003'] })
  controller.changeWorkingSelection('900002')
  controller.changeWorkingSelection('900001')
  expect(controller.workspace).toMatchObject({ focusedCatalogId: '900002', workingSelectionIds: ['900002'], comparedCatalogIds: ['900003'] })
  await controller.changeComparison([])
  await controller.changeDetails(null)
  expect(controller.workspace.workingSelectionIds).toEqual(['900002'])
  controller.clearWorkingSelection()
  expect(controller.workspace).toMatchObject({ focusedCatalogId: null, workingSelectionIds: [], comparedCatalogIds: [] })
  // Only Details and Compare loaded records: each owning shard once, never for checking.
  expect(counted.requests.slice(before).sort()).toEqual([...new Set([shardOf('900002'), shardOf('900003')])].sort())
})

it('republishes the whole catalogue state after a language change without any request', async () => {
  const { counted, controller, calls } = await harness()
  await controller.load()
  controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '9000' })
  await controller.changeDetails('900001')
  await controller.changeComparison(['900001', '900002'])
  const requests = counted.requests.length
  calls.length = 0
  controller.republish()
  expect(counted.requests).toHaveLength(requests)
  const methods = calls.map((call) => call.method)
  for (const method of ['syncWorkspace', 'setSnapshot', 'renderDiscovery', 'renderQuery', 'renderQuickSearch', 'showDetails', 'setComparison'] as const) expect(methods, method).toContain(method)
  expect(calls.find((call) => call.method === 'setSnapshot')?.args[1]).toBe(false)
  expect(comparisonStates(calls)).toEqual(['900001:loaded', '900002:loaded'])
  expect(controller.workspace.query.text).toBe('9000')
})
