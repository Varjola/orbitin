import { expect, it, vi } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'
import { CatalogueController, type CataloguePresenter } from './CatalogueController.ts'
import { routeCataloguePort } from './routeCatalogue.ts'

const silent: CataloguePresenter = {
  syncWorkspace: () => {}, setSnapshot: () => {}, setError: () => {}, renderQuery: () => {},
  showDetails: () => {}, showDetailsError: () => {}, clearDetails: () => {}, setComparison: () => {}, clearComparison: () => {},
}

async function controller(options: { readonly failing?: boolean } = {}) {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture())
  const counted = createCountingFetch(options.failing ? new Map() : payloads)
  return new CatalogueController({ presenter: silent, client: new CatalogueClient({ fetch: counted.fetch }), now: () => Date.parse('2026-09-15T00:00:00Z') })
}

it('loads the catalogue when asked, and searches it', async () => {
  const catalogue = await controller()
  const port = routeCataloguePort(() => catalogue)
  expect(port.search('synthetic', 8).entries).toEqual([])
  expect(await port.load()).toBe(true)
  expect(port.search('synthetic', 2)).toEqual({ entries: [{ catalogId: '900001', name: 'SYNTHETIC 900001' }, { catalogId: '900002', name: 'SYNTHETIC 900002' }], hasMore: true })
})

it('gives a record’s name and SGP4 elements, or why it has none', async () => {
  const catalogue = await controller()
  const port = routeCataloguePort(() => catalogue)
  expect(await port.record('900001')).toEqual({ ok: false, refusal: 'unavailable' })
  await port.load()
  const found = await port.record('900001')
  expect(found).toMatchObject({ ok: true, catalogId: '900001', name: 'SYNTHETIC 900001' })
  expect(found.ok && found.elements.inclinationRad).toBeCloseTo(51.64 * Math.PI / 180, 9)
  expect(await port.record('12345')).toEqual({ ok: false, refusal: 'missing' })
})

it('says the catalogue is unavailable when it cannot be loaded', async () => {
  // The controller reports the failure on the console; it is expected here.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const catalogue = await controller({ failing: true })
    const port = routeCataloguePort(() => catalogue)
    expect(await port.load()).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Catalogue load failed'))
  } finally {
    warn.mockRestore()
  }
})
