import { expect, it } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { createDefaultOrbitLabObject, createInitialState } from './initialState.ts'
import { withScene, type AppState, type SceneState } from './AppState.ts'
import { addObjects, removeObjects, selectOnly } from './sceneActions.ts'
import { setActiveMode } from './modeActions.ts'
import { canUndo, recordSceneChange, touchedObjectIds, undoObjectIds, undoSceneChange } from './sceneUndo.ts'

const object = (id: string) => ({ ...createDefaultOrbitLabObject(id, 0x44ccff, SIMULATION_START_INSTANT), id, name: id })
const scene = (ids: readonly string[], selected: readonly string[] = []): SceneState => ({ objects: ids.map(object), selection: { ids: selected, primaryId: selected.at(-1) ?? null } })
const state = (lab: SceneState, real: SceneState = scene([])): AppState => withScene(withScene(createInitialState(() => 0), 'orbitLab', lab), 'realObjects', real)

it('records only a change to the active mode scene', () => {
  const before = state(scene(['a'], ['a']))
  expect(recordSceneChange(before, before)).toBeNull()
  const after = withScene(before, 'orbitLab', addObjects(before.orbitLab.scene, [object('b')]))
  const entry = recordSceneChange(before, after)!
  expect(entry).toEqual({ mode: 'orbitLab', before: before.orbitLab.scene, after: after.orbitLab.scene })
  // A change to the other mode's scene is not this mode's change.
  const real = withScene(before, 'realObjects', addObjects(before.realObjects.scene, [object('x')]))
  expect(recordSceneChange(before, real)).toBeNull()
})

it('restores the scene and selection exactly, and nothing else', () => {
  const before = state(scene(['a', 'b', 'c'], ['b']), scene(['x']))
  const removed = withScene({ ...before, simulation: { ...before.simulation, speedMultiplier: 600 } }, 'orbitLab', removeObjects(before.orbitLab.scene, ['b']))
  const entry = recordSceneChange(before, removed)!
  const undone = undoSceneChange(entry, removed)
  expect(undone.orbitLab.scene).toBe(before.orbitLab.scene)
  expect(undone.orbitLab.scene.selection).toEqual({ ids: ['b'], primaryId: 'b' })
  // The restored object is the stored value itself: no re-creation, no request.
  expect(undone.orbitLab.scene.objects[1]).toBe(before.orbitLab.scene.objects[1])
  expect(undone.realObjects).toBe(removed.realObjects)
  expect(undone.simulation.speedMultiplier).toBe(600)
  expect(touchedObjectIds(entry)).toEqual(['b'])
})

it('goes stale when anything else changes that scene, selection included', () => {
  const before = state(scene(['a'], ['a']))
  const after = withScene(before, 'orbitLab', addObjects(before.orbitLab.scene, [object('b')]))
  const entry = recordSceneChange(before, after)!
  expect(canUndo(entry, after)).toBe(true)
  const reselected = withScene(after, 'orbitLab', selectOnly(after.orbitLab.scene, 'a'))
  expect(canUndo(entry, reselected)).toBe(false)
  expect(undoSceneChange(entry, reselected)).toBe(reselected)
  // A change elsewhere keeps it valid, and undo still targets its own mode.
  const elsewhere = setActiveMode(withScene(after, 'realObjects', addObjects(after.realObjects.scene, [object('x')])), 'realObjects')
  expect(canUndo(entry, elsewhere)).toBe(true)
  const undone = undoSceneChange(entry, elsewhere)
  expect(undone.orbitLab.scene).toBe(before.orbitLab.scene)
  expect(undone.realObjects.scene.objects.map((item) => item.id)).toEqual(['x'])
  expect(undone.activeMode).toBe('realObjects')
  expect(touchedObjectIds(entry)).toEqual(['b'])
})

it('records the scene an action changed even after a mode switch, and keeps every object\'s provenance id', () => {
  const before = state(scene(['a'], ['a']), scene(['x']))
  // A catalogue add resolves after the learner went back to Orbit Lab.
  const after = withScene(before, 'realObjects', addObjects(before.realObjects.scene, [object('y')]))
  expect(after.activeMode).toBe('orbitLab')
  expect(recordSceneChange(before, after)).toBeNull()
  const entry = recordSceneChange(before, after, 'realObjects')!
  expect(entry.mode).toBe('realObjects')
  expect(undoSceneChange(entry, after).realObjects.scene).toBe(before.realObjects.scene)
  // Members already present are restored too (a group add changes their provenance).
  expect(undoObjectIds(entry)).toEqual(['x', 'y'])
})
