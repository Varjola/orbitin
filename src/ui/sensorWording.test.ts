import { expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { sensorFieldOfViewRangeNote, sensorLimitLabel, sensorSteeringRangeNote } from './sensorWording.ts'

const geoHorizon = Math.asin(EARTH_RADIUS_KM / 42164.17)
const geo = { usefulLimitRad: geoHorizon, minimumGroundElevationRad: 0, eccentric: false }

it('states the useful half-angle range in degrees, not as a coverage fraction', () => {
  const note = sensorFieldOfViewRangeNote({ ...geo, authoredRad: degToRad(6.42) })
  expect(note).toBe('Useful range at this orbit: 0–8.70°.')
  expect(note).not.toMatch(/%/)
})

it('reports an authored angle past the limit without changing it', () => {
  const note = sensorFieldOfViewRangeNote({ ...geo, authoredRad: degToRad(10) })
  expect(note).toContain('10.00° reaches past the horizon')
  expect(note).toContain('a wider angle adds no surface')
  const constrained = sensorFieldOfViewRangeNote({ authoredRad: degToRad(10), usefulLimitRad: degToRad(8.57), minimumGroundElevationRad: degToRad(10), eccentric: true })
  expect(constrained).toContain('near periapsis')
  expect(constrained).toContain('past the minimum-elevation limit')
})

it('describes steering as what remains between the half-angle and the limit', () => {
  expect(sensorSteeringRangeNote({ ...geo, authoredRad: degToRad(3), fieldOfViewHalfAngleRad: degToRad(5) })).toBe('Useful steering at this orbit: 0–3.70°.')
  expect(sensorSteeringRangeNote({ ...geo, authoredRad: degToRad(20), fieldOfViewHalfAngleRad: degToRad(5) })).toContain('20.00° reaches past the horizon')
  expect(sensorSteeringRangeNote({ ...geo, authoredRad: degToRad(3), fieldOfViewHalfAngleRad: degToRad(10) })).toContain('cannot widen the field of regard')
})

it('names what bounds a cap', () => {
  expect(sensorLimitLabel('sensor')).toBe('Sensor angle')
  expect(sensorLimitLabel('elevation')).toBe('Minimum ground elevation')
  expect(sensorLimitLabel('horizon')).toBe('Horizon')
})
