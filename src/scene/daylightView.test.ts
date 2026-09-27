import { expect, it } from 'vitest'
import { daylightViewDirection } from './daylightView.ts'

it('looks at the sunlit side from a little north, with the terminator in view', () => {
  for (const sun of [{ x: 1, y: 0, z: 0 }, { x: -0.3, y: 0.39, z: 0.87 }, { x: 0, y: -0.4, z: -0.92 }]) {
    const length = Math.hypot(sun.x, sun.y, sun.z)
    const view = daylightViewDirection(sun)
    expect(Math.hypot(view.x, view.y, view.z)).toBeCloseTo(1, 12)
    const angle = Math.acos((view.x * sun.x + view.y * sun.y + view.z * sun.z) / length) * 180 / Math.PI
    // Mostly day side, but far enough round that the terminator shows.
    expect(angle).toBeGreaterThan(25)
    expect(angle).toBeLessThan(60)
    expect(view.y).toBeGreaterThan(sun.y / length)
  }
})
