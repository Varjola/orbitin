import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { EARTH_RADIUS_KM, MIN_PERIAPSIS_RADIUS_KM, MAX_APOAPSIS_RADIUS_KM } from '../core/constants.ts'
import { DEFAULT_GEOMETRY, constrainGeometry, deriveOrbitValues, type OrbitGeometry } from './geometry.ts'
import { stateVectorEci } from './keplerian.ts'

const tolerance = 1e-8

describe('Keplerian geometry', () => {
  it('matches reference orientation cases', () => {
    const base: OrbitGeometry = { ...DEFAULT_GEOMETRY, semiMajorAxisKm: 7000, eccentricity: 0, inclinationRad: 0 }
    expect(stateVectorEci({ ...base, raanRad: 0, argOfPeriapsisRad: 0 }, 0).positionProjectInertialKm.x).toBeCloseTo(7000, 8)
    expect(stateVectorEci({ ...base, raanRad: 0, argOfPeriapsisRad: 0 }, Math.PI / 2).positionProjectInertialKm.y).toBeCloseTo(7000, 8)
    expect(stateVectorEci({ ...base, inclinationRad: degToRad(90) }, Math.PI / 2).positionProjectInertialKm.z).toBeCloseTo(7000, 8)
    expect(stateVectorEci({ ...base, inclinationRad: degToRad(45) }, Math.PI / 2).positionProjectInertialKm.y).toBeCloseTo(4949.747, 3)
    expect(stateVectorEci({ ...base, raanRad: degToRad(90) }, 0).positionProjectInertialKm.y).toBeCloseTo(7000, 8)
    expect(stateVectorEci({ ...base, argOfPeriapsisRad: degToRad(90) }, 0).positionProjectInertialKm.y).toBeCloseTo(7000, 8)
  })

  it('derives the sidereal GEO period within five seconds', () => {
    expect(deriveOrbitValues({ ...DEFAULT_GEOMETRY, semiMajorAxisKm: 42164.17, eccentricity: 0 }).periodSeconds).toBeCloseTo(86164, -0 + 0)
  })

  it('clamps the edited field while preserving the other geometry field', () => {
    const eccentricityEdit = constrainGeometry({ ...DEFAULT_GEOMETRY, semiMajorAxisKm: 7000, eccentricity: 0.8 }, 'eccentricity')
    expect(eccentricityEdit.geometry.semiMajorAxisKm).toBe(7000)
    expect(eccentricityEdit.geometry.eccentricity).toBeLessThan(0.8)
    expect(eccentricityEdit.constraint.kind).toBe('minimumPeriapsis')
    const axisEdit = constrainGeometry({ ...DEFAULT_GEOMETRY, semiMajorAxisKm: 50000, eccentricity: 0.8 }, 'semiMajorAxisKm')
    expect(axisEdit.geometry.eccentricity).toBe(0.8)
    expect(axisEdit.geometry.semiMajorAxisKm).toBeLessThan(50000)
    expect(axisEdit.constraint.kind).toBe('maximumApoapsis')
  })

  it('keeps every default geometry constraint valid', () => {
    const derived = deriveOrbitValues(DEFAULT_GEOMETRY)
    expect(derived.periapsisRadiusKm).toBeGreaterThanOrEqual(MIN_PERIAPSIS_RADIUS_KM - tolerance)
    expect(derived.apoapsisRadiusKm).toBeLessThanOrEqual(MAX_APOAPSIS_RADIUS_KM + tolerance)
    expect(derived.periapsisAltitudeKm).toBeGreaterThan(0)
    expect(EARTH_RADIUS_KM).toBe(6378.137)
  })
})
