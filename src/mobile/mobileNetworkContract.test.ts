import { expect, it } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { CatalogueController, type CataloguePresenter } from '../app/CatalogueController.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'

const mobileSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = Object.entries(mobileSources).filter(([path]) => !path.endsWith('.test.ts'))
const applicationSource = (import.meta.glob('../app/Application.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../app/Application.ts']

/** Nothing on mobile loads the catalogue
 *  by itself. The Add sheet's Load button is the only mobile path to the
 *  index; adds fetch only the shards of the added records. */
it('reaches the catalogue index only through the Add sheet’s Load button', () => {
  const loaders = production.filter(([, source]) => /onCatalogueLoad|onCatalogueRefresh/.test(source)).map(([path]) => path)
  expect(loaders).toEqual(['./MobileUiRoot.ts'])
  expect(mobileSources['./MobileUiRoot.ts'].match(/callbacks\.onCatalogueLoad\(\)/g) ?? []).toHaveLength(1)
  expect(mobileSources['./MobileUiRoot.ts']).toContain('onLoad: () => callbacks.onCatalogueLoad()')
  expect(mobileSources['./MobileUiRoot.ts']).not.toContain('onCatalogueRefresh')
  // The sheet calls onLoad only from its Load (or Retry) button.
  expect(mobileSources['./AddSheetView.ts'].match(/callbacks\.onLoad\(\)/g) ?? []).toHaveLength(1)
  expect(mobileSources['./AddSheetView.ts']).toContain("this.loadButton.addEventListener('click', () => callbacks.onLoad())")
  for (const [path, source] of production) expect(source, path).not.toMatch(/\bfetch\(|resolveRecords|CatalogueClient|XMLHttpRequest|sendBeacon/)
  // Mobile adds go through the existing atomic path; the clock never jumps to an epoch.
  expect(applicationSource).toContain('const outcome = await this.addCatalogueRecords([catalogId], false, { source })')
  expect(applicationSource).toContain('const outcome = await this.addCatalogueGroup(groupId, members)')
})

it('fetches nothing to search or group before a load, the index once on load, and only referenced shards on add', async () => {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture())
  const counted = createCountingFetch(payloads)
  const client = new CatalogueClient({ fetch: counted.fetch, pointerSessionTtlMs: 60_000 })
  const presenter: CataloguePresenter = { syncWorkspace: () => {}, setSnapshot: () => {}, setError: () => {}, renderQuery: () => {}, showDetails: () => {}, showDetailsError: () => {}, clearDetails: () => {}, setComparison: () => {}, clearComparison: () => {} }
  const controller = new CatalogueController({ presenter, client })
  // What the mobile views do before Load: typing into the disabled field is impossible, but even a search asks nothing.
  controller.quickSearch('iss')
  expect(controller.discoveryPage('gps-operational')).toBeNull()
  expect(counted.requests).toEqual([])
  await controller.load()
  expect(counted.requests.map((path) => path.split('/').at(-1))).toEqual(['current.json', 'manifest.json', 'search-index.json'])
  const loaded = counted.requests.length
  const result = controller.quickSearch('synthetic')
  expect(result.entries.length).toBeGreaterThan(0)
  expect(counted.requests).toHaveLength(loaded)
  const entry = result.entries[0]
  await controller.resolveRecords([entry.catalogId])
  expect(counted.requests.slice(loaded)).toEqual([payloadPath(payloads, `records-${entry.shard}.json`)])
  controller.dispose()
})

function payloadPath(payloads: ReadonlyMap<string, Uint8Array>, name: string): string {
  return [...payloads.keys()].find((path) => path.endsWith(`/${name}`))!
}
