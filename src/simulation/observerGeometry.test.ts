import { expect, it } from 'vitest'
import { EARTH_RADIUS_KM } from '../core/constants.ts'
import { elevationAngleRad, geocentricLatitudeFromGeodetic, observerPositionEarthFixedKm } from './observerGeometry.ts'

const DEG = Math.PI / 180
const helsinki = { geodeticLatitudeRad: 60.17 * DEG, longitudeRad: 24.94 * DEG }

it('places the observer on the rendered sphere at the geocentric latitude of the same point', () => {
  const position = observerPositionEarthFixedKm(helsinki)
  expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(EARTH_RADIUS_KM, 6)
  // At 60° the geocentric latitude is about 0.17° lower than the geodetic one.
  expect((helsinki.geodeticLatitudeRad - geocentricLatitudeFromGeodetic(helsinki.geodeticLatitudeRad)) / DEG).toBeCloseTo(0.166, 2)
  expect(geocentricLatitudeFromGeodetic(0)).toBe(0)
  expect(geocentricLatitudeFromGeodetic(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12)
  const equator = observerPositionEarthFixedKm({ geodeticLatitudeRad: 0, longitudeRad: 90 * DEG })
  expect(equator.x).toBeCloseTo(0, 6)
  expect(equator.y).toBeCloseTo(EARTH_RADIUS_KM, 6)
})

it('measures 90° at the zenith, 0° on the horizon and -90° at the antipode', () => {
  const position = observerPositionEarthFixedKm(helsinki)
  const zenith = { x: position.x * 1.5, y: position.y * 1.5, z: position.z * 1.5 }
  expect(elevationAngleRad(helsinki, zenith)! / DEG).toBeCloseTo(90, 5)
  const antipode = { x: -position.x, y: -position.y, z: -position.z }
  expect(elevationAngleRad(helsinki, antipode)! / DEG).toBeCloseTo(-90, 5)
  // A point along the local horizontal (east) from the observer.
  const east = { x: -Math.sin(helsinki.longitudeRad), y: Math.cos(helsinki.longitudeRad), z: 0 }
  const horizon = { x: position.x + east.x * 1000, y: position.y + east.y * 1000, z: position.z + east.z * 1000 }
  expect(elevationAngleRad(helsinki, horizon)! / DEG).toBeCloseTo(0, 9)
  expect(elevationAngleRad(helsinki, position)).toBeNull()
})

it('sees a geostationary satellite over its own meridian at the textbook elevation', () => {
  // At the equator under a GEO satellite: straight up.
  const geo = { x: 42164, y: 0, z: 0 }
  expect(elevationAngleRad({ geodeticLatitudeRad: 0, longitudeRad: 0 }, geo)! / DEG).toBeCloseTo(90, 6)
  // From 60° N on the same meridian (spherical Earth): about 21.2°.
  const lat = geocentricLatitudeFromGeodetic(60 * DEG)
  const expected = Math.atan((Math.cos(lat) - EARTH_RADIUS_KM / 42164) / Math.sin(lat)) / DEG
  expect(elevationAngleRad({ geodeticLatitudeRad: 60 * DEG, longitudeRad: 0 }, geo)! / DEG).toBeCloseTo(expected, 6)
})
