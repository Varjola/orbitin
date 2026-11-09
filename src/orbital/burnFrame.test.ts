import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { dotVec3, lengthVec3, subtractVec3 } from '../core/vec3.ts'
import { burnComponents, burnFrame, burnFromComponents } from './burnFrame.ts'
import { stateVectorEci } from './keplerian.ts'

const CIRCLE = { semiMajorAxisKm: 7000, eccentricity: 0, inclinationRad: degToRad(51.6), raanRad: degToRad(40), argOfPeriapsisRad: 0 }
const ELLIPSE = { ...CIRCLE, semiMajorAxisKm: 20_000, eccentricity: 0.6, argOfPeriapsisRad: degToRad(30) }

describe('burnFrame', () => {
  it('is three perpendicular unit directions', () => {
    const { prograde, normal, outward } = burnFrame(stateVectorEci(ELLIPSE, degToRad(100)))
    for (const direction of [prograde, normal, outward]) expect(lengthVec3(direction)).toBeCloseTo(1, 12)
    expect(dotVec3(prograde, normal)).toBeCloseTo(0, 12)
    expect(dotVec3(prograde, outward)).toBeCloseTo(0, 12)
    expect(dotVec3(normal, outward)).toBeCloseTo(0, 12)
  })

  it('points outward straight up on a circle, and prograde along the velocity on an ellipse', () => {
    const circle = stateVectorEci(CIRCLE, degToRad(75))
    const up = circle.positionProjectInertialKm
    expect(dotVec3(burnFrame(circle).outward, up) / lengthVec3(up)).toBeCloseTo(1, 12)
    const ellipse = stateVectorEci(ELLIPSE, degToRad(100))
    const velocity = ellipse.velocityProjectInertialKmPerSecond
    expect(dotVec3(burnFrame(ellipse).prograde, velocity) / lengthVec3(velocity)).toBeCloseTo(1, 12)
  })

  it('splits a burn into parts that rebuild it and add up to its size', () => {
    const state = stateVectorEci(ELLIPSE, degToRad(200))
    const burn = { x: 0.4, y: -1.1, z: 0.7 }
    const parts = burnComponents(state, burn)
    expect(Math.hypot(parts.progradeKmPerSecond, parts.normalKmPerSecond, parts.outwardKmPerSecond)).toBeCloseTo(lengthVec3(burn), 12)
    expect(lengthVec3(subtractVec3(burnFromComponents(state, parts), burn))).toBeLessThan(1e-12)
  })

  it('puts a pure plane turn in the normal direction, with a small loss along the old one', () => {
    const state = stateVectorEci(CIRCLE, degToRad(0))
    const turned = stateVectorEci({ ...CIRCLE, inclinationRad: CIRCLE.inclinationRad + degToRad(10) }, degToRad(0))
    const burn = subtractVec3(turned.velocityProjectInertialKmPerSecond, state.velocityProjectInertialKmPerSecond)
    const parts = burnComponents(state, burn)
    // Turning a velocity v by 10° means v sin 10° sideways and a little less
    // speed along the old direction: the turned arrow's tip swings past it.
    const speed = lengthVec3(state.velocityProjectInertialKmPerSecond)
    expect(Math.abs(parts.normalKmPerSecond)).toBeCloseTo(speed * Math.sin(degToRad(10)), 10)
    expect(parts.progradeKmPerSecond).toBeCloseTo(-speed * (1 - Math.cos(degToRad(10))), 10)
    expect(parts.outwardKmPerSecond).toBeCloseTo(0, 10)
  })

  it('refuses a state with no angular momentum', () => {
    expect(() => burnFrame({ positionProjectInertialKm: { x: 7000, y: 0, z: 0 }, velocityProjectInertialKmPerSecond: { x: 3, y: 0, z: 0 } })).toThrow('no burn frame')
  })
})
