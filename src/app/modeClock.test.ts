import { describe, expect, it } from 'vitest'
import { modeClockStep, type ClockSnapshot } from './modeClock.ts'

const LAB_CLOCK: ClockSnapshot = { instant: { unixSeconds: 1_742_515_200 }, speedMultiplier: 60, playing: false, reversed: true }

describe('modeClockStep', () => {
  it('remembers Orbit Lab’s clock whenever Orbit Lab is left', () => {
    for (const next of ['maneuvers', 'routePlanner', 'realObjects'] as const) {
      expect(modeClockStep('orbitLab', next, null).rememberLab).toBe(true)
    }
    expect(modeClockStep('realObjects', 'maneuvers', null).rememberLab).toBe(false)
    expect(modeClockStep('maneuvers', 'orbitLab', LAB_CLOCK).rememberLab).toBe(false)
  })

  it('sends Real Objects to real time from every mode, Orbit Lab included', () => {
    for (const previous of ['orbitLab', 'maneuvers', 'routePlanner'] as const) {
      expect(modeClockStep(previous, 'realObjects', LAB_CLOCK).entry).toEqual({ kind: 'live' })
    }
  })

  it('restores Orbit Lab’s clock from every mode: its instant, rate, play state and direction', () => {
    for (const previous of ['realObjects', 'maneuvers', 'routePlanner'] as const) {
      expect(modeClockStep(previous, 'orbitLab', LAB_CLOCK).entry).toEqual({ kind: 'restore', clock: LAB_CLOCK })
    }
  })

  it('keeps the clock on entering Orbit Lab with nothing remembered', () => {
    expect(modeClockStep('realObjects', 'orbitLab', null).entry).toEqual({ kind: 'keep' })
  })

  it('keeps the clock for Interception and the Route Planner, which set it themselves', () => {
    expect(modeClockStep('orbitLab', 'maneuvers', LAB_CLOCK).entry).toEqual({ kind: 'keep' })
    expect(modeClockStep('realObjects', 'routePlanner', LAB_CLOCK).entry).toEqual({ kind: 'keep' })
    expect(modeClockStep('maneuvers', 'routePlanner', LAB_CLOCK).entry).toEqual({ kind: 'keep' })
  })

  it('does nothing on a repeated switch', () => {
    expect(modeClockStep('orbitLab', 'orbitLab', LAB_CLOCK)).toEqual({ rememberLab: false, entry: { kind: 'keep' } })
    expect(modeClockStep('realObjects', 'realObjects', null)).toEqual({ rememberLab: false, entry: { kind: 'keep' } })
  })
})
