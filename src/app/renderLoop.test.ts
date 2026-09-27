import { afterEach, expect, it, vi } from 'vitest'
import { startRenderLoop } from './renderLoop.ts'

afterEach(() => vi.unstubAllGlobals())

it('stops after a frame throws and reports the error once', () => {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const errors: unknown[] = []
  let frames = 0
  startRenderLoop(() => { frames += 1; if (frames === 2) throw new Error('boom') }, (error) => errors.push(error))
  callbacks.shift()!(16)
  callbacks.shift()!(32)
  expect(frames).toBe(2)
  expect(errors).toHaveLength(1)
  expect(callbacks).toHaveLength(0)
})
