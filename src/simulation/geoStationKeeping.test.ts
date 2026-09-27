import { expect, it } from 'vitest'
import { radToDeg, wrapRadiansSigned } from '../core/angles.ts'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { projectInertialToEarthFixed } from '../core/referenceFrames.ts'
import { createPropagator } from './OrbitalObject.ts'
import { createObjectFromPreset, ORBIT_PRESETS } from './orbitPresets.ts'
import { environmentAt } from './environment.ts'

it('keeps the GEO preset at one longitude for three days', () => {
  const preset = ORBIT_PRESETS.find(p => p.id === 'geo')!
  const object = createObjectFromPreset(preset,{id:'geo',name:'GEO',colorHex:0xffffff},SIMULATION_START_INSTANT)
    // The two-body preset stays on ideal two-body propagation, which is what keeps
  // this test meaningful as the guard on INV-7.
  const propagator = createPropagator(object.source, object.propagation)
  expect(object.propagation).toEqual({ kind: 'idealTwoBody' })
  const longitude = (seconds: number) => {
    const instant = {unixSeconds:SIMULATION_START_INSTANT.unixSeconds+seconds}
    const v = projectInertialToEarthFixed(propagator.stateAt(instant).positionProjectInertialKm,environmentAt(instant).orientation)
    return Math.atan2(v.y,v.x)
  }
  const first = longitude(0)
  for (let day = 1; day <= 3; day++) {
    expect(Math.abs(radToDeg(wrapRadiansSigned(longitude(day*86400)-first)))/day).toBeLessThan(0.005)
  }
  // Sidereal versus solar rotation differs by 0.985647 deg/day (IAU GMST rate).
  // A solar-day Earth would exceed this test's 0.005 deg/day bound by ~197x.
  const solarRateDriftDegPerDay = 360*(86400/86164.0905-1)
  expect(solarRateDriftDegPerDay).toBeCloseTo(0.985647,5)
})
