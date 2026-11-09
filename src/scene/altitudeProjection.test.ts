import { describe, expect, it } from 'vitest'
import { degToRad } from '../core/angles.ts'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { orbitPlaneBasis } from '../orbital/inPlaneState.ts'
import { stateVectorEci } from '../orbital/keplerian.ts'
import { altitudeRadius, altitudeViewPoint, fitAltitudeCamera, fromScreen, panAltitudeCamera, ringAltitudes, toScreen, zoomAltitudeCamera } from './altitudeProjection.ts'

const PLANE = { inclinationRad: degToRad(51.6), raanRad: degToRad(40) }
const basis = orbitPlaneBasis(PLANE)

function pointAt(altitudeKm: number, argumentOfLatitudeRad: number) {
  return stateVectorEci({ ...PLANE, semiMajorAxisKm: EARTH_RADIUS_KM + altitudeKm, eccentricity: 0, argOfPeriapsisRad: 0 }, argumentOfLatitudeRad).positionProjectInertialKm
}

describe('altitude view projection', () => {
  it('keeps the true angle and shows altitude as distance from the centre', () => {
    const point = altitudeViewPoint(pointAt(500, degToRad(30)), basis)
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(400, 9)
    expect(Math.atan2(point.y, point.x)).toBeCloseTo(degToRad(30), 12)
    expect(altitudeRadius(700) - altitudeRadius(500)).toBe(200)
  })

  it('puts the 200 km floor on the disc edge and shrinks lower altitudes to the centre', () => {
    expect(altitudeRadius(200)).toBe(100)
    expect(altitudeRadius(150)).toBe(50)
    expect(altitudeRadius(-500)).toBe(0)
  })

  it('thins the rings as the view zooms out', () => {
    expect(ringAltitudes(1000, 0.5)).toEqual([300, 400, 500, 600, 700, 800, 900, 1000])
    expect(ringAltitudes(1000, 0.2)).toEqual([400, 600, 800, 1000])
    expect(ringAltitudes(1000, 0.1)).toEqual([500, 1000])
  })

  it('fits the highest ring into the free area', () => {
    const camera = fitAltitudeCamera(1000, 800, 600)
    const edge = toScreen({ x: altitudeRadius(1080), y: 0 }, camera, { x: 400, y: 300 })
    expect(edge.x - 400).toBeCloseTo(0.94 * 300, 9)
  })

  it('pans by screen distance and zooms about the pointer', () => {
    const origin = { x: 400, y: 300 }
    const camera = fitAltitudeCamera(1000, 800, 600)
    const panned = panAltitudeCamera(camera, 50, -20)
    const before = toScreen({ x: 120, y: -40 }, camera, origin)
    const after = toScreen({ x: 120, y: -40 }, panned, origin)
    expect(after.x - before.x).toBeCloseTo(50, 9)
    expect(after.y - before.y).toBeCloseTo(-20, 9)
    const pointer = { x: 520, y: 210 }
    const anchor = fromScreen(pointer, panned, origin)
    const zoomed = zoomAltitudeCamera(panned, origin, pointer, 2.5)
    expect(zoomed.scale).toBeCloseTo(panned.scale * 2.5, 12)
    const stays = toScreen(anchor, zoomed, origin)
    expect(stays.x).toBeCloseTo(pointer.x, 9)
    expect(stays.y).toBeCloseTo(pointer.y, 9)
  })
})
