import { describe, expect, it } from 'vitest'
import { SimulationClock } from './SimulationClock.ts'
import { MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT } from '../core/constants.ts'

describe('SimulationClock', () => {
  it('reverses the shared instant, with pause and negative delta guards', () => {
    const clock = new SimulationClock()
    clock.setInstant({unixSeconds:100}); clock.speedMultiplier = 5; clock.reversed = true
    clock.advance(2); expect(clock.currentInstant().unixSeconds).toBe(90)
    clock.playing = false; clock.advance(5); expect(clock.currentInstant().unixSeconds).toBe(90)
    expect(() => clock.advance(-1)).toThrow()
    expect(() => clock.advance(NaN)).toThrow()
  })
  it.each([false,true])('stops exactly at either supported limit, reverse=%s', (reversed) => {
    const clock = new SimulationClock()
    const limit = reversed ? MIN_SIMULATION_INSTANT : MAX_SIMULATION_INSTANT
    clock.reversed = reversed; clock.speedMultiplier = 1
    clock.setInstant({unixSeconds:limit.unixSeconds+(reversed?1:-1)})
    clock.advance(1)
    expect(clock.currentInstant()).toEqual(limit); expect(clock.playing).toBe(false)
    clock.playing = true; clock.advance(100)
    expect(clock.currentInstant()).toEqual(limit); expect(clock.playing).toBe(false)
    clock.reversed = !reversed; clock.playing = true; clock.advance(1)
    expect(clock.currentInstant().unixSeconds).not.toBe(limit.unixSeconds)
  })
  it('clamps jumps and rejects invalid instants', () => {
    const clock = new SimulationClock()
    clock.setInstant({unixSeconds:-1e12}); expect(clock.currentInstant()).toEqual(MIN_SIMULATION_INSTANT)
    clock.setInstant({unixSeconds:1e12}); expect(clock.currentInstant()).toEqual(MAX_SIMULATION_INSTANT)
    expect(() => clock.setInstant({unixSeconds:Infinity})).toThrow()
  })
  it('advances deterministically with pause and speed changes', () => {
    const clock = new SimulationClock()
    clock.setInstant({ unixSeconds: 0 })
    clock.speedMultiplier = 10
    clock.advance(0.5)
    clock.playing = false
    clock.advance(100)
    clock.playing = true
    clock.speedMultiplier = 2
    clock.advance(1)
    expect(clock.currentInstant().unixSeconds).toBe(7)
  })
  it('follows the wall clock only in forward 1x playback and never replays time from before a jump', () => {
    const clock = new SimulationClock()
    clock.setInstant({ unixSeconds: 1000 }); clock.speedMultiplier = 1
    // The first frame has no previous wall time and uses the capped delta.
    clock.advance(0.1, 0); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1000.1)
    // A background tab resumes with one frame after 90 s of suspended frames.
    clock.advance(0.1, 90_000); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1090.1)
    clock.reversed = true
    clock.advance(0.1, 180_000); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1090)
    clock.reversed = false; clock.speedMultiplier = 60
    clock.advance(0.1, 270_000); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1096)
    clock.speedMultiplier = 1; clock.playing = false
    clock.advance(0.1, 360_000); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1096)
    // Paused frames keep the wall reference current, so resuming adds one frame.
    clock.playing = true
    clock.advance(0.016, 360_016); expect(clock.currentInstant().unixSeconds).toBeCloseTo(1096.016)
    // Now pressed 30 s after the last frame: that gap is not added after the jump.
    clock.setInstant({ unixSeconds: 5000 })
    clock.advance(0.1, 390_016); expect(clock.currentInstant().unixSeconds).toBeCloseTo(5000.1)
    clock.advance(0.1, 400_016); expect(clock.currentInstant().unixSeconds).toBeCloseTo(5010.1)
    // Without a wall time the capped delta applies at every speed.
    clock.advance(0.1); clock.advance(0.1); expect(clock.currentInstant().unixSeconds).toBeCloseTo(5010.3)
  })
})
