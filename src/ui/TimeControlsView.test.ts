import { expect, it } from 'vitest'
import { MAX_SPEED_MULTIPLIER } from '../core/constants.ts'
import { createInitialState } from '../state/initialState.ts'
import { COMPACT_SPEED_CYCLE, nextCompactSpeed } from './TimeControlsView.ts'
import { timePolicyFor } from './timePolicy.ts'

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

it('gives Interception its own forward-only speeds that never cycle to 1×', () => {
  const policy = timePolicyFor('maneuvers')
  expect(policy).toEqual({ cycle: [60, 120, 600], steps: [], travel: false })
  expect(nextCompactSpeed(60, policy.cycle)).toBe(120)
  expect(nextCompactSpeed(120, policy.cycle)).toBe(600)
  expect(nextCompactSpeed(600, policy.cycle)).toBe(60)
  // A burn leaves the clock at 1× only while held; the cycle never returns there.
  expect(nextCompactSpeed(1, policy.cycle)).toBe(60)
  for (const mode of ['orbitLab', 'realObjects'] as const) expect(timePolicyFor(mode)).toEqual({ cycle: [1, 60, 600], steps: [1, 60, 600, 3600], travel: true })
})
