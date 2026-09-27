import { expect, it } from 'vitest'
import { occlusionInsets, type Rect } from './shellGeometry.ts'

const canvas: Rect = { left: 100, top: 50, right: 1100, bottom: 650 }

it('returns zero insets for absent, disjoint and floating regions', () => {
  expect(occlusionInsets(canvas, [])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  expect(occlusionInsets(canvas, [{ left: 0, top: 0, right: 90, bottom: 40 }])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  expect(occlusionInsets(canvas, [{ left: 400, top: 200, right: 600, bottom: 300 }])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
})

it('combines the largest edge occlusions with a configurable gap', () => {
  expect(occlusionInsets(canvas, [
    { left: 100, top: 50, right: 280, bottom: 650 },
    { left: 900, top: 50, right: 1100, bottom: 650 },
    { left: 100, top: 50, right: 1100, bottom: 130 },
    { left: 100, top: 610, right: 1100, bottom: 650 },
  ], { gapPx: 10 })).toEqual({ left: 190, right: 210, top: 90, bottom: 50 })
})

it('assigns corner regions to the edge they obstruct proportionally', () => {
  expect(occlusionInsets(canvas, [{ left: 100, top: 50, right: 250, bottom: 350 }], { gapPx: 0 })).toEqual({ left: 150, right: 0, top: 0, bottom: 0 })
  expect(occlusionInsets(canvas, [{ left: 900, top: 500, right: 1100, bottom: 650 }], { gapPx: 0 })).toEqual({ left: 0, right: 200, top: 0, bottom: 0 })
})
