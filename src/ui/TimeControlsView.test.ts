import { expect, it } from 'vitest'
import { MAX_SPEED_MULTIPLIER } from '../core/constants.ts'
import { createInitialState } from '../state/initialState.ts'
import { COMPACT_SPEED_CYCLE, nextCompactSpeed } from './TimeControlsView.ts'

it('cycles the compact playback speeds in the reviewed order', () => {
  expect(COMPACT_SPEED_CYCLE).toEqual([1, 60, 600])
  expect(nextCompactSpeed(1)).toBe(60)
  expect(nextCompactSpeed(60)).toBe(600)
  expect(nextCompactSpeed(600)).toBe(1)
  expect(nextCompactSpeed(200)).toBe(1)
})

it('starts at one simulated minute per second and caps playback at one hour per second', () => {
  expect(createInitialState().simulation.speedMultiplier).toBe(60)
  expect(MAX_SPEED_MULTIPLIER).toBe(3600)
})
