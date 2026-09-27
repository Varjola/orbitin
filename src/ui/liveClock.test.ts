import { expect, it } from 'vitest'
import { isLiveClock } from './liveClock.ts'

it('is live only while playing forward at 1× close to the wall clock', () => {
  const live = { playing: true, speedMultiplier: 1, reversed: false }
  expect(isLiveClock(live, 1000, 1003)).toBe(true)
  expect(isLiveClock(live, 1000, 1100)).toBe(false)
  expect(isLiveClock({ ...live, playing: false }, 1000, 1000)).toBe(false)
  expect(isLiveClock({ ...live, speedMultiplier: 60 }, 1000, 1000)).toBe(false)
  expect(isLiveClock({ ...live, reversed: true }, 1000, 1000)).toBe(false)
})
