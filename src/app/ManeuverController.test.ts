import { describe, expect, it } from 'vitest'
import { MAX_SIMULATION_INSTANT } from '../core/constants.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../core/time.ts'
import { drawGameSetup } from '../simulation/maneuverGame.ts'
import { GAME_SPEED_MULTIPLIER, ManeuverController, type ClockSetting } from './ManeuverController.ts'
import type { UsageEvent } from './usageEvents.ts'

const START: SimulationInstant = { unixSeconds: Date.UTC(2026, 10, 3) / 1000 }

function harness(seed = 7, start = START) {
  let instant = start
  let setting: ClockSetting = { speedMultiplier: 60, playing: true }
  const events: UsageEvent[] = []
  const controller = new ManeuverController({
    instant: () => instant,
    setting: () => setting,
    set: (next, at) => { setting = next; if (at) instant = at },
  }, (event) => events.push(event), () => seed)
  /** Advances the clock as the frame loop does, then runs the game's frame. */
  const step = (seconds: number) => { instant = addSeconds(instant, seconds); controller.frame(instant) }
  return { controller, events, step, get instant() { return instant }, get setting() { return setting } }
}

/** A seed whose player starts low enough to re-enter with the tank it gets. */
const LOW_SEED = Array.from({ length: 500 }, (_, index) => index + 1).find((seed) => drawGameSetup(seed).playerAltitudeKm < 400)!

describe('ManeuverController', () => {
  it('starts the first game running at 2 min/s and returns to a left game where it was, paused', () => {
    const h = harness()
    expect(h.controller.enter()).toBe(true)
    expect(h.setting).toEqual({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: true })
    expect(h.controller.game?.startInstant).toEqual(START)
    h.step(600)
    const leftAt = h.instant
    h.controller.leave()
    h.step(5000)
    expect(h.controller.enter()).toBe(false)
    expect(h.instant).toEqual(leftAt)
    expect(h.setting).toEqual({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: false })
  })

  it('burns at 1× and restores the earlier rate and play state on release', () => {
    const h = harness()
    h.controller.enter()
    // Leaving and returning leaves the game paused, so release has that to restore.
    h.controller.leave()
    h.controller.enter()
    h.controller.press('prograde')
    expect(h.setting).toEqual({ speedMultiplier: 1, playing: true })
    expect(h.controller.burning).toBe('prograde')
    for (let frame = 0; frame < 60; frame += 1) h.step(1 / 60)
    h.controller.release()
    expect(h.setting).toEqual({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: false })
    expect(h.controller.burning).toBeNull()
    // Stepped instants round to about 0.24 µs each, as in the frame loop.
    expect(h.controller.game?.burns[0].deltaVKmPerSecond).toBeCloseTo(0.02, 7)
  })

  it('restores the clock by itself when the tank runs dry during a hold', () => {
    const h = harness()
    h.controller.enter()
    h.controller.newGame()
    h.controller.press('prograde')
    for (let frame = 0; frame < 10_000 && h.controller.burning; frame += 1) h.step(1 / 60)
    expect(h.controller.burning).toBeNull()
    expect(h.controller.game?.usedKmPerSecond).toBe(h.controller.game?.tankKmPerSecond)
    expect(h.setting).toEqual({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: true })
    h.controller.release()
    expect(h.setting).toEqual({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: true })
    h.controller.press('retrograde')
    expect(h.controller.burning).toBeNull()
  })

  it('ends a burn when the learner leaves the mode', () => {
    const h = harness()
    h.controller.enter()
    h.controller.press('prograde')
    h.step(0.5)
    h.controller.leave()
    expect(h.controller.burning).toBeNull()
    expect(h.controller.game?.burns).toHaveLength(1)
    expect(h.setting.speedMultiplier).toBe(GAME_SPEED_MULTIPLIER)
  })

  it('stops the clock at the re-entry instant and records the result', () => {
    const h = harness(LOW_SEED)
    h.controller.enter()
    h.controller.newGame()
    h.controller.press('retrograde')
    // 4 s at 2 g: 80 m/s, which lowers the far side by about 280 km.
    for (let frame = 0; frame < 240; frame += 1) h.step(1 / 60)
    h.controller.release()
    expect(h.controller.game?.burns[0].periapsisAltitudeKm).toBeLessThan(200)
    for (let step = 0; step < 200 && !h.controller.game?.outcome; step += 1) h.step(60)
    const outcome = h.controller.game!.outcome!
    expect(outcome.kind).toBe('reentered')
    expect(h.instant).toEqual(outcome.at)
    expect(h.setting.playing).toBe(false)
    expect(h.events).toEqual([{ type: 'maneuver_result', outcome: 'reentered', burns: '1-2' }])
    h.controller.press('prograde')
    expect(h.controller.burning).toBeNull()
  })

  it('counts an abandoned attempt only after a burn', () => {
    const h = harness()
    h.controller.enter()
    h.controller.newGame()
    expect(h.events).toEqual([])
    h.controller.press('prograde')
    h.step(0.5)
    h.controller.release()
    h.controller.restart()
    expect(h.events).toEqual([{ type: 'maneuver_result', outcome: 'restarted', burns: '1-2' }])
    expect(h.controller.game?.burns).toEqual([])
    expect(h.instant).toEqual(START)
  })

  it('starts a game well inside the supported time range', () => {
    const h = harness(7, addSeconds(MAX_SIMULATION_INSTANT, -86_400))
    h.controller.enter()
    expect(secondsBetween(MAX_SIMULATION_INSTANT, h.controller.game!.startInstant)).toBeGreaterThan(50 * 86_400)
    expect(h.instant).toEqual(h.controller.game!.startInstant)
  })
})
