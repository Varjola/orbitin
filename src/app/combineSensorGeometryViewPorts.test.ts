import { expect, it, vi } from 'vitest'
import type { SensorGeometryViewPort } from './OrbitalObjectRuntime.ts'
import { combineSensorGeometryViewPorts } from './combineSensorGeometryViewPorts.ts'

function stub(): SensorGeometryViewPort {
  return { setGeometry: vi.fn(), setVisible: vi.fn(), setColor: vi.fn(), setSelected: vi.fn(), dispose: vi.fn() }
}

it('forwards exact geometry references and presentation state to both children', () => {
  const primary = stub(); const secondary = stub()
  const combined = combineSensorGeometryViewPorts(() => primary, () => secondary)
  const geometry = { instant: { unixSeconds: 1 } } as never
  combined.setGeometry(geometry)
  combined.setVisible(true); combined.setColor(0x123456); combined.setSelected(true)
  expect(vi.mocked(primary.setGeometry)).toHaveBeenCalledWith(geometry)
  expect(vi.mocked(secondary.setGeometry)).toHaveBeenCalledWith(geometry)
  expect(vi.mocked(primary.setVisible)).toHaveBeenCalledWith(true)
  expect(vi.mocked(primary.setColor)).toHaveBeenCalledWith(0x123456)
  expect(vi.mocked(primary.setSelected)).toHaveBeenCalledWith(true)
})

it('rolls back the first child and disposes idempotently', () => {
  const primary = stub(); const error = new Error('map failed')
  expect(() => combineSensorGeometryViewPorts(() => primary, () => { throw error })).toThrow(error)
  expect(primary.dispose).toHaveBeenCalledTimes(1)
  const secondary = stub()
  const combined = combineSensorGeometryViewPorts(() => primary, () => secondary)
  combined.dispose(); combined.dispose()
  expect(primary.dispose).toHaveBeenCalledTimes(2)
  expect(secondary.dispose).toHaveBeenCalledTimes(1)
})
