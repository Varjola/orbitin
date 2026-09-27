import { expect, it } from 'vitest'
import { sunClearOfEarth } from './LensFlareView.ts'

it('hides the flare while Earth covers the Sun and shows it clear of the limb', () => {
  const camera = { x: 0, y: 0, z: 4 }
  // Looking past Earth towards a Sun straight behind it.
  expect(sunClearOfEarth(camera, { x: 0, y: 0, z: -1 })).toBe(0)
  // The Sun behind the camera, or far to the side, is clear.
  expect(sunClearOfEarth(camera, { x: 0, y: 0, z: 1 })).toBe(1)
  expect(sunClearOfEarth(camera, { x: 1, y: 0, z: 0 })).toBe(1)
  // Just past Earth's limb (angular radius asin(1/4) ≈ 14.48°) it fades in.
  const limb = Math.asin(1 / 4)
  const justPast = sunClearOfEarth(camera, { x: Math.sin(limb + 0.01), y: 0, z: -Math.cos(limb + 0.01) })
  expect(justPast).toBeGreaterThan(0)
  expect(justPast).toBeLessThan(1)
  // Inside Earth there is no view of the Sun at all.
  expect(sunClearOfEarth({ x: 0, y: 0, z: 0.5 }, { x: 1, y: 0, z: 0 })).toBe(0)
})
