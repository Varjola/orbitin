import { expect, it } from 'vitest'
import { createInitialState } from './initialState.ts'
import { setActiveMode, setOrbitLabDrawerTab } from './modeActions.ts'

it('switches modes without changing either scene or shared presentation', () => {
  const state = createInitialState()
  const next = setActiveMode(state, 'realObjects')
  expect(next.activeMode).toBe('realObjects')
  expect(next.orbitLab).toBe(state.orbitLab)
  expect(next.realObjects).toBe(state.realObjects)
  expect(next.simulation).toBe(state.simulation)
  expect(next.view).toBe(state.view)
  expect(setActiveMode(next, 'realObjects')).toBe(next)
})

it('keeps the Orbit Lab tab a pure no-op when it is already selected', () => {
  const state = createInitialState()
  expect(setOrbitLabDrawerTab(state, 'edit')).toBe(state)
  const next = setOrbitLabDrawerTab(state, 'examples')
  expect(next.orbitLab.scene).toBe(state.orbitLab.scene)
  expect(next.orbitLab.authoring.drawerTab).toBe('examples')
})
