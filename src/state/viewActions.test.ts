import { expect, it } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { activeScene, type AppState } from './AppState.ts'
import { createDefaultOrbitLabObject, createInitialState } from './initialState.ts'
import { addObject, selectObject, updateObject } from './objectActions.ts'
import { effectiveBackdrop, setEarthStyle, setGroundTrackMapVisible, setOrbitLabBackdrop } from './viewActions.ts'
import { encodeSceneDocument } from '../data/sceneDocument.ts'
function stateWithTwoObjects(): AppState { const base = createInitialState(); const preset = createDefaultOrbitLabObject('p', 0x56b4e9, SIMULATION_START_INSTANT); return selectObject(addObject(base, preset), 'p') }
it('starts with the map closed', () => { expect(createInitialState().view.groundTrackMapVisible).toBe(false); expect(stateWithTwoObjects().view.groundTrackMapVisible).toBe(false) })
it('changes only the global map preference', () => { const before = stateWithTwoObjects(); const opened = setGroundTrackMapVisible(before, true); expect(opened.view.groundTrackMapVisible).toBe(true); expect(opened.orbitLab).toBe(before.orbitLab); expect(opened.realObjects).toBe(before.realObjects); expect(opened.activeMode).toBe(before.activeMode); expect(opened.simulation).toBe(before.simulation); expect(setGroundTrackMapVisible(before, false)).toBe(before) })
it('is independent of mode and object track state', () => { let state = setGroundTrackMapVisible(stateWithTwoObjects(), true); state = { ...state, activeMode: 'realObjects' }; expect(state.view.groundTrackMapVisible).toBe(true); state = updateObject({ ...state, activeMode: 'orbitLab' }, 'p', (object) => ({ ...object, display: { ...object.display, groundTrackVisible: false } })); expect(state.view.groundTrackMapVisible).toBe(true); expect(activeScene(state).objects.some((object) => object.display.groundTrackVisible)).toBe(false) })

it('starts with the default look and changes one look field at a time', () => {
  const before = createInitialState()
  expect(before.look).toEqual({ earthStyle: 'imagery', orbitLabBackdrop: 'space' })
  const map = setEarthStyle(before, 'map')
  expect(map.look.earthStyle).toBe('map')
  expect(map.view).toBe(before.view)
  expect(map.orbitLab).toBe(before.orbitLab)
  expect(setEarthStyle(map, 'map')).toBe(map)
  expect(setOrbitLabBackdrop(before, 'lab').look.orbitLabBackdrop).toBe('lab')
})
it('draws the Lab backdrop in Orbit Lab only and keeps the choice across modes', () => {
  const lab = setOrbitLabBackdrop(createInitialState(), 'lab')
  expect(effectiveBackdrop(lab)).toBe('lab')
  const realObjects: AppState = { ...lab, activeMode: 'realObjects' }
  expect(effectiveBackdrop(realObjects)).toBe('space')
  expect(effectiveBackdrop({ ...realObjects, activeMode: 'orbitLab' })).toBe('lab')
})
it('never writes the look into scene files or links', () => {
  const base = createInitialState()
  const styled = setOrbitLabBackdrop(setEarthStyle(base, 'map'), 'lab')
  const encoded = JSON.stringify(encodeSceneDocument(styled, { includeSimulation: true }))
  expect(encoded).toBe(JSON.stringify(encodeSceneDocument(base, { includeSimulation: true })))
})
