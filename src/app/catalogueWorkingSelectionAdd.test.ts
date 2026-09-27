import { expect, it } from 'vitest'
import { CatalogueClient } from '../data/CatalogueClient.ts'
import { EMPTY_CATALOGUE_QUERY } from '../data/catalogueQuery.ts'
import { buildAutomaticSnapshotFixture, servedSnapshotPayloads } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { createCountingFetch } from '../test-fixtures/countingFetch.ts'
import { createDefaultOrbitLabObject, createInitialState } from '../state/initialState.ts'
import { withScene, type AppState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS, removeObjects } from '../state/sceneActions.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { buildCatalogueWorkingSelectionModel, buildWorkingSelectionPresentation } from '../ui/catalogueWorkingSelection.ts'
import { CatalogueController, type CataloguePresenter } from './CatalogueController.ts'
import { addCatalogueRecordsToScene } from './addCatalogueRecordsToScene.ts'

const noop = () => {}
const presenter: CataloguePresenter = {
  syncWorkspace: noop, setSnapshot: noop, setError: noop, renderQuery: noop, showDetails: noop, showDetailsError: noop,
  clearDetails: noop, setComparison: noop, clearComparison: noop,
}

/** Real controller, client and counted fetch around the explicit atomic add. */
async function harness(initial: AppState = createInitialState(() => 0)) {
  const payloads = await servedSnapshotPayloads(buildAutomaticSnapshotFixture())
  const counted = createCountingFetch(payloads)
  const client = new CatalogueClient({ fetch: counted.fetch, pointerSessionTtlMs: 60_000 })
  const controller = new CatalogueController({ presenter, client, now: () => Date.parse('2026-09-15T00:00:00Z') })
  await controller.load()
  let state = initial
  const commits: AppState[] = []
  const deps = {
    getState: () => state,
    commit: (next: AppState) => { state = next; commits.push(next) },
    resolveRecords: (ids: readonly string[], options: { readonly requireAll: true }) => controller.resolveRecords(ids, options),
    pendingIds: new Set<string>(),
  }
  const shardRequests = () => counted.requests.filter((path) => path.includes('/records-'))
  const model = () => buildCatalogueWorkingSelectionModel(controller.workspace.workingSelectionIds, (id) => client.indexEntry(id), state.realObjects.scene)
  return { counted, client, controller, deps, commits, shardRequests, model, state: () => state, replace: (next: AppState) => { state = next } }
}

function sceneWithPlaceholders(count: number): AppState {
  const template = createDefaultOrbitLabObject('placeholder', 0xabcdef, SIMULATION_START_INSTANT)
  return withScene(createInitialState(() => 0), 'realObjects', { objects: Array.from({ length: count }, (_, index) => ({ ...template, id: `placeholder-${index}` })), selection: { ids: [], primaryId: null } })
}

it('assembles a selection across searches and a Discovery Page without fetching, then adds it atomically with one request per distinct shard', async () => {
  const h = await harness()
  h.controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '900003' })
  h.controller.changeWorkingSelection('900003')
  h.controller.query({ ...EMPTY_CATALOGUE_QUERY, text: '900001' })
  h.controller.changeWorkingSelection('900001')
  h.controller.openDiscoveryPage('low-earth-orbit')
  h.controller.changeWorkingSelection('900002')
  h.controller.browseAll()
  expect(h.controller.workspace.workingSelectionIds).toEqual(['900003', '900001', '900002'])
  expect(h.shardRequests()).toEqual([])

  const before = buildWorkingSelectionPresentation(h.model(), false)
  expect(h.model().preview).toEqual({ totalSelected: 3, alreadyInScene: 0, newRecordsToAdd: 3, slotsRemaining: MAX_SCENE_OBJECTS, canAddAll: true })
  expect(before).toMatchObject({ addEnabled: true, addLabel: 'Add selected to scene', capacityAlert: null, viewSceneVisible: false })

  const outcome = await addCatalogueRecordsToScene(h.deps, h.controller.workspace.workingSelectionIds)
  expect(outcome.kind).toBe('added')
  const snapshot = h.controller.snapshot!
  const distinct = new Set(['900003', '900001', '900002'].map((id) => snapshot.manifest.shards[h.client.indexEntry(id)!.shard].path))
  expect(h.shardRequests().sort()).toEqual([...distinct].sort())
  expect(h.commits).toHaveLength(1)
  expect(h.state().realObjects.scene.objects.map((object) => object.id)).toEqual(['catalogue-900003', 'catalogue-900001', 'catalogue-900002'])

  // Catalogue state is untouched by the scene action: the selection stays and now reads In scene.
  expect(h.controller.workspace).toMatchObject({ workingSelectionIds: ['900003', '900001', '900002'], focusedCatalogId: null, comparedCatalogIds: [] })
  const after = buildWorkingSelectionPresentation(h.model(), false)
  expect(h.model().items.every((item) => item.inScene)).toBe(true)
  expect(h.model().preview).toMatchObject({ alreadyInScene: 3, newRecordsToAdd: 0, canAddAll: false })
  expect(after).toMatchObject({ addEnabled: false, addLabel: 'Already in scene', viewSceneVisible: true })

  // Scene removal elsewhere updates In scene and the preview; the catalogue stays loaded.
  h.replace(withScene(h.state(), 'realObjects', removeObjects(h.state().realObjects.scene, ['catalogue-900001'])))
  expect(h.model().items.find((item) => item.catalogId === '900001')?.inScene).toBe(false)
  expect(h.model().preview).toMatchObject({ alreadyInScene: 2, newRecordsToAdd: 1, canAddAll: true })
  expect(h.controller.snapshot).not.toBeNull()
})

it('explains insufficient capacity before add and makes no shard request or scene commit', async () => {
  const h = await harness(sceneWithPlaceholders(MAX_SCENE_OBJECTS - 1))
  for (const id of ['900001', '900002', '900003']) h.controller.changeWorkingSelection(id)
  const presentation = buildWorkingSelectionPresentation(h.model(), false)
  expect(h.model().preview).toEqual({ totalSelected: 3, alreadyInScene: 0, newRecordsToAdd: 3, slotsRemaining: 1, canAddAll: false })
  expect(presentation.addEnabled).toBe(false)
  expect(presentation.capacityAlert).toContain('Remove 2 from the working selection or remove objects in Scene Objects.')

  const before = h.state()
  expect(await addCatalogueRecordsToScene(h.deps, h.controller.workspace.workingSelectionIds)).toEqual({ kind: 'refused-capacity', available: 1, requested: 3 })
  expect(h.shardRequests()).toEqual([])
  expect(h.commits).toHaveLength(0)
  expect(h.state()).toBe(before)

  // Reducing the selection makes it fit.
  h.controller.changeWorkingSelection('900002'); h.controller.changeWorkingSelection('900003')
  expect(buildWorkingSelectionPresentation(h.model(), false)).toMatchObject({ addEnabled: true, capacityAlert: null })
})

it('refuses a selection with an id missing from the index before any shard request', async () => {
  const h = await harness()
  expect(await addCatalogueRecordsToScene(h.deps, ['900001', '999999999'])).toEqual({ kind: 'missing-records', missingIds: ['999999999'] })
  expect(h.shardRequests()).toEqual([])
  expect(h.commits).toHaveLength(0)
})

it('stays atomic when the scene changes while the selected records load', async () => {
  const h = await harness(sceneWithPlaceholders(MAX_SCENE_OBJECTS - 3))
  const snapshot = h.controller.snapshot!
  const path = snapshot.manifest.shards[h.client.indexEntry('900002')!.shard].path
  h.counted.gate(path)
  const pending = addCatalogueRecordsToScene(h.deps, ['900001', '900002', '900003'])
  await Promise.resolve()
  // Another action consumes two of the three free slots before the records arrive.
  h.replace(sceneWithPlaceholders(MAX_SCENE_OBJECTS - 1))
  h.counted.release(path)
  expect(await pending).toEqual({ kind: 'refused-capacity', available: 1, requested: 3 })
  expect(h.commits).toHaveLength(0)
  expect(h.state().realObjects.scene.objects.every((object) => object.id.startsWith('placeholder-'))).toBe(true)

  // An unrelated change that keeps the plan valid commits the whole set once on the latest scene.
  h.replace(sceneWithPlaceholders(1))
  h.counted.gate(path)
  const rebased = addCatalogueRecordsToScene(h.deps, ['900001', '900002'])
  await Promise.resolve()
  h.replace(sceneWithPlaceholders(2))
  h.counted.release(path)
  expect((await rebased).kind).toBe('added')
  expect(h.commits).toHaveLength(1)
  expect(h.state().realObjects.scene.objects.map((object) => object.id)).toEqual(['placeholder-0', 'placeholder-1', 'catalogue-900001', 'catalogue-900002'])
})
