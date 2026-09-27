import { expect, it } from 'vitest'
import { buildCatalogueWorkingSelectionModel, buildWorkingSelectionPresentation, reconcileWorkingSelection, toggleWorkingSelection } from './catalogueWorkingSelection.ts'
import { MAX_SCENE_OBJECTS } from '../state/sceneActions.ts'

const entries = [
  { catalogId: '1', name: 'One', normalizedName: 'one', internationalDesignator: null, epochUtc: '2026-01-01T00:00:00Z', groups: [], shard: 0 },
  { catalogId: '2', name: 'Two', normalizedName: 'two', internationalDesignator: '2020-002A', epochUtc: '2026-01-01T00:00:00Z', groups: [], shard: 0 },
]

it('toggles one id while preserving insertion order and reconciles only unavailable ids', () => {
  const selected = toggleWorkingSelection(toggleWorkingSelection([], '2'), '1')
  expect(selected).toEqual(['2', '1'])
  expect(toggleWorkingSelection(selected, '2')).toEqual(['1'])
  expect(reconcileWorkingSelection(['2', 'missing', '1', '2'], entries)).toEqual(['2', '1'])
})

it('builds an index-only tray model with a pure scene preview', () => {
  const scene = { objects: [], selection: { ids: [], primaryId: null } }
  const model = buildCatalogueWorkingSelectionModel(['2', '1'], entries, scene)
  expect(model.items.map((item) => item.name)).toEqual(['Two', 'One'])
  expect(model.preview).toMatchObject({ totalSelected: 2, alreadyInScene: 0, newRecordsToAdd: 2, slotsRemaining: MAX_SCENE_OBJECTS, canAddAll: true })
})

it('accepts an index lookup and presents the empty, fitting, all-present, over-capacity and pending states', () => {
  const lookup = (id: string) => entries.find((entry) => entry.catalogId === id)
  const empty = { objects: [], selection: { ids: [], primaryId: null } }
  expect(buildWorkingSelectionPresentation(buildCatalogueWorkingSelectionModel([], lookup, empty), false)).toMatchObject({
    items: [], addEnabled: false, message: null, capacityAlert: null, viewSceneVisible: false, clearEnabled: false,
  })
  const fits = buildWorkingSelectionPresentation(buildCatalogueWorkingSelectionModel(['2', '1', '2'], lookup, empty), false)
  expect(fits.facts.map((fact) => [fact.label, fact.value])).toEqual([['Selected', '2'], ['Already in scene', '0'], ['New to add', '2'], ['Scene slots remaining', String(MAX_SCENE_OBJECTS)]])
  expect(fits).toMatchObject({ addLabel: 'Add selected to scene', addEnabled: true, message: 'All 2 new objects fit in the Real Objects scene.', clearEnabled: true })
  expect(buildWorkingSelectionPresentation(buildCatalogueWorkingSelectionModel(['2', '1'], lookup, empty), true)).toMatchObject({ addLabel: 'Adding to scene…', addEnabled: false })

  const allPresent = { ids: ['2'], items: [], preview: { totalSelected: 2, alreadyInScene: 2, newRecordsToAdd: 0, slotsRemaining: 3, canAddAll: false } }
  expect(buildWorkingSelectionPresentation(allPresent, false)).toMatchObject({ addLabel: 'Already in scene', addEnabled: false, viewSceneVisible: true, capacityAlert: null, message: 'Every object in the working selection is already in the Real Objects scene.' })
  const over = { ids: ['1', '2'], items: [], preview: { totalSelected: 4, alreadyInScene: 1, newRecordsToAdd: 3, slotsRemaining: 1, canAddAll: false } }
  const presented = buildWorkingSelectionPresentation(over, false)
  expect(presented).toMatchObject({ addLabel: 'Add selected to scene', addEnabled: false, message: null, viewSceneVisible: true })
  expect(presented.capacityAlert).toBe('3 objects would be new, but the Real Objects scene has room for 1 more. Remove 2 from the working selection or remove objects in Scene Objects.')
})
