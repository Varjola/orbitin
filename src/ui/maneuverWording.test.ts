import { expect, it } from 'vitest'
import type { SimulationInstant } from '../core/time.ts'
import { createGame, type BurnRecord, type OrbitApsis } from '../simulation/maneuverGame.ts'
import { buildManeuverPanelModel } from './maneuverPanelModel.ts'
import { apsisLabel, controlsStatusText } from './maneuverWording.ts'

const apsis = (kind: OrbitApsis['kind'], secondsUntil: number): OrbitApsis => ({
  kind,
  state: { positionProjectInertialKm: { x: 0, y: 0, z: 0 }, velocityProjectInertialKmPerSecond: { x: 0, y: 0, z: 0 } } as OrbitApsis['state'],
  secondsUntil,
})

it('names a mark without a time while the satellite is more than ten minutes away', () => {
  expect(apsisLabel(apsis('apoapsis', 601))).toBe('Apogee')
  expect(apsisLabel(apsis('periapsis', 5000))).toBe('Perigee')
})

it('counts down in whole minutes from ten, and never says zero', () => {
  expect(apsisLabel(apsis('apoapsis', 600))).toBe('Apogee, in 10m')
  expect(apsisLabel(apsis('apoapsis', 541))).toBe('Apogee, in 10m')
  expect(apsisLabel(apsis('periapsis', 540))).toBe('Perigee, in 9m')
  expect(apsisLabel(apsis('periapsis', 1))).toBe('Perigee, in 1m')
  expect(apsisLabel(apsis('periapsis', 0))).toBe('Perigee, in 1m')
})

it('says under the burn buttons what the closed drawer would: a burn, the last burn, a result, an empty tank', () => {
  const start: SimulationInstant = { unixSeconds: Date.UTC(2026, 10, 3) / 1000 }
  const model = buildManeuverPanelModel(createGame(7, start), start, 'altitude', false)
  expect(controlsStatusText(model)).toBe('')
  expect(controlsStatusText({ ...model, burning: 'prograde' })).toBe('Speed up: thrusters firing, time at 1×.')
  expect(controlsStatusText({ ...model, remainingKmPerSecond: 0 })).toMatch(/^The tank is empty/)
  const burn = { direction: 'prograde', deltaVKmPerSecond: 0.0304, periapsisAltitudeKm: 810, apoapsisAltitudeKm: 928 } as BurnRecord
  expect(controlsStatusText({ ...model, burns: [burn] })).toBe('Last burn: Speed up 30.4 m/s, then 810 km to 928 km.')
  expect(controlsStatusText({ ...model, burns: [burn], burning: 'retrograde' })).toBe('Slow down: thrusters firing, time at 1×.')
  expect(controlsStatusText({ ...model, burns: [burn], remainingKmPerSecond: 0 })).toMatch(/^Last burn: .+ The tank is empty/)
  expect(controlsStatusText({ ...model, outcome: 'won', remainingKmPerSecond: 0 })).toBe('Rendezvous! You matched the target’s orbit. New game and Restart are in the panel on the left.')
  expect(controlsStatusText({ ...model, outcome: 'reentered' })).toBe('Your satellite reached 200 km. New game and Restart are in the panel on the left.')
})
