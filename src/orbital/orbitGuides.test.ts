import { expect, it } from 'vitest'
import { orbitGuideGeometry } from './orbitGuides.ts'

const DEG = Math.PI / 180
const close = (actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

it('puts periapsis and apoapsis on the apse line in the orbital plane', () => {
  // i = 0, Ω = 0, ω = 0: periapsis on +x.
  const flat = orbitGuideGeometry({ semiMajorAxisKm: 10000, eccentricity: 0.2 }, { inclinationRad: 0, raanRad: 0, argOfPeriapsisRad: 0 })
  close(flat.periapsisKm, { x: 8000, y: 0, z: 0 })
  close(flat.apoapsisKm, { x: -12000, y: 0, z: 0 })
  expect(flat.ringRadiusKm).toBe(10000)
  expect(flat.equatorial).toBe(true)
  expect(flat.circular).toBe(false)
})

it('turns the node with RAAN and lifts periapsis out of the equator with inclination', () => {
  // Ω = 90°: the ascending node is on +y. ω = 90°, i = 90°: periapsis over the north pole.
  const polar = orbitGuideGeometry({ semiMajorAxisKm: 7000, eccentricity: 0.1 }, { inclinationRad: 90 * DEG, raanRad: 90 * DEG, argOfPeriapsisRad: 90 * DEG })
  close(polar.ascendingNode, { x: 0, y: 1, z: 0 })
  // ω = 90°: both nodes are at the semi-latus rectum, p = a(1 − e²) = 6930 km.
  close(polar.ascendingNodeKm, { x: 0, y: 6930, z: 0 })
  close(polar.descendingNodeKm, { x: 0, y: -6930, z: 0 })
  close(polar.periapsisKm, { x: 0, y: 0, z: 6300 })
  close(polar.apoapsisKm, { x: 0, y: 0, z: -7700 })
  expect(polar.equatorial).toBe(false)
  // ω = 0: periapsis at the ascending node, whatever the inclination.
  const atNode = orbitGuideGeometry({ semiMajorAxisKm: 7000, eccentricity: 0.1 }, { inclinationRad: 51.6 * DEG, raanRad: 30 * DEG, argOfPeriapsisRad: 0 })
  close(atNode.periapsisKm, { x: 6300 * Math.cos(30 * DEG), y: 6300 * Math.sin(30 * DEG), z: 0 })
  close(atNode.ascendingNodeKm, atNode.periapsisKm)
  close(atNode.descendingNodeKm, { x: -7700 * Math.cos(30 * DEG), y: -7700 * Math.sin(30 * DEG), z: 0 })
})

it('reports the degenerate directions the strip explains', () => {
  expect(orbitGuideGeometry({ semiMajorAxisKm: 7000, eccentricity: 0 }, { inclinationRad: 45 * DEG, raanRad: 0, argOfPeriapsisRad: 0 }).circular).toBe(true)
  expect(orbitGuideGeometry({ semiMajorAxisKm: 7000, eccentricity: 0.01 }, { inclinationRad: 180 * DEG, raanRad: 0, argOfPeriapsisRad: 0 }).equatorial).toBe(true)
})
