import { describe, expect, it } from 'vitest'
import { degToRad, TAU, wrapRadians } from '../core/angles.ts'
import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM } from '../core/constants.ts'
import { lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { elementsFromState } from './elementsFromState.ts'
import type { OrbitGeometry } from './geometry.ts'
import { inPlaneElementsFromState } from './inPlaneState.ts'
import { stateVectorEci } from './keplerian.ts'
import type { OrbitalState } from './propagator.ts'

const ONE_METRE_KM = 1e-3
const ONE_MM_PER_SECOND_KM = 1e-6

function angleBetween(a: number, b: number): number {
  const difference = wrapRadians(a - b)
  return Math.min(difference, TAU - difference)
}

function expectSameState(actual: OrbitalState, expected: OrbitalState): void {
  expect(lengthVec3(subtractVec3(actual.positionProjectInertialKm, expected.positionProjectInertialKm))).toBeLessThan(ONE_METRE_KM)
  expect(lengthVec3(subtractVec3(actual.velocityProjectInertialKmPerSecond, expected.velocityProjectInertialKmPerSecond))).toBeLessThan(ONE_MM_PER_SECOND_KM)
}

function roundTrip(geometry: OrbitGeometry, trueAnomalyRad: number): void {
  const state = stateVectorEci(geometry, trueAnomalyRad)
  const recovered = elementsFromState(state)
  expectSameState(stateVectorEci(recovered.geometry, recovered.trueAnomalyRad), state)
}

const ECCENTRICITIES = [0, 1e-13, 1e-9, 1e-4, 0.01, 0.5, 0.9]
const INCLINATIONS_DEG = [0, 1e-12, 1e-6, 0.3, 28.5, 51.6, 90, 98, 179.7, 180]
const ANGLES_DEG = [0, 40, 180, 287]

describe('elementsFromState', () => {
  it('round-trips every state within 1 m and 1 mm/s, singular cases included', () => {
    for (const eccentricity of ECCENTRICITIES) {
      for (const inclinationDeg of INCLINATIONS_DEG) {
        for (const angleDeg of ANGLES_DEG) {
          const geometry = {
            semiMajorAxisKm: eccentricity === 0.9 ? 80_000 : 12_000,
            eccentricity,
            inclinationRad: degToRad(inclinationDeg),
            raanRad: degToRad(angleDeg),
            argOfPeriapsisRad: degToRad(287 - angleDeg),
          }
          for (const trueAnomalyDeg of ANGLES_DEG) roundTrip(geometry, degToRad(trueAnomalyDeg + 13))
        }
      }
    }
  })

  it('recovers each element where all of them exist', () => {
    const geometry = { semiMajorAxisKm: 26_560, eccentricity: 0.72, inclinationRad: degToRad(63.4), raanRad: degToRad(211), argOfPeriapsisRad: degToRad(270) }
    const recovered = elementsFromState(stateVectorEci(geometry, degToRad(120)))
    expect(recovered.geometry.semiMajorAxisKm).toBeCloseTo(geometry.semiMajorAxisKm, 6)
    expect(recovered.geometry.eccentricity).toBeCloseTo(geometry.eccentricity, 12)
    expect(recovered.geometry.inclinationRad).toBeCloseTo(geometry.inclinationRad, 12)
    expect(recovered.geometry.raanRad).toBeCloseTo(geometry.raanRad, 12)
    expect(recovered.geometry.argOfPeriapsisRad).toBeCloseTo(geometry.argOfPeriapsisRad, 12)
    expect(recovered.trueAnomalyRad).toBeCloseTo(degToRad(120), 12)
  })

  it('reports a circle with no periapsis, counting the anomaly from the node', () => {
    const geometry = { semiMajorAxisKm: 7000, eccentricity: 0, inclinationRad: degToRad(51.6), raanRad: degToRad(40), argOfPeriapsisRad: 0 }
    const { geometry: recovered, trueAnomalyRad } = elementsFromState(stateVectorEci(geometry, degToRad(75)))
    expect(recovered.eccentricity).toBe(0)
    expect(recovered.argOfPeriapsisRad).toBe(0)
    expect(trueAnomalyRad).toBeCloseTo(degToRad(75), 10)
    expect(recovered.raanRad).toBeCloseTo(degToRad(40), 10)
  })

  it('reports the equator with no node, counting the angles from the x axis', () => {
    for (const inclinationRad of [0, Math.PI]) {
      const geometry = { semiMajorAxisKm: 42_164, eccentricity: 0, inclinationRad, raanRad: 0, argOfPeriapsisRad: 0 }
      const { geometry: recovered, trueAnomalyRad } = elementsFromState(stateVectorEci(geometry, degToRad(75)))
      expect(recovered.raanRad).toBe(0)
      expect(recovered.inclinationRad).toBeCloseTo(inclinationRad, 12)
      expect(trueAnomalyRad).toBeCloseTo(degToRad(75), 10)
    }
  })

  it('agrees with the in-plane inverse on a state in a known plane', () => {
    const plane = { inclinationRad: degToRad(98), raanRad: degToRad(300) }
    const state = stateVectorEci({ ...plane, semiMajorAxisKm: 9000, eccentricity: 0.2, argOfPeriapsisRad: degToRad(33) }, degToRad(150))
    const general = elementsFromState(state)
    const inPlane = inPlaneElementsFromState(plane, state)
    expect(general.geometry.semiMajorAxisKm).toBeCloseTo(inPlane.geometry.semiMajorAxisKm, 8)
    expect(general.geometry.eccentricity).toBeCloseTo(inPlane.geometry.eccentricity, 12)
    expect(angleBetween(general.geometry.argOfPeriapsisRad, inPlane.geometry.argOfPeriapsisRad)).toBeLessThan(1e-10)
    expect(angleBetween(general.trueAnomalyRad, inPlane.trueAnomalyRad)).toBeLessThan(1e-10)
  })

  it('refuses what is not an ellipse', () => {
    const radiusKm = EARTH_RADIUS_KM + 400
    const escape = Math.sqrt((2 * EARTH_MU_KM3_S2) / radiusKm)
    const at = (speed: number): OrbitalState => ({ positionProjectInertialKm: { x: radiusKm, y: 0, z: 0 }, velocityProjectInertialKmPerSecond: { x: 0, y: speed, z: 0 } })
    expect(() => elementsFromState(at(escape * 1.001))).toThrow('elliptical')
    expect(() => elementsFromState(at(escape * 1.5))).toThrow('elliptical')
    expect(() => elementsFromState({ positionProjectInertialKm: { x: radiusKm, y: 0, z: 0 }, velocityProjectInertialKmPerSecond: { x: 3, y: 0, z: 0 } })).toThrow('no angular momentum')
  })
})
