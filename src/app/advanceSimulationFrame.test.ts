import { expect, it, vi } from 'vitest'
import { SimulationClock } from '../simulation/SimulationClock.ts'
import { advanceSimulationFrame } from './advanceSimulationFrame.ts'

it('advances once, publishes and updates before rendering, including paused empty scenes', () => {
  const clock = new SimulationClock()
  const order: string[] = []
  const advance = vi.spyOn(clock, 'advance')
  const updateAt = vi.fn(() => { order.push('update'); return new Map() })
  const dependencies = { clock, runtime: { updateAt }, publishInstant: vi.fn(() => { order.push('publish') }),
    applyEnvironment: vi.fn(() => { order.push('environment') }),
    updateReadouts: vi.fn(() => { order.push('readouts') }), render: vi.fn(() => { order.push('render') }) }
  advanceSimulationFrame(dependencies, 0.01, 100)
  expect(advance).toHaveBeenCalledTimes(1)
  expect(order).toEqual(['publish', 'environment', 'update', 'readouts', 'render'])
  expect(dependencies.applyEnvironment).toHaveBeenCalledTimes(1)
  expect(dependencies.applyEnvironment.mock.calls[0]).toEqual(updateAt.mock.calls[0])
  expect(updateAt).toHaveBeenCalledWith(clock.currentInstant())
  clock.playing = false
  const instant = clock.currentInstant()
  advanceSimulationFrame(dependencies, 0.01, 200)
  expect(clock.currentInstant()).toEqual(instant)
  expect(dependencies.render).toHaveBeenCalledTimes(2)
  expect(dependencies.applyEnvironment).toHaveBeenCalledTimes(2)
  expect(dependencies.updateReadouts).toHaveBeenLastCalledWith(new Map(), instant, 200)
})

it('passes the frame wall time to the clock', () => {
  const clock = new SimulationClock()
  const advance = vi.spyOn(clock, 'advance')
  const dependencies = { clock, runtime: { updateAt: vi.fn(() => new Map()) }, publishInstant: vi.fn(), applyEnvironment: vi.fn(), updateReadouts: vi.fn(), render: vi.fn() }
  advanceSimulationFrame(dependencies, 0.1, 100, 5000)
  expect(advance).toHaveBeenCalledWith(0.1, 5000)
})
