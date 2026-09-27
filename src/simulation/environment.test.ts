import { expect, it } from 'vitest'
import { radToDeg, TAU, wrapRadiansSigned } from '../core/angles.ts'
import { MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { projectInertialToEarthFixed } from '../core/referenceFrames.ts'
import { lengthVec3 } from '../core/vec3.ts'
import { environmentAt } from './environment.ts'
import { subSolarPoint } from './subSolarPoint.ts'

it('derives the same sub-solar point directly and through both frame transforms', () => {
  for (const instant of [MIN_SIMULATION_INSTANT, {unixSeconds:0}, {unixSeconds:946728000}, SIMULATION_START_INSTANT, {unixSeconds:Date.UTC(2026,5,21,12)/1000}, MAX_SIMULATION_INSTANT]) {
    const env = environmentAt(instant)
    expect(env.instant).toBe(instant)
    expect(environmentAt({...instant})).toEqual(env)
    expect(lengthVec3(env.sunDirectionProjectInertial)).toBeCloseTo(1,12)
    expect(env.orientation.gmstRad).toBeGreaterThanOrEqual(0)
    expect(env.orientation.gmstRad).toBeLessThan(TAU)
    const fixed = projectInertialToEarthFixed(env.sunDirectionProjectInertial,env.orientation)
    expect(Math.asin(fixed.z)).toBeCloseTo(env.subSolarPoint.latitudeRad,9)
    expect(Math.abs(wrapRadiansSigned(Math.atan2(fixed.y,fixed.x)-env.subSolarPoint.longitudeRad))).toBeLessThan(1e-9)
  }
  const point = environmentAt(SIMULATION_START_INSTANT).subSolarPoint
  expect(Math.abs(radToDeg(point.latitudeRad)+0.04)).toBeLessThan(0.02)
  expect(Math.abs(radToDeg(point.longitudeRad)-1.86)).toBeLessThan(0.02)
})
it('uses east-positive longitude and moves the sub-solar point west over a day', () => {
  expect(subSolarPoint(0.3,0.2,0)).toEqual({latitudeRad:0.2,longitudeRad:0.3})
  expect(subSolarPoint(0,0,Math.PI).longitudeRad).toBe(Math.PI)
  let previous = environmentAt(SIMULATION_START_INSTANT).subSolarPoint.longitudeRad
  let travel = 0
  for (let hour = 1; hour <= 24; hour++) {
    const point = environmentAt({unixSeconds:SIMULATION_START_INSTANT.unixSeconds+hour*3600}).subSolarPoint
    const delta = wrapRadiansSigned(point.longitudeRad-previous)
    expect(delta).toBeLessThan(0)
    travel += delta; previous = point.longitudeRad
  }
  expect(Math.abs(radToDeg(travel)+360)).toBeLessThan(0.1)
})
