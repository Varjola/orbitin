import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createSyntheticScene } from '../test-fixtures/syntheticScene.ts'
import type { SceneState } from '../state/AppState.ts'
import { focusCameraPosition } from '../scene/cameraFocus.ts'
import { orbitCollectionRadius } from '../scene/cameraFit.ts'
import { withLayer } from '../state/sceneComplexity.ts'
import { activeObjectSummary, applyHeaderAction, buildSceneObjectsModel, sceneObjectsToggleLabel, removeSelectedConfirmation, removeSelectedLabel, sceneObjectMatches } from './sceneObjectsModel.ts'
import { buildBulkInspectorModel, bulkLayerTarget } from './bulkInspectorModel.ts'

const objects = createSyntheticScene(12).map((item) => item.object)
const scene = (ids: readonly string[] = [], primaryId: string | null = ids[0] ?? null): SceneState => ({ objects, selection: { ids, primaryId } })
const gps = new Map([[objects[3].id, [{ groupId: 'gps-operational', title: 'GPS constellation', revision: 'r1' }]]])

it('filters by name, NORAD id and group title, case-insensitively, without touching selection', () => {
  expect(sceneObjectMatches(objects[0], 'syn leo')).toBe(true)
  expect(sceneObjectMatches(objects[0], '990001')).toBe(true)
  expect(sceneObjectMatches(objects[3], 'gps', gps)).toBe(true)
  expect(sceneObjectMatches(objects[4], 'gps', gps)).toBe(false)
  const model = buildSceneObjectsModel(scene([objects[0].id]), '  MEO ', 100)
  expect(model.rows.map((row) => row.name)).toEqual(objects.filter((object) => object.name.includes('MEO')).map((object) => object.name))
  expect(model.selectedIds).toEqual([objects[0].id])
  expect(buildSceneObjectsModel(scene(), 'nothing', 100).emptySearchMessage).toBe('No scene objects match "nothing".')
  expect(buildSceneObjectsModel(scene(), '', 100).emptySearchMessage).toBeNull()
})

it('states counts and row state in words', () => {
  const model = buildSceneObjectsModel(scene([objects[1].id, objects[0].id], objects[1].id), '', 100)
  expect(model.countLabel).toBe('12 / 100 objects')
  expect(model.selectedLabel).toBe('2 selected')
  expect(model.rows.slice(0, 3).map((row) => row.stateLabel)).toEqual(['selected', 'primary', ''])
})

it('scopes the header checkbox to every object or to the matches only', () => {
  const none = buildSceneObjectsModel(scene(), '', 100).header
  expect(none).toMatchObject({ checked: false, indeterminate: false, label: 'Select all 12 scene objects', action: 'select' })
  const some = buildSceneObjectsModel(scene([objects[0].id]), '', 100).header
  expect(some).toMatchObject({ checked: false, indeterminate: true, label: 'Select all 12 scene objects' })
  const all = buildSceneObjectsModel(scene(objects.map((object) => object.id)), '', 100).header
  expect(all).toMatchObject({ checked: true, label: 'Deselect all', action: 'deselect' })
  const matching = buildSceneObjectsModel(scene([objects[0].id]), 'MEO', 100).header
  const meo = [objects[7].id, objects[8].id, objects[9].id]
  expect(matching).toMatchObject({ label: 'Select 3 matching', action: 'select', scopeIds: meo })
  // Select matching adds only the listed rows and keeps the primary.
  expect(applyHeaderAction(scene([objects[0].id]).selection, matching)).toEqual({ ids: [objects[0].id, ...meo], primaryId: objects[0].id })
  const selectedMatching = buildSceneObjectsModel(scene([objects[0].id, ...meo]), 'MEO', 100).header
  expect(selectedMatching.label).toBe('Deselect 3 matching')
  expect(applyHeaderAction(scene([objects[0].id, ...meo]).selection, selectedMatching)).toEqual({ ids: [objects[0].id], primaryId: objects[0].id })
  // Deselecting the primary's scope moves the primary to the last remaining member.
  expect(applyHeaderAction(scene([objects[7].id, objects[0].id], objects[7].id).selection, selectedMatching)).toEqual({ ids: [objects[0].id], primaryId: objects[0].id })
  // From an empty selection, the first listed row becomes primary.
  expect(applyHeaderAction(scene().selection, none).primaryId).toBe(objects[0].id)
})

it('words bulk removal', () => {
  expect(removeSelectedLabel(3)).toBe('Remove selected (3)')
  expect(removeSelectedConfirmation(3)).toBe('Remove 3 objects from this scene?')
})

it('summarizes a multiple selection with tri-state layers and a common colour', () => {
  const mixed: SceneState = {
    objects: objects.map((object, index) => index === 0 ? withLayer(object, 'groundTrackHistory', true) : index === 1 ? withLayer(object, 'groundTrack', true) : object),
    selection: { ids: objects.slice(0, 8).map((object) => object.id), primaryId: objects[0].id },
  }
  const model = buildBulkInspectorModel(mixed)
  expect(model.countLabel).toBe('8 objects selected')
  expect(model.namesLabel).toBe(`${objects.slice(0, 6).map((object) => object.name).join(', ')} +2 more`)
  expect(model.layers).toEqual({ orbitPath: 'on', groundTrack: 'mixed', groundTrackHistory: 'mixed', sensorGeometry: 'off' })
  expect(model.commonColorHex).toBeNull()
  expect(bulkLayerTarget('mixed')).toBe(true)
  expect(bulkLayerTarget('off')).toBe(true)
  expect(bulkLayerTarget('on')).toBe(false)
  const same: SceneState = { objects: objects.map((object) => ({ ...object, style: { ...object.style, colorHex: 0xffffff } })), selection: { ids: [objects[0].id, objects[1].id], primaryId: objects[0].id } }
  expect(buildBulkInspectorModel(same).commonColorHex).toBe(0xffffff)
})

it('focuses by rotating about the Earth centre at constant distance', () => {
  const from = new THREE.Vector3(0, 0, 5)
  const towards = { x: 3, y: 0, z: 0 }
  for (const t of [0, 0.25, 0.5, 1]) expect(focusCameraPosition(from, towards, t).length()).toBeCloseTo(5, 10)
  expect(focusCameraPosition(from, towards, 1).toArray().map((value) => Number(value.toFixed(9)))).toEqual([5, 0, 0])
  expect(focusCameraPosition(from, towards, 0).toArray()).toEqual([0, 0, 5])
})

it('fits selected objects by their own collection radius', () => {
  const leo = objects[0]
  const geo = objects.find((object) => object.name.startsWith('SYN GEO'))!
  expect(orbitCollectionRadius([leo])).toBeLessThan(orbitCollectionRadius([leo, geo]))
})

it('summarizes the active object for the collapsed Scene Objects bar', () => {
  expect(activeObjectSummary(scene())).toEqual({ name: '', colorHex: null, moreSelected: 0, label: 'No object selected' })
  expect(activeObjectSummary(scene([objects[2].id]))).toEqual({ name: objects[2].name, colorHex: objects[2].style.colorHex, moreSelected: 0, label: objects[2].name })
  const many = activeObjectSummary(scene([objects[0].id, objects[1].id, objects[5].id], objects[5].id))
  expect(many.name).toBe(objects[5].name)
  expect(many.label).toBe(`${objects[5].name} +2`)
  expect(sceneObjectsToggleLabel(true)).toBe('Collapse scene objects')
  expect(sceneObjectsToggleLabel(false)).toBe('Expand scene objects')
})
