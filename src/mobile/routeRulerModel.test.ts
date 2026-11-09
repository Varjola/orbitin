import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { ROUTE_MAX_ALTITUDE_KM, ROUTE_MIN_ALTITUDE_KM, type RouteOrbitValues } from '../simulation/route/routeObjects.ts'
import { meanAltitudeKm, routeEditOf, routeRulerSpec, routeRulerValue, signedDegrees, type RouteRulerPair } from './routeRulerModel.ts'
import { dragValue, snapAt, stepBy } from './shapeRulerModel.ts'

const orbit = (altitude: number, inclinationDeg: number, raanDeg: number): RouteOrbitValues => ({ perigeeAltitudeKm: altitude, apogeeAltitudeKm: altitude, inclinationDeg, raanDeg, argOfPerigeeDeg: 0, argumentOfLatitudeDeg: 0 })
const low = orbit(550, 55, 10)
const medium = orbit(20200, 55, 10)

describe('the Route Planner Edit ruler', () => {
  it('runs Height over the route model’s heights and snaps at the other object’s height', () => {
    const spec = routeRulerSpec('height', { self: low, other: medium })
    expect(spec.min).toBeCloseTo(ROUTE_MIN_ALTITUDE_KM + EARTH_RADIUS_KM, 6)
    expect(spec.max).toBeCloseTo(ROUTE_MAX_ALTITUDE_KM + EARTH_RADIUS_KM, 6)
    // The other object at GPS height takes GPS's place: one point, its own label.
    expect(spec.snaps.map((snap) => [Math.round(snap.value - EARTH_RADIUS_KM), snap.label])).toEqual([[400, 'spaceStation'], [20200, 'otherHeight'], [35786, 'geostationary']])
    const other = routeRulerSpec('height', { self: medium, other: low })
    expect(other.snaps.map((snap) => snap.label)).toEqual(['spaceStation', 'otherHeight', 'gps', 'geostationary'])
  })

  it('finds the other object’s height with − and + as a drag does', () => {
    const spec = routeRulerSpec('height', { self: orbit(500, 0, 0), other: orbit(600, 0, 0) })
    const start = routeRulerValue('height', orbit(500, 0, 0), 0)
    let value = start
    for (let index = 0; index < 20 && snapAt(spec, value)?.label !== 'otherHeight'; index += 1) value = stepBy(spec, value, 1)
    expect(value - EARTH_RADIUS_KM).toBeCloseTo(600, 6)
    expect(snapAt(spec, value)?.label).toBe('otherHeight')
    // Steps land on round heights, as the heading shows them.
    expect(stepBy(spec, EARTH_RADIUS_KM + 200, 1) - EARTH_RADIUS_KM).toBeCloseTo(210, 6)
    expect(stepBy(spec, EARTH_RADIUS_KM + 20_000, 1) - EARTH_RADIUS_KM).toBeCloseTo(20_200, 6)
  })

  it('reads the same plane where tilt and node both match, and the other’s tilt where only the tilt does', () => {
    const turned = orbit(550, 40, 70)
    const tilt = routeRulerSpec('tilt', { self: turned, other: low })
    expect(tilt.snaps.find((snap) => snap.value === 55)?.label).toBe('otherTilt')
    const sameNode = routeRulerSpec('tilt', { self: orbit(550, 40, 10), other: low })
    expect(sameNode.snaps.find((snap) => snap.value === 55)?.label).toBe('samePlane')
    const node = routeRulerSpec('node', { self: orbit(550, 55, 70), other: low })
    expect(node.snaps.find((snap) => snap.value === 10)?.label).toBe('samePlane')
    expect(routeRulerSpec('node', { self: turned, other: low }).snaps.find((snap) => snap.value === 10)?.label).toBe('otherNode')
    // A drag from 70° holds at the other's node.
    const start = 70
    const travel = node.valueToPosition(start) - node.valueToPosition(10)
    expect(dragValue(node, start, travel - 4).snap?.label).toBe('samePlane')
  })

  it('offers a Sun-synchronous tilt for a low object only', () => {
    const lowTilt = routeRulerSpec('tilt', { self: low, other: medium })
    const sso = lowTilt.snaps.find((snap) => snap.label === 'sunSynchronous')
    expect(sso?.value).toBeGreaterThan(97)
    expect(sso?.value).toBeLessThan(99)
    expect(routeRulerSpec('tilt', { self: medium, other: low }).snaps.some((snap) => snap.label === 'sunSynchronous')).toBe(false)
  })

  it('places the target ahead, together and opposite, and sends it signed', () => {
    const pair: RouteRulerPair = { self: low, other: medium }
    const ahead = routeRulerSpec('ahead', pair)
    expect(ahead.wraps).toBe(true)
    expect(ahead.snaps.filter((snap) => snap.label).map((snap) => [snap.value, snap.label])).toEqual([[0, 'together'], [180, 'opposite']])
    expect(routeRulerValue('ahead', low, -90)).toBe(270)
    expect(routeEditOf('ahead', 270)).toEqual({ kind: 'ahead', aheadDeg: -90 })
    expect(routeEditOf('ahead', 180)).toEqual({ kind: 'ahead', aheadDeg: 180 })
    expect(signedDegrees(360)).toBe(0)
  })

  it('sends a height as both perigee and apogee, the orbit circular', () => {
    const value = routeRulerValue('height', orbit(500, 0, 0), 0)
    expect(routeEditOf('height', value + 100)).toEqual({ kind: 'orbit', changes: { perigeeAltitudeKm: 600, apogeeAltitudeKm: 600 } })
    expect(meanAltitudeKm({ ...low, perigeeAltitudeKm: 500, apogeeAltitudeKm: 700 })).toBe(600)
    expect(routeEditOf('tilt', 51.5)).toEqual({ kind: 'orbit', changes: { inclinationDeg: 51.5 } })
    expect(routeEditOf('node', 360)).toEqual({ kind: 'orbit', changes: { raanDeg: 0 } })
  })
})
