import { expect, it } from 'vitest'
import { createInitialState, createRandomOrbitName } from './initialState.ts'

it('starts Orbit Lab with one selected, safely configured orbit', () => {
  const state = createInitialState(() => 0)
  expect(state.orbitLab.scene.objects).toHaveLength(1)
  expect(state.orbitLab.scene.selection).toEqual({ ids: ['orbit-1'], primaryId: 'orbit-1' })
  expect(state.orbitLab.scene.objects[0]).toMatchObject({
    name: 'Alpha Array',
    display: { orbitPathVisible: true, bodyVisible: true, groundTrackVisible: false, groundTrackHistoryRecording: false, sensorGeometryVisible: false },
  })
})

it('builds space-themed names and disambiguates repeated random picks', () => {
  expect(createRandomOrbitName([], () => 0)).toBe('Alpha Array')
  expect(createRandomOrbitName(['Alpha Array', 'Alpha Array 2'], () => 0)).toBe('Alpha Array 3')
  expect(createRandomOrbitName([], () => 0.999999)).toBe('Omega Sledge')
})
