import { expect, it } from 'vitest'
import { decodeCatalogueIndex, decodeCatalogueManifest, decodeCatalogueShard } from '../data/catalogueSchema.ts'
import { buildAutomaticSnapshotFixture } from '../data/fixtures/automaticCatalogueSnapshot.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { sceneObjectFromCatalogueRecord } from '../app/catalogueToScene.ts'
import { createDefaultOrbitLabObject } from '../state/initialState.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'
import type { SceneState } from '../state/AppState.ts'
import { quickSearchIdentity, quickSearchKeyTarget, quickSearchPrimaryAction } from './catalogueQuickSearchModel.ts'

const fixture = buildAutomaticSnapshotFixture()
const manifest = decodeCatalogueManifest(fixture.manifest)
const index = decodeCatalogueIndex(fixture.index, manifest)
const entry = (id: string) => index.entries.find((candidate) => candidate.catalogId === id)!

function catalogueObject(id: string) {
  const shardIndex = fixture.shards.findIndex((shard) => id in shard.records)
  const record = decodeCatalogueShard(fixture.shards[shardIndex], manifest, shardIndex).records[id]
  const result = sceneObjectFromCatalogueRecord(record, manifest, 0x123456)
  if (!result.ok) throw new Error(result.message)
  return result.object
}

function scene(objects: SceneState['objects']): SceneState { return { objects, selection: { ids: [], primaryId: null } } }
function fillers(count: number): SceneState['objects'] { return Array.from({ length: count }, (_, index) => createDefaultOrbitLabObject(`filler-${index}`, 0x445566, SIMULATION_START_INSTANT)) }

it('shows index-only compact identity without launch date or epoch', () => {
  const identity = quickSearchIdentity(entry('900001'))
  expect(identity.name).toBe(entry('900001').name)
  expect(identity.details[0]).toBe('NORAD 900001')
  expect(identity.details).toContain('Payload')
  expect(identity.details.join(' ')).not.toContain(entry('900001').epochUtc)
  expect(identity.details.join(' ')).not.toContain(entry('900001').src!.l)
})

it('derives Add, Select in scene, pending and Scene full actions from the scene alone', () => {
  const candidate = entry('900001')
  expect(quickSearchPrimaryAction(candidate, scene([]), false)).toMatchObject({ kind: 'add', label: 'Add to scene', disabled: false, inScene: false })
  expect(quickSearchPrimaryAction(candidate, scene([]), true)).toMatchObject({ kind: 'add', label: 'Adding…', disabled: false })
  const present = catalogueObject('900001')
  expect(quickSearchPrimaryAction(candidate, scene([present]), false)).toMatchObject({ kind: 'select', label: 'Select in scene', inScene: true, sceneObjectId: present.id, accessibleLabel: `Select ${candidate.name} in scene` })

  const full = scene(fillers(MAX_SCENE_OBJECTS))
  expect(quickSearchPrimaryAction(candidate, full, false)).toMatchObject({ kind: 'add', label: 'Scene full', disabled: true })
  const fullWithPresent = scene([present, ...fillers(MAX_SCENE_OBJECTS - 1)])
  expect(quickSearchPrimaryAction(candidate, fullWithPresent, false)).toMatchObject({ kind: 'select', disabled: false })
})

it('moves keyboard focus as specified', () => {
  expect(quickSearchKeyTarget('ArrowDown', null, 3)).toEqual({ kind: 'result', index: 0 })
  expect(quickSearchKeyTarget('Enter', null, 3)).toEqual({ kind: 'result', index: 0 })
  expect(quickSearchKeyTarget('ArrowUp', null, 3)).toEqual({ kind: 'result', index: 2 })
  expect(quickSearchKeyTarget('ArrowDown', 0, 3)).toEqual({ kind: 'result', index: 1 })
  expect(quickSearchKeyTarget('ArrowDown', 2, 3)).toEqual({ kind: 'none' })
  expect(quickSearchKeyTarget('ArrowUp', 1, 3)).toEqual({ kind: 'result', index: 0 })
  expect(quickSearchKeyTarget('ArrowUp', 0, 3)).toEqual({ kind: 'input' })
  expect(quickSearchKeyTarget('ArrowDown', null, 0)).toEqual({ kind: 'none' })
  expect(quickSearchKeyTarget('Enter', 1, 3)).toEqual({ kind: 'none' })
})
