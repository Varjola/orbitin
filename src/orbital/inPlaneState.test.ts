import { describe, expect, it } from 'vitest'
import { degToRad, TAU, wrapRadians } from '../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import { crossVec3, dotVec3, lengthVec3, subtractVec3 } from '../core/vec3.ts'
import type { OrbitGeometry } from './geometry.ts'
import { inPlaneElementsFromState, orbitPlaneBasis, type OrbitPlane } from './inPlaneState.ts'
import { stateVectorEci } from './keplerian.ts'
import { applyTangentialKick } from './maneuver.ts'

const PLANES: readonly OrbitPlane[] = [
  { inclinationRad: 0, raanRad: 0 },
  { inclinationRad: degToRad(51.6), raanRad: degToRad(123) },
  { inclinationRad: degToRad(98), raanRad: degToRad(300) },
]

function angleError(a: number, b: number): number {
  const wrapped = wrapRadians(a - b)
  return Math.min(wrapped, TAU - wrapped)
}

describe('orbitPlaneBasis', () => {
  it('gives an orthonormal, right-handed basis whose normal is the angular momentum', () => {
    for (const plane of PLANES) {
      const { node, ahead, normal } = orbitPlaneBasis(plane)
      expect(lengthVec3(node)).toBeCloseTo(1, 12)
      expect(dotVec3(node, ahead)).toBeCloseTo(0, 12)
      expect(lengthVec3(subtractVec3(crossVec3(node, ahead), normal))).toBeLessThan(1e-12)
      const state = stateVectorEci({ ...plane, semiMajorAxisKm: 7000, eccentricity: 0.1, argOfPeriapsisRad: 1 }, 2)
      const momentum = crossVec3(state.positionProjectInertialKm, state.velocityProjectInertialKmPerSecond)
      expect(dotVec3(momentum, normal) / lengthVec3(momentum)).toBeCloseTo(1, 12)
    }
  })
})

describe('inPlaneElementsFromState', () => {
  it('round-trips state vectors within 1 m and 1 mm/s across eccentricities and planes', () => {
    for (const plane of PLANES) {
      for (const eccentricity of [0, 1e-9, 1e-4, 0.01, 0.5, 0.9]) {
        for (const trueAnomalyRad of [0, 0.7, 2.5, 4.4]) {
          const geometry: OrbitGeometry = { ...plane, semiMajorAxisKm: 8000 / (1 - eccentricity), eccentricity, argOfPeriapsisRad: 1.1 }
          const state = stateVectorEci(geometry, trueAnomalyRad)
          const recovered = inPlaneElementsFromState(plane, state)
          const again = stateVectorEci(recovered.geometry, recovered.trueAnomalyRad)
          expect(lengthVec3(subtractVec3(again.positionProjectInertialKm, state.positionProjectInertialKm))).toBeLessThan(1e-3)
          expect(lengthVec3(subtractVec3(again.velocityProjectInertialKmPerSecond, state.velocityProjectInertialKmPerSecond))).toBeLessThan(1e-6)
          expect(recovered.geometry.inclinationRad).toBe(plane.inclinationRad)
          expect(recovered.geometry.raanRad).toBe(plane.raanRad)
          expect(recovered.geometry.semiMajorAxisKm).toBeCloseTo(geometry.semiMajorAxisKm, 6)
          expect(recovered.geometry.eccentricity).toBeCloseTo(eccentricity, 9)
          if (eccentricity >= 1e-4) {
            expect(angleError(recovered.geometry.argOfPeriapsisRad, geometry.argOfPeriapsisRad)).toBeLessThan(1e-8)
            expect(angleError(recovered.trueAnomalyRad, trueAnomalyRad)).toBeLessThan(1e-8)
          }
        }
      }
    }
  })

  it('treats an exactly circular orbit as having no periapsis', () => {
    const plane = PLANES[1]
    const state = stateVectorEci({ ...plane, semiMajorAxisKm: EARTH_RADIUS_KM + 400, eccentricity: 0, argOfPeriapsisRad: 0 }, 1.3)
    const { geometry, trueAnomalyRad } = inPlaneElementsFromState(plane, state)
    expect(geometry.eccentricity).toBe(0)
    expect(geometry.argOfPeriapsisRad).toBe(0)
    expect(angleError(trueAnomalyRad, 1.3)).toBeLessThan(1e-12)
  })

  it('puts periapsis at a prograde burn point and apoapsis at a retrograde one', () => {
    const plane = PLANES[1]
    const radiusKm = EARTH_RADIUS_KM + 400
    const burnAt = 2.2
    const state = stateVectorEci({ ...plane, semiMajorAxisKm: radiusKm, eccentricity: 0, argOfPeriapsisRad: 0 }, burnAt)
    const raised = inPlaneElementsFromState(plane, applyTangentialKick(state, 0.05))
    expect(angleError(raised.trueAnomalyRad, 0)).toBeLessThan(1e-9)
    expect(angleError(raised.geometry.argOfPeriapsisRad, burnAt)).toBeLessThan(1e-9)
    expect(raised.geometry.semiMajorAxisKm * (1 - raised.geometry.eccentricity)).toBeCloseTo(radiusKm, 6)
    const lowered = inPlaneElementsFromState(plane, applyTangentialKick(state, -0.05))
    expect(angleError(lowered.trueAnomalyRad, Math.PI)).toBeLessThan(1e-9)
    expect(lowered.geometry.semiMajorAxisKm * (1 + lowered.geometry.eccentricity)).toBeCloseTo(radiusKm, 6)
  })

  it('refuses escape orbits and states moving against the plane', () => {
    const plane = PLANES[1]
    const radiusKm = EARTH_RADIUS_KM + 400
    const state = stateVectorEci({ ...plane, semiMajorAxisKm: radiusKm, eccentricity: 0, argOfPeriapsisRad: 0 }, 0)
    const escapeSpeed = Math.sqrt(2 * EARTH_MU_KM3_S2 / radiusKm)
    expect(() => inPlaneElementsFromState(plane, applyTangentialKick(state, escapeSpeed - lengthVec3(state.velocityProjectInertialKmPerSecond) + 1e-6))).toThrow(/elliptical/)
    expect(() => inPlaneElementsFromState(plane, applyTangentialKick(state, -2 * lengthVec3(state.velocityProjectInertialKmPerSecond)))).toThrow(/direction of motion/)
  })
})
