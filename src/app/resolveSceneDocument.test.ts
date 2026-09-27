import { expect, it, vi } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { decodeCatalogueManifest, decodeCatalogueShard } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { encodeSceneDocument, type SceneDocumentV1 } from '../data/sceneDocument.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'
import { EMPTY_SCENE, withScene } from '../state/AppState.ts'
import { createInitialState } from '../state/initialState.ts'
import { CatalogueController, type CataloguePresenter } from './CatalogueController.ts'
import { sceneObjectFromCatalogueRecord } from './catalogueToScene.ts'
import { resolveSceneDocument } from './resolveSceneDocument.ts'

const presenter: CataloguePresenter = {
  syncWorkspace() {}, setSnapshot() {}, setError() {}, renderQuery() {}, showDetails() {},
  showDetailsError() {}, clearDetails() {}, setComparison() {}, clearComparison() {},
}

function fixtureObjects() {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const objects = fixture.shards.flatMap((shard, shardIndex) => Object.values(decodeCatalogueShard(shard, manifest, shardIndex).records)).map((record, index) => {
    const result = sceneObjectFromCatalogueRecord(record, manifest, 0x3366ff + index)
    if (!result.ok) throw new Error('Catalogue fixture failed.')
    return result.object
  })
  return { fixture, objects }
}

async function controllerHarness() {
  const { fixture } = fixtureObjects()
  const payloads = await servedSnapshotPayloads(fixture)
  const counted = createCountingFetch(payloads)
  const client = new CatalogueClient({ fetch: counted.fetch, pointerSessionTtlMs: 60_000 })
  const controller = new CatalogueController({ presenter, client })
  return { controller, client, counted }
}

it('resolves pure Orbit Lab and empty Real Objects scenes without catalogue calls', async () => {
  const state = withScene(createInitialState(() => 0), 'realObjects', EMPTY_SCENE)
  const document = encodeSceneDocument(state, { includeSimulation: true })
  const loadCatalogue = vi.fn(async () => {})
  const resolveRecords = vi.fn()
  const result = await resolveSceneDocument(document, { loadCatalogue, resolveRecords })
  expect(loadCatalogue).not.toHaveBeenCalled()
  expect(resolveRecords).not.toHaveBeenCalled()
  expect(result.orbitLab.objects).toHaveLength(1)
  expect(result.orbitLab.selection).toEqual(state.orbitLab.scene.selection)
})

it('loads exactly the catalogue pages referenced by the document and restores selection order', async () => {
  const { objects } = fixtureObjects()
  const selected = [objects[2].id, objects[0].id]
  const state = withScene(createInitialState(() => 0), 'realObjects', { objects, selection: { ids: selected, primaryId: objects[0].id } })
  const document = encodeSceneDocument({ ...state, activeMode: 'realObjects' }, { includeSimulation: true })
  const { controller, client, counted } = await controllerHarness()
  const result = await resolveSceneDocument(document, { loadCatalogue: () => controller.load(), resolveRecords: (ids) => controller.resolveRecords(ids) })
  expect(result.realObjects.selection).toEqual({ ids: selected, primaryId: objects[0].id })
  expect(result.realObjects.objects.map((object) => object.id)).toEqual(objects.map((object) => object.id))
  const expectedPages = new Set(document.realObjects.objects.map((object) => {
    if (object.kind !== 'catalogue') throw new Error('Expected catalogue references.')
    const shard = client.indexEntry(object.catalogId)!.shard
    return controller.snapshot!.manifest.shards[shard].path
  }))
  expect(counted.requests.filter((path) => path.includes('records-')).sort()).toEqual([...expectedPages].sort())
  controller.dispose()
})

it('reports missing and changed catalogue elements while keeping valid objects', async () => {
  const { objects } = fixtureObjects()
  const state = withScene(createInitialState(() => 0), 'realObjects', { objects: objects.slice(0, 2), selection: { ids: [objects[0].id, objects[1].id], primaryId: objects[1].id } })
  const document: any = JSON.parse(JSON.stringify(encodeSceneDocument(state, { includeSimulation: false })))
  document.realObjects.objects[0].savedEpochUnixSeconds -= 60
  document.realObjects.objects[1].catalogId = '999999999'
  const missingId = document.realObjects.objects[1].id
  const { controller } = await controllerHarness()
  const result = await resolveSceneDocument(document as SceneDocumentV1, { loadCatalogue: () => controller.load(), resolveRecords: (ids) => controller.resolveRecords(ids) })
  expect(result.problems).toContainEqual(expect.objectContaining({ kind: 'element-set-changed', id: objects[0].id }))
  expect(result.problems).toContainEqual({ kind: 'catalogue-missing', id: missingId, catalogId: '999999999' })
  expect(result.realObjects.objects.map((object) => object.id)).toEqual([objects[0].id])
  expect(result.realObjects.selection).toEqual({ ids: [objects[0].id], primaryId: objects[0].id })
  controller.dispose()
})

it('propagates catalogue failures instead of opening a half-resolved scene', async () => {
  const { objects } = fixtureObjects()
  const state = withScene(createInitialState(() => 0), 'realObjects', { objects: [objects[0]], selection: { ids: [objects[0].id], primaryId: objects[0].id } })
  const document = encodeSceneDocument(state, { includeSimulation: false })
  await expect(resolveSceneDocument(document, {
    loadCatalogue: async () => {},
    resolveRecords: async () => { throw new Error('offline') },
  })).rejects.toThrow('offline')
})

it('loads an over-budget document, trims the layer in document order and reports it', async () => {
  const base = createInitialState(() => 0)
  const template = base.orbitLab.scene.objects[0]
  const objects = Array.from({ length: 80 }, (_, index) => ({ ...template, id: `lab-${index}`, display: { ...template.display, sensorGeometryVisible: true } }))
  const state = withScene(withScene(base, 'orbitLab', { objects, selection: { ids: [], primaryId: null } }), 'realObjects', EMPTY_SCENE)
  const result = await resolveSceneDocument(encodeSceneDocument(state, { includeSimulation: false }), { loadCatalogue: vi.fn(), resolveRecords: vi.fn() })
  // Nothing is refused or removed; the layer is turned off beyond the budget.
  expect(result.orbitLab.objects).toHaveLength(80)
  expect(result.orbitLab.objects.filter((object) => object.display.sensorGeometryVisible)).toHaveLength(75)
  expect(result.orbitLab.objects.slice(0, 75).every((object) => object.display.sensorGeometryVisible)).toBe(true)
  expect(result.problems).toEqual([{ kind: 'layer-budget', mode: 'orbitLab', layer: 'sensorGeometry', budget: 75, changedIds: objects.slice(75).map((object) => object.id) }])
})
