import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { secondsBetween } from '../core/time.ts'
import { dotVec3, lengthVec3, subtractVec3 } from '../core/vec3.ts'
import type { OrbitGeometry } from './geometry.ts'
import { inPlaneElementsFromState } from './inPlaneState.ts'
import { stateVectorEci } from './keplerian.ts'
import { KeplerianPropagator, phaseFromTrueAnomaly } from './keplerianPropagator.ts'
import { applyTangentialKick, circularSpeed, hohmannTransfer, nextInstantAtOrBelowAltitude, phaseAngleRad, planeChangeDeltaV, propellantFraction, sampleArc } from './maneuver.ts'

const PLANE = { inclinationRad: degToRad(51.6), raanRad: degToRad(40) }
const LEO_RADIUS_KM = EARTH_RADIUS_KM + 400

function circular(radiusKm: number): OrbitGeometry {
  return { ...PLANE, semiMajorAxisKm: radiusKm, eccentricity: 0, argOfPeriapsisRad: 0 }
}

function altitudeAt(geometry: OrbitGeometry, phase: ReturnType<typeof phaseFromTrueAnomaly>, unixSeconds: number): number {
  return lengthVec3(new KeplerianPropagator(geometry, phase).stateAt({ unixSeconds }).positionProjectInertialKm) - EARTH_RADIUS_KM
}

describe('applyTangentialKick', () => {
  it('changes only the speed, along or against the velocity', () => {
    const state = stateVectorEci({ ...PLANE, semiMajorAxisKm: 9000, eccentricity: 0.2, argOfPeriapsisRad: 0.4 }, 1.9)
    const speed = lengthVec3(state.velocityProjectInertialKmPerSecond)
    for (const deltaV of [0.01, -0.01]) {
      const kicked = applyTangentialKick(state, deltaV)
      expect(kicked.positionProjectInertialKm).toEqual(state.positionProjectInertialKm)
      expect(lengthVec3(kicked.velocityProjectInertialKmPerSecond)).toBeCloseTo(speed + deltaV, 12)
      expect(dotVec3(kicked.velocityProjectInertialKmPerSecond, state.velocityProjectInertialKmPerSecond) / ((speed + deltaV) * speed)).toBeCloseTo(1, 12)
    }
  })
})

describe('hohmannTransfer', () => {
  it('matches the reference values between circular orbits', () => {
    const up = hohmannTransfer(LEO_RADIUS_KM, EARTH_RADIUS_KM + 600)
    expect(up.firstKmPerSecond * 1000).toBeCloseTo(55.545, 2)
    expect(up.secondKmPerSecond * 1000).toBeCloseTo(55.142, 2)
    expect(up.totalKmPerSecond * 1000).toBeCloseTo(110.687, 2)
    expect(up.transferSeconds / 60).toBeCloseTo(47.308, 2)
    const geostationary = hohmannTransfer(LEO_RADIUS_KM, EARTH_RADIUS_KM + 35786)
    expect(geostationary.firstKmPerSecond * 1000).toBeCloseTo(2397.47, 1)
    expect(geostationary.secondKmPerSecond * 1000).toBeCloseTo(1456.49, 1)
    const down = hohmannTransfer(EARTH_RADIUS_KM + 600, LEO_RADIUS_KM)
    expect(down.totalKmPerSecond).toBeCloseTo(up.totalKmPerSecond, 12)
  })

  it('raises the far side to the target orbit with its first burn', () => {
    const targetRadiusKm = EARTH_RADIUS_KM + 600
    const state = stateVectorEci(circular(LEO_RADIUS_KM), 0.8)
    const { geometry } = inPlaneElementsFromState(PLANE, applyTangentialKick(state, hohmannTransfer(LEO_RADIUS_KM, targetRadiusKm).firstKmPerSecond))
    expect(geometry.semiMajorAxisKm * (1 + geometry.eccentricity)).toBeCloseTo(targetRadiusKm, 6)
  })
})

describe('sampleArc', () => {
  it('includes both ends and keeps steps no larger than asked', () => {
    const geometry = { ...PLANE, semiMajorAxisKm: 8000, eccentricity: 0.1, argOfPeriapsisRad: 0.3 }
    const points = sampleArc(geometry, 0.5, Math.PI, degToRad(2))
    expect(points).toHaveLength(91)
    expect(lengthVec3(subtractVec3(points[0], stateVectorEci(geometry, 0.5).positionProjectInertialKm))).toBeLessThan(1e-9)
    expect(lengthVec3(subtractVec3(points[90], stateVectorEci(geometry, 0.5 + Math.PI).positionProjectInertialKm))).toBeLessThan(1e-9)
    for (const point of sampleArc(circular(LEO_RADIUS_KM), 0, Math.PI, 0.1)) expect(lengthVec3(point)).toBeCloseTo(LEO_RADIUS_KM, 9)
  })
})

describe('nextInstantAtOrBelowAltitude', () => {
  const geometry = { ...PLANE, semiMajorAxisKm: EARTH_RADIUS_KM + (150 + 600) / 2, eccentricity: (450 / 2) / (EARTH_RADIUS_KM + 375), argOfPeriapsisRad: 0 }
  const fromApoapsis = phaseFromTrueAnomaly(geometry.eccentricity, Math.PI, { unixSeconds: 0 })

  it('finds the descending crossing exactly, however long the step', () => {
    const crossing = nextInstantAtOrBelowAltitude(geometry, fromApoapsis, 200, { unixSeconds: 0 })!
    expect(crossing.unixSeconds).toBeGreaterThan(0)
    expect(altitudeAt(geometry, fromApoapsis, crossing.unixSeconds)).toBeCloseTo(200, 6)
    expect(altitudeAt(geometry, fromApoapsis, crossing.unixSeconds - 1)).toBeGreaterThan(200)
    expect(altitudeAt(geometry, fromApoapsis, crossing.unixSeconds + 1)).toBeLessThan(200)
    // Before periapsis: less than half an orbit after apoapsis.
    expect(crossing.unixSeconds).toBeLessThan(Math.PI * Math.sqrt(geometry.semiMajorAxisKm ** 3 / 398600.4418))
  })

  it('returns the start while already at or below the altitude', () => {
    const atPeriapsis = phaseFromTrueAnomaly(geometry.eccentricity, 0, { unixSeconds: 50 })
    expect(nextInstantAtOrBelowAltitude(geometry, atPeriapsis, 200, { unixSeconds: 50 })).toEqual({ unixSeconds: 50 })
    expect(nextInstantAtOrBelowAltitude(circular(EARTH_RADIUS_KM + 180), atPeriapsis, 200, { unixSeconds: 50 })).toEqual({ unixSeconds: 50 })
  })

  it('returns null when the orbit never gets that low', () => {
    expect(nextInstantAtOrBelowAltitude(circular(EARTH_RADIUS_KM + 250), fromApoapsis, 200, { unixSeconds: 0 })).toBeNull()
    expect(nextInstantAtOrBelowAltitude(geometry, fromApoapsis, 140, { unixSeconds: 0 })).toBeNull()
  })

  it('finds the next pass after the current one has ended', () => {
    const justPastBelow = phaseFromTrueAnomaly(geometry.eccentricity, 1.5, { unixSeconds: 0 })
    const crossing = nextInstantAtOrBelowAltitude(geometry, justPastBelow, 200, { unixSeconds: 0 })!
    expect(secondsBetween(crossing, { unixSeconds: 0 })).toBeGreaterThan(Math.PI * Math.sqrt(geometry.semiMajorAxisKm ** 3 / 398600.4418))
    expect(altitudeAt(geometry, justPastBelow, crossing.unixSeconds)).toBeCloseTo(200, 6)
  })

  it('gives an instant, not NaN, when periapsis just touches the altitude', () => {
    // Here rounding puts the crossing's cosine at 1 + 3e-14.
    const touching = { ...PLANE, semiMajorAxisKm: 6584.728313041354, eccentricity: 0.001001, argOfPeriapsisRad: 0 }
    const crossing = nextInstantAtOrBelowAltitude(touching, phaseFromTrueAnomaly(touching.eccentricity, Math.PI, { unixSeconds: 0 }), 200, { unixSeconds: 0 })!
    expect(Number.isFinite(crossing.unixSeconds)).toBe(true)
    expect(crossing.unixSeconds).toBeGreaterThan(0)
  })
})

describe('phaseAngleRad', () => {
  it('is positive ahead and negative behind in the direction of motion', () => {
    const observer = stateVectorEci(circular(LEO_RADIUS_KM), 1)
    const target = (offsetRad: number) => stateVectorEci(circular(EARTH_RADIUS_KM + 900), 1 + offsetRad).positionProjectInertialKm
    expect(phaseAngleRad(observer, target(degToRad(40)))).toBeCloseTo(degToRad(40), 12)
    expect(phaseAngleRad(observer, target(degToRad(-25)))).toBeCloseTo(degToRad(-25), 12)
    expect(Math.abs(phaseAngleRad(observer, target(Math.PI)))).toBeCloseTo(Math.PI, 12)
  })
})

describe('plane change and propellant', () => {
  it('makes a plane change cost a large share of the orbital speed', () => {
    const speed = circularSpeed(LEO_RADIUS_KM)
    expect(speed).toBeCloseTo(7.6686, 4)
    expect(planeChangeDeltaV(speed, degToRad(1)) * 1000).toBeCloseTo(133.84, 2)
    expect(planeChangeDeltaV(speed, degToRad(60))).toBeCloseTo(speed, 12)
    expect(planeChangeDeltaV(speed, degToRad(-10))).toBeCloseTo(planeChangeDeltaV(speed, degToRad(10)), 12)
  })

  it('converts speed change to propellant share with the rocket equation', () => {
    expect(propellantFraction(circularSpeed(LEO_RADIUS_KM), 300)).toBeCloseTo(0.9262, 4)
    expect(propellantFraction(0, 300)).toBe(0)
    expect(propellantFraction(-1, 300)).toBeCloseTo(propellantFraction(1, 300), 12)
    expect(() => propellantFraction(1, 0)).toThrow('Specific impulse')
  })
})
