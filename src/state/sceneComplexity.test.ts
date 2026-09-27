import { expect, it } from 'vitest'
import { createSyntheticScene } from '../test-fixtures/syntheticScene.ts'
import { EMPTY_SCENE, withScene } from './AppState.ts'
import { createInitialState } from './initialState.ts'
import { OBJECT_COLORS, OBJECT_PALETTE, OBJECT_SWATCHES, setColorForObjects, setLayerForObjects } from './objectActions.ts'
import { objectColorName } from '../ui/ColorPaletteView.ts'
import { catalogueFor } from '../i18n/index.ts'
import { applyLayerBudgetsInOrder, checkLayerChange, checkSceneBudgets, LAYER_BUDGETS, layerCount, withLayer, type LayerBudgets } from './sceneComplexity.ts'
import { layerBudgetMessage } from '../ui/shellWording.ts'
import type { OrbitalObject } from '../simulation/OrbitalObject.ts'

const objects = (count: number): OrbitalObject[] => createSyntheticScene(count).map((item) => item.object)
const tight: LayerBudgets = { orbitPath: 100, groundTrack: 3, groundTrackHistory: 2, sensorGeometry: 2 }
function stateWith(scene: readonly OrbitalObject[]) {
  const state = createInitialState(() => 0)
  return withScene({ ...state, activeMode: 'realObjects' }, 'realObjects', { ...EMPTY_SCENE, objects: scene })
}

it('fixes the measured M1 budgets', () => {
  expect(LAYER_BUDGETS).toEqual({ orbitPath: 100, groundTrack: 100, groundTrackHistory: 100, sensorGeometry: 75 })
})

it('keeps the ground track and history dependency in both directions', () => {
  const [object] = objects(1)
  const recording = withLayer(object, 'groundTrackHistory', true)
  expect(recording.display).toMatchObject({ groundTrackVisible: true, groundTrackHistoryRecording: true })
  // Hiding the track also stops recording.
  expect(withLayer(recording, 'groundTrack', false).display).toMatchObject({ groundTrackVisible: false, groundTrackHistoryRecording: false })
  // Stopping history keeps the track.
  expect(withLayer(recording, 'groundTrackHistory', false).display).toMatchObject({ groundTrackVisible: true, groundTrackHistoryRecording: false })
  // Showing a track does not start recording.
  expect(withLayer(object, 'groundTrack', true).display.groundTrackHistoryRecording).toBe(false)
  expect(withLayer(object, 'orbitPath', true)).toBe(object)
})

it('refuses an over-budget change atomically and names the layer and budget', () => {
  const scene = objects(10)
  const state = stateWith(scene)
  const ids = scene.slice(0, 4).map((object) => object.id)
  const refused = setLayerForObjects(state, ids, 'groundTrack', true, tight)
  expect(refused.state).toBe(state)
  expect(refused.check).toEqual({ ok: false, layer: 'groundTrack', budget: 3, wouldBe: 4 })
  expect(layerBudgetMessage(refused.check)).toBe('Ground tracks can be shown for up to 3 objects at once. 4 would be on. Turn some off or select fewer.')
  const accepted = setLayerForObjects(state, ids.slice(0, 3), 'groundTrack', true, tight)
  expect(accepted.check.ok).toBe(true)
  expect(layerCount(accepted.state.realObjects.scene.objects, 'groundTrack')).toBe(3)
  expect(layerBudgetMessage(accepted.check)).toBe('')
})

it('checks both budgets when history implies tracks, and never refuses turning things off', () => {
  const scene = objects(5)
  const ids = scene.slice(0, 3).map((object) => object.id)
  // History on for three objects needs three tracks (fits) and three
  // histories (over the history budget of 2): refused as a whole.
  expect(checkLayerChange(scene, ids, 'groundTrackHistory', true, tight)).toEqual({ ok: false, layer: 'groundTrackHistory', budget: 2, wouldBe: 3 })
  const refused = setLayerForObjects(stateWith(scene), ids, 'groundTrackHistory', true, tight)
  expect(refused.state.realObjects.scene.objects.every((object) => !object.display.groundTrackVisible)).toBe(true)
  // A scene already over budget can still turn the layer off, or leave it.
  const over = scene.map((object) => withLayer(object, 'sensorGeometry', true))
  expect(checkSceneBudgets(over, over.map((object, index) => index === 0 ? withLayer(object, 'sensorGeometry', false) : object), tight)).toEqual({ ok: true })
  expect(checkSceneBudgets(over, over, tight)).toEqual({ ok: true })
})

it('trims a scene document in document order instead of refusing it', () => {
  const scene = objects(6).map((object) => withLayer(withLayer(object, 'groundTrackHistory', true), 'sensorGeometry', true))
  const result = applyLayerBudgetsInOrder(scene, tight)
  const ids = scene.map((object) => object.id)
  expect(result.objects).toHaveLength(6)
  expect(result.trimmed).toEqual([
    { layer: 'groundTrack', budget: 3, ids: ids.slice(3) },
    { layer: 'groundTrackHistory', budget: 2, ids: [ids[2]] },
    { layer: 'sensorGeometry', budget: 2, ids: ids.slice(2) },
  ])
  // No object is left recording behind a hidden track.
  expect(result.objects.every((object) => object.display.groundTrackVisible || !object.display.groundTrackHistoryRecording)).toBe(true)
  expect(layerCount(result.objects, 'groundTrack')).toBe(3)
  expect(layerCount(result.objects, 'groundTrackHistory')).toBe(2)
  expect(applyLayerBudgetsInOrder(objects(3), tight).trimmed).toEqual([])
})

it('applies one colour to a set of objects, accepting any 24-bit colour and ignoring invalid values', () => {
  const scene = objects(4)
  const state = stateWith(scene)
  const coloured = setColorForObjects(state, [scene[0].id, scene[2].id], 0xffffff)
  expect(coloured.realObjects.scene.objects.map((object) => object.style.colorHex === 0xffffff)).toEqual([true, false, true, false])
  expect(setColorForObjects(state, [scene[0].id], 0x123456).realObjects.scene.objects[0].style.colorHex).toBe(0x123456)
  for (const invalid of [-1, 0x1000000, 1.5, Number.NaN]) expect(setColorForObjects(state, [scene[0].id], invalid)).toBe(state)
})

it('keeps the automatic colour order a permutation of the palette, with plain colour names', () => {
  const palette = OBJECT_PALETTE
  expect(new Set(OBJECT_COLORS).size).toBe(OBJECT_COLORS.length)
  expect([...OBJECT_COLORS].sort((a, b) => a - b)).toEqual([...palette].sort((a, b) => a - b))
  for (const value of OBJECT_PALETTE) for (const locale of ['en', 'fi'] as const) expect(catalogueFor(locale).colours.names[value]).not.toMatch(/\b(LEO|MEO|GEO|HEO)\b/)
  // The chooser's one row is the first eight automatic colours.
  expect([...OBJECT_SWATCHES].sort((a, b) => a - b)).toEqual(OBJECT_COLORS.slice(0, 8).sort((a, b) => a - b))
  expect(objectColorName(0xffc857)).toBe('Gold')
  expect(objectColorName(0x123456)).toBe('#123456')
})
