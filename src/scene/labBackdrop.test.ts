import { expect, it } from 'vitest'
import { OBJECT_PALETTE } from '../state/objectActions.ts'
import { backFaces, labBoxHalfSize, labGridSpacing, LAB_BOX_MAX_HALF_SIZE } from './labGrid.ts'
import { contrastRatio, labDisplayColor, LAB_MINIMUM_CONTRAST, LAB_PALETTE } from './sceneBackdrop.ts'

it('gives every palette colour at least 3:1 contrast on the Lab backdrop', () => {
  for (const color of OBJECT_PALETTE) {
    expect(contrastRatio(labDisplayColor(color), LAB_PALETTE.background), color.toString(16)).toBeGreaterThanOrEqual(LAB_MINIMUM_CONTRAST - 1e-6)
  }
})

it('keeps colours that already contrast and keeps the hue of the ones it darkens', () => {
  expect(labDisplayColor(0x1d4ed8)).toBe(0x1d4ed8)
  const yellow = labDisplayColor(0xffc857)
  const [r, g, b] = [(yellow >> 16) & 0xff, (yellow >> 8) & 0xff, yellow & 0xff]
  expect(r).toBeGreaterThan(g)
  expect(g).toBeGreaterThan(b)
  const white = labDisplayColor(0xffffff)
  expect((white >> 16) & 0xff).toBe(white & 0xff)
  expect(white).toBeLessThan(0xffffff)
})

it('draws the Lab palette with enough contrast for guides and markers', () => {
  expect(contrastRatio(LAB_PALETTE.guide, LAB_PALETTE.background)).toBeGreaterThanOrEqual(LAB_MINIMUM_CONTRAST)
  expect(contrastRatio(LAB_PALETTE.halo, LAB_PALETTE.background)).toBeGreaterThanOrEqual(LAB_MINIMUM_CONTRAST)
})

it('sizes the box to the largest orbit with room to spare', () => {
  expect(labBoxHalfSize(0)).toBe(2)
  expect(labBoxHalfSize(1.1)).toBe(2)
  expect(labBoxHalfSize(1.8)).toBe(3)
  expect(labBoxHalfSize(6.61)).toBe(8)
  expect(labBoxHalfSize(1000)).toBe(LAB_BOX_MAX_HALF_SIZE)
  expect(labBoxHalfSize(Number.NaN)).toBe(2)
})

it('keeps each face to at most ten grid divisions', () => {
  expect(labGridSpacing(2)).toBe(0.5)
  expect(labGridSpacing(3)).toBe(1)
  expect(labGridSpacing(8)).toBe(2)
  expect(labGridSpacing(20)).toBe(5)
  for (const half of [2, 3, 4, 5, 6, 8, 10, 12, 15, 20]) expect((2 * half) / labGridSpacing(half)).toBeLessThanOrEqual(10)
})

it('draws the faces on the far side of Earth from the camera', () => {
  expect(backFaces({ x: 3, y: 2, z: -1 })).toEqual({ x: -1, y: -1, z: 1 })
  expect(backFaces({ x: -3, y: -2, z: 1 })).toEqual({ x: 1, y: 1, z: -1 })
  expect(backFaces({ x: 0, y: 0, z: 0 })).toEqual({ x: -1, y: -1, z: -1 })
})
