import { expect, it } from 'vitest'
import type { PolygonData } from '../map/geographyData.ts'
import { drawEarthMap, EARTH_MAP_COLORS, type MapCanvas } from './earthMapTexture.ts'

function recordingCanvas(width: number, height: number) {
  const calls: string[] = []
  const context = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: 'miter',
    fillRect: (...args: number[]) => calls.push(`fillRect ${args.join(',')}`),
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x},${y}`),
    closePath: () => calls.push('closePath'),
    fill: () => calls.push(`fill ${context.fillStyle}`),
    stroke: () => calls.push(`stroke ${context.strokeStyle}`),
  }
  const canvas = { width, height, getContext: () => context } as unknown as MapCanvas
  return { canvas, calls }
}

const island: PolygonData = { polygons: [[[[-180, 0], [0, 0], [0, 45], [-180, 0]]]], pointCount: 4 }

it('fills the ocean, then land, then lakes, and projects equirectangularly', () => {
  const { canvas, calls } = recordingCanvas(360, 180)
  const lake: PolygonData = { polygons: [[[[10, 10], [20, 10], [20, 20], [10, 10]]]], pointCount: 4 }
  expect(drawEarthMap(canvas, island, lake)).toBe(true)
  expect(calls[0]).toBe('fillRect 0,0,360,180')
  expect(calls).toContain('moveTo 0,90')
  expect(calls).toContain('lineTo 180,45')
  const fills = calls.filter((call) => call.startsWith('fill '))
  expect(fills).toEqual([`fill ${EARTH_MAP_COLORS.land}`, `fill ${EARTH_MAP_COLORS.ocean}`])
  expect(calls.filter((call) => call.startsWith('stroke'))).toHaveLength(2)
})

it('never draws the antimeridian or the south edge as shore', () => {
  const split: PolygonData = { polygons: [[[[180, -90], [180, 10], [170, 10], [170, -90], [180, -90]]]], pointCount: 5 }
  const { canvas, calls } = recordingCanvas(360, 180)
  drawEarthMap(canvas, split, null)
  const strokeStart = calls.indexOf('fill ' + EARTH_MAP_COLORS.land) + 1
  const shore = calls.slice(strokeStart)
  // Only 180,10 -> 170,10 -> 170,-90 is shore.
  expect(shore.filter((call) => call.startsWith('moveTo'))).toEqual(['moveTo 360,80'])
  expect(shore.filter((call) => call.startsWith('lineTo'))).toEqual(['lineTo 350,80', 'lineTo 350,180'])
})

it('reports a canvas without a 2D context', () => {
  expect(drawEarthMap({ width: 2, height: 1, getContext: () => null }, island, null)).toBe(false)
})
