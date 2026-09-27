import { expect, it, vi } from 'vitest'
import { decodeCatalogueManifest, decodeCatalogueShard, type CatalogueManifestV1, type CatalogueRecordV1 } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { createDefaultOrbitLabObject, createInitialState } from '../state/initialState.ts'
import { withScene, type AppState, type SceneState } from '../state/AppState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { addCatalogueRecordsToScene, type AddCatalogueRecordsDependencies } from './addCatalogueRecordsToScene.ts'
import { sceneObjectFromCatalogueRecord } from './catalogueToScene.ts'

function catalogueFixture(): { manifest: CatalogueManifestV1; records: CatalogueRecordV1[] } {
  const fixture = buildAutomaticSnapshotFixture()
  const manifest = decodeCatalogueManifest(fixture.manifest)
  const records = fixture.shards.flatMap((shard, index) => Object.values(decodeCatalogueShard(shard, manifest, index).records))
  return { manifest, records }
}

function stateHarness(initial = createInitialState(() => 0)) {
  let state = initial
  const commits: AppState[] = []
  const { manifest, records } = catalogueFixture()
  const resolveRecords = vi.fn(async (ids: readonly string[]) => ({
    snapshotId: manifest.snapshotId, manifest,
    records: records.filter((record) => ids.includes(record.NORAD_CAT_ID)),
    missingIds: ids.filter((id) => !records.some((record) => record.NORAD_CAT_ID === id)),
  }))
  const deps: AddCatalogueRecordsDependencies = {
    getState: () => state,
    commit: (next) => { state = next; commits.push(next) },
    resolveRecords,
    pendingIds: new Set(),
  }
  return { deps, records, manifest, resolveRecords, commits, state: () => state, replace: (next: AppState) => { state = next } }
}

function expectSceneInvariants(scene: SceneState): void {
  const ids = scene.objects.map((object) => object.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(scene.selection.ids.every((id) => ids.includes(id))).toBe(true)
  expect(scene.selection.primaryId === null || scene.selection.ids.includes(scene.selection.primaryId)).toBe(true)
}

it('adds multiple records atomically to Real Objects in request order', async () => {
  const harness = stateHarness()
  const outcome = await addCatalogueRecordsToScene(harness.deps, ['900002', '900001', '900003'])
  expect(outcome.kind).toBe('added')
  expect(harness.resolveRecords).toHaveBeenCalledOnce()
  expect(harness.resolveRecords).toHaveBeenCalledWith(['900002', '900001', '900003'], { requireAll: true })
  expect(harness.commits).toHaveLength(1)
  expect(harness.state().activeMode).toBe('orbitLab')
  expect(harness.state().realObjects.scene.selection).toEqual({ ids: ['catalogue-900002', 'catalogue-900001', 'catalogue-900003'], primaryId: 'catalogue-900002' })
  expectSceneInvariants(harness.state().realObjects.scene)
})

it('selects present records without fetching and adds only missing records in a mixed request', async () => {
  const base = stateHarness()
  const existingRecord = base.records.find((record) => record.NORAD_CAT_ID === '900001')!
  const existing = sceneObjectFromCatalogueRecord(existingRecord, base.manifest, 0xff0000)
  if (!existing.ok) throw new Error('Expected valid fixture record.')
  const initial = withScene(createInitialState(() => 0), 'realObjects', { objects: [{ ...existing.object, id: 'legacy-scene-id' }], selection: { ids: [], primaryId: null } })
  const harness = stateHarness(initial)
  const outcome = await addCatalogueRecordsToScene(harness.deps, ['900002', '900001', '900003'])
  expect(harness.resolveRecords).toHaveBeenCalledWith(['900002', '900003'], { requireAll: true })
  expect(harness.state().realObjects.scene.selection).toEqual({ ids: ['catalogue-900002', 'legacy-scene-id', 'catalogue-900003'], primaryId: 'catalogue-900002' })
  expect(outcome).toMatchObject({ kind: 'added', alreadyPresent: [{ sceneId: 'legacy-scene-id', catalogId: '900001' }] })
  const repeated = await addCatalogueRecordsToScene(harness.deps, ['900002', '900001', '900003'])
  expect(repeated.kind).toBe('already-present')
  expect(harness.resolveRecords).toHaveBeenCalledTimes(1)
})

it('refuses missing and over-capacity requests without a partial commit', async () => {
  const missing = stateHarness()
  const before = missing.state().realObjects.scene
  expect(await addCatalogueRecordsToScene(missing.deps, ['900001', '999999999'])).toEqual({ kind: 'missing-records', missingIds: ['999999999'] })
  expect(missing.commits).toHaveLength(0)
  expect(missing.state().realObjects.scene).toBe(before)

  const template = createDefaultOrbitLabObject('full', 0xabcdef, SIMULATION_START_INSTANT)
  const fullScene: SceneState = { objects: Array.from({ length: MAX_SCENE_OBJECTS }, (_, index) => ({ ...template, id: `full-${index}` })), selection: { ids: [], primaryId: null } }
  const full = stateHarness(withScene(createInitialState(() => 0), 'realObjects', fullScene))
  expect(await addCatalogueRecordsToScene(full.deps, ['900001'])).toEqual({ kind: 'refused-capacity', available: 0, requested: 1 })
  expect(full.resolveRecords).not.toHaveBeenCalled()
  expect(full.commits).toHaveLength(0)
})

it('never duplicates concurrent additions and always clears pending ids', async () => {
  const harness = stateHarness()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = harness.deps.resolveRecords
  harness.deps.resolveRecords = async (ids, options) => { await gate; return original(ids, options) }
  const first = addCatalogueRecordsToScene(harness.deps, ['900001'])
  await Promise.resolve()
  expect(await addCatalogueRecordsToScene(harness.deps, ['900001'])).toEqual({ kind: 'in-progress', catalogIds: ['900001'] })
  release()
  expect((await first).kind).toBe('added')
  expect(harness.state().realObjects.scene.objects.filter((object) => object.id === 'catalogue-900001')).toHaveLength(1)
  expect(harness.deps.pendingIds.size).toBe(0)
})

it('detects scene changes while loading and commits no subset', async () => {
  const base = stateHarness()
  const record = base.records.find((candidate) => candidate.NORAD_CAT_ID === '900001')!
  const converted = sceneObjectFromCatalogueRecord(record, base.manifest, 0xff0000)
  if (!converted.ok) throw new Error('Expected valid fixture record.')
  const initial = withScene(createInitialState(() => 0), 'realObjects', { objects: [converted.object], selection: { ids: [converted.object.id], primaryId: converted.object.id } })
  const harness = stateHarness(initial)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = harness.deps.resolveRecords
  harness.deps.resolveRecords = async (ids, options) => { await gate; return original(ids, options) }
  const pending = addCatalogueRecordsToScene(harness.deps, ['900001', '900002'])
  await Promise.resolve()
  harness.replace(withScene(harness.state(), 'realObjects', { objects: [], selection: { ids: [], primaryId: null } }))
  release()
  expect(await pending).toEqual({ kind: 'failed', reason: { kind: 'scene-changed' } })
  expect(harness.commits).toHaveLength(0)
  expect(harness.state().realObjects.scene.objects).toEqual([])
})

it('gives newly created members of a group add one shared colour and keeps existing colours', async () => {
  const base = stateHarness()
  const existingRecord = base.records.find((record) => record.NORAD_CAT_ID === '900001')!
  const existing = sceneObjectFromCatalogueRecord(existingRecord, base.manifest, 0xff0000)
  if (!existing.ok) throw new Error('Expected valid fixture record.')
  const harness = stateHarness(withScene(createInitialState(() => 0), 'realObjects', { objects: [existing.object], selection: { ids: [], primaryId: null } }))
  const outcome = await addCatalogueRecordsToScene(harness.deps, ['900001', '900002', '900003'], { sharedColor: true })
  expect(outcome.kind).toBe('added')
  const scene = harness.state().realObjects.scene
  const colourOf = (id: string) => scene.objects.find((object) => object.id === id)!.style.colorHex
  expect(colourOf('catalogue-900001')).toBe(0xff0000)
  expect(new Set(['catalogue-900002', 'catalogue-900003'].map(colourOf)).size).toBe(1)
  expect(colourOf('catalogue-900002')).not.toBe(0xff0000)
  // Every member present afterwards is selected, pre-existing ones included.
  expect(scene.selection.ids).toEqual(['catalogue-900001', 'catalogue-900002', 'catalogue-900003'])
  // An ordinary add keeps distinct colours.
  const plain = stateHarness()
  await addCatalogueRecordsToScene(plain.deps, ['900002', '900003'])
  const plainScene = plain.state().realObjects.scene
  expect(new Set(plainScene.objects.filter((object) => object.id.startsWith('catalogue-')).map((object) => object.style.colorHex)).size).toBe(2)
})

it('refuses a group add beyond capacity without requesting a shard (70 in scene plus 32 new)', async () => {
  const template = createDefaultOrbitLabObject('template', 0x44ccff, SIMULATION_START_INSTANT)
  const seventy = Array.from({ length: 70 }, (_, index) => ({ ...template, id: `existing-${index}` }))
  const harness = stateHarness(withScene(createInitialState(() => 0), 'realObjects', { objects: seventy, selection: { ids: [], primaryId: null } }))
  const ids = Array.from({ length: 32 }, (_, index) => String(910000 + index))
  const outcome = await addCatalogueRecordsToScene(harness.deps, ids, { sharedColor: true })
  expect(outcome).toEqual({ kind: 'refused-capacity', available: MAX_SCENE_OBJECTS - 70, requested: 32 })
  expect(harness.resolveRecords).not.toHaveBeenCalled()
  expect(harness.commits).toHaveLength(0)
})
