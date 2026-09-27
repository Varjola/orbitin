import { expect, it, vi } from 'vitest'
import type { EarthFixedVec3 } from '../core/referenceFrames.ts'
import type { GroundTrackSegment, GroundTrackWindow, SubSatellitePoint } from '../simulation/groundTrack.ts'
import { combineGroundTrackViewPorts } from './combineGroundTrackViewPorts.ts'
import type { GroundTrackViewPort } from './OrbitalObjectRuntime.ts'

function recordingPort(): GroundTrackViewPort & { readonly calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    setCurrent: (point) => calls.push(['setCurrent', point]),
    setWindow: (window) => calls.push(['setWindow', window]),
    setHistory: (segments) => calls.push(['setHistory', segments]),
    setVisible: (visible) => calls.push(['setVisible', visible]),
    setColor: (colorHex) => calls.push(['setColor', colorHex]),
    setSelected: (selected) => calls.push(['setSelected', selected]),
    dispose: () => calls.push(['dispose', undefined]),
  }
}

const point: SubSatellitePoint = {
  instant: { unixSeconds: 12 },
  directionEarthFixed: { x: 1, y: 0, z: 0 } as EarthFixedVec3,
  geocentricLatitudeRad: 0,
  geodeticLatitudeRad: 0,
  longitudeRad: 0,
}
const window: GroundTrackWindow = {
  centreInstant: { unixSeconds: 12 },
  nominalPeriodSeconds: 5400,
  current: point,
  trailing: [],
  leading: [],
  failedSampleCount: 0,
}
const history: readonly GroundTrackSegment[] = [{ points: [point, point] }]

it('forwards every call once to both children with the same object reference', () => {
  const primary = recordingPort()
  const secondary = recordingPort()
  const composite = combineGroundTrackViewPorts(() => primary, () => secondary)

  composite.setCurrent(point)
  composite.setWindow(window)
  composite.setHistory?.(history)
  composite.setVisible(true)
  composite.setColor(0xffc857)
  composite.setSelected(true)
  composite.setCurrent(null)
  composite.setWindow(null)
  composite.setHistory?.(null)

  const expected: Array<[string, unknown]> = [
    ['setCurrent', point], ['setWindow', window], ['setHistory', history],
    ['setVisible', true], ['setColor', 0xffc857], ['setSelected', true],
    ['setCurrent', null], ['setWindow', null], ['setHistory', null],
  ]
  expect(primary.calls).toEqual(expected)
  expect(secondary.calls).toEqual(expected)
  // Identity, not equality: a copy would let the two views drift apart.
  expect(primary.calls[0][1]).toBe(point)
  expect(secondary.calls[0][1]).toBe(point)
  expect(secondary.calls[1][1]).toBe(window)
  expect(secondary.calls[2][1]).toBe(history)
})

it('disposes the already-created child when the second one cannot be built', () => {
  const primary = recordingPort()
  const failure = new Error('no 2D layer')
  expect(() => combineGroundTrackViewPorts(() => primary, () => { throw failure })).toThrow(failure)
  expect(primary.calls).toEqual([['dispose', undefined]])
})

it('disposes each child exactly once however often it is disposed', () => {
  const primary = recordingPort()
  const secondary = recordingPort()
  const composite = combineGroundTrackViewPorts(() => primary, () => secondary)
  composite.dispose()
  composite.dispose()
  composite.dispose()
  expect(primary.calls).toEqual([['dispose', undefined]])
  expect(secondary.calls).toEqual([['dispose', undefined]])
})

it('tolerates a child that does not implement the optional history method', () => {
  const primary = recordingPort()
  const minimal: GroundTrackViewPort = {
    setCurrent: vi.fn(), setWindow: vi.fn(), setVisible: vi.fn(),
    setColor: vi.fn(), setSelected: vi.fn(), dispose: vi.fn(),
  }
  const composite = combineGroundTrackViewPorts(() => primary, () => minimal)
  expect(() => composite.setHistory?.(history)).not.toThrow()
  expect(primary.calls).toEqual([['setHistory', history]])
})
