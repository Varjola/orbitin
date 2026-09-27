import { expect, it } from 'vitest'
import { decodeSceneDocument, encodeSceneDocument, type SceneDocumentV1 } from './sceneDocument.ts'
import { sharedSceneDocument, sharedSceneSummary, toSharedScene } from './sharedScene.ts'
import { orbitLabState, realObjectsState, sharedDocument, worstCatalogue } from '../test-fixtures/sharedSceneFixtures.ts'

it('shares only the active scene, without simulation, with normalized ids and remapped selection', () => {
  const state = realObjectsState()
  const shared = sharedSceneDocument(state)
  expect(shared.simulation).toBeNull()
  expect(shared.activeMode).toBe('realObjects')
  expect(shared.orbitLab).toEqual({ objects: [], selectedIds: [], primaryId: null })
  const catalogueIds = state.realObjects.scene.objects.slice(0, 2).map((object) => object.source.kind === 'omm' ? object.source.definition.meanElements.catalogId : '')
  expect(shared.realObjects.objects.map((object) => object.id)).toEqual([`catalogue-${catalogueIds[0]}`, `catalogue-${catalogueIds[1]}`, 'tle-1', 'tle-2', 'omm-1', 'omm-2'])
  // omm-2 and the first catalogue object were selected, the catalogue one primary.
  expect(shared.realObjects.selectedIds).toEqual(['omm-1', `catalogue-${catalogueIds[0]}`])
  expect(shared.realObjects.primaryId).toBe(`catalogue-${catalogueIds[0]}`)
  expect(shared.view).toEqual(state.view)
  expect(decodeSceneDocument(shared).ok).toBe(true)
})

it('normalizes Orbit Lab ids in scene order', () => {
  const shared = sharedSceneDocument(orbitLabState())
  expect(shared.orbitLab.objects.map((object) => object.id)).toEqual(['orbit-1', 'orbit-2', 'orbit-3'])
  expect(shared.orbitLab.selectedIds).toEqual(['orbit-2', 'orbit-3'])
  expect(shared.orbitLab.primaryId).toBe('orbit-3')
  expect(shared.realObjects.objects).toEqual([])
})

it('ignores a simulation block and the other scene when opening', () => {
  const state = orbitLabState()
  const combined = { ...realObjectsState(), orbitLab: state.orbitLab, activeMode: 'orbitLab' as const }
  const full = encodeSceneDocument(combined, { includeSimulation: true })
  expect(full.realObjects.objects.length).toBeGreaterThan(0)
  const opened = toSharedScene(full)
  expect(opened.ok).toBe(true)
  if (!opened.ok) return
  expect(opened.document.simulation).toBeNull()
  expect(opened.document.realObjects).toEqual({ objects: [], selectedIds: [], primaryId: null })
  expect(opened.document).toEqual(sharedSceneDocument(combined))
  expect(opened.document.orbitLab).toEqual(sharedSceneDocument(state).orbitLab)
})

it('rejects two catalogue objects with the same NORAD id', () => {
  const first = worstCatalogue(0)
  const document: SceneDocumentV1 = sharedDocument('realObjects', [first, { ...first, id: 'catalogue-copy' }])
  expect(decodeSceneDocument(document).ok).toBe(true)
  const opened = toSharedScene(document)
  expect(opened.ok).toBe(false)
  if (!opened.ok) expect(opened.errors.some((error) => error.message === 'Duplicate object id.')).toBe(true)
})

it('summarizes the shared mode and its object kinds', () => {
  expect(sharedSceneSummary(sharedSceneDocument(realObjectsState()))).toEqual({ mode: 'realObjects', objectCount: 6, manualObjectCount: 4, catalogueObjectCount: 2 })
  expect(sharedSceneSummary(sharedSceneDocument(orbitLabState()))).toEqual({ mode: 'orbitLab', objectCount: 3, manualObjectCount: 0, catalogueObjectCount: 0 })
})
