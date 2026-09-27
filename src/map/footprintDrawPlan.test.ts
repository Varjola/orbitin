import { expect, it } from 'vitest'
import { SIMULATION_START_INSTANT } from '../core/constants.ts'
import { subSatellitePointFromEarthFixed } from '../simulation/groundTrack.ts'
import { createInstantaneousSensorGeometry, type SphericalSensorCap } from '../simulation/sensorFootprint.ts'
import { planFootprintDraw, type FootprintDrawPlan, type FootprintMapCoordinate } from './footprintDrawPlan.ts'

const DEFAULT_RADIUS_KM = 7_000
const DEFAULT_FOV_DEG = 20
const DEFAULT_SENSOR = { fieldOfViewHalfAngleRad: DEFAULT_FOV_DEG * Math.PI / 180, maxOffNadirSteeringRad: 0 }

function planFor(
  positionOrCoordinates: { x: number; y: number; z: number } | { longitudeDeg: number; latitudeDeg: number; radiusKm?: number },
  sensor: Partial<typeof DEFAULT_SENSOR> = {},
) {
  const position = 'longitudeDeg' in positionOrCoordinates
    ? sphericalPosition(positionOrCoordinates.longitudeDeg, positionOrCoordinates.latitudeDeg, positionOrCoordinates.radiusKm ?? DEFAULT_RADIUS_KM)
    : positionOrCoordinates
  const centre = subSatellitePointFromEarthFixed(position, SIMULATION_START_INSTANT)!
  const result = createInstantaneousSensorGeometry({ instant: SIMULATION_START_INSTANT, positionEarthFixedKm: position, centre, sensor: { ...DEFAULT_SENSOR, ...sensor } })
  if (result.kind !== 'valid') throw new Error(result.message)
  return { centre, cap: result.geometry.footprint, plan: planFootprintDraw(centre, result.geometry.footprint) }
}

function sphericalPosition(longitudeDeg: number, latitudeDeg: number, radiusKm: number): { x: number; y: number; z: number } {
  const longitude = longitudeDeg * Math.PI / 180
  const latitude = latitudeDeg * Math.PI / 180
  return { x: radiusKm * Math.cos(latitude) * Math.cos(longitude), y: radiusKm * Math.cos(latitude) * Math.sin(longitude), z: radiusKm * Math.sin(latitude) }
}

it('keeps an ordinary cap as one closed map path', () => {
  const { plan } = planFor({ x: 7000, y: 1000, z: 500 })
  expect(plan.longitudeOffsetsRad).toEqual([0])
  expect(plan.outlineClosed).toBe(true)
  expect(plan.fill.length).toBeGreaterThan(3)
  expect(plan.fill.every((point) => point.longitudeRad >= -Math.PI && point.longitudeRad <= Math.PI)).toBe(true)
})

it('draws an antimeridian cap as translated copies without a world-width chord', () => {
  const { plan } = planFor({ longitudeDeg: 179, latitudeDeg: 10, radiusKm: 7000 })
  expect(plan.longitudeOffsetsRad).toEqual([-2 * Math.PI, 0])
  for (let index = 1; index < plan.fill.length; index += 1) {
    expect(Math.abs(plan.fill[index].longitudeRad - plan.fill[index - 1].longitudeRad)).toBeLessThanOrEqual(Math.PI)
  }
})

it('adds an un-stroked pole edge to a cap containing the north pole', () => {
  const { plan } = planFor({ longitudeDeg: 0, latitudeDeg: 85, radiusKm: 7000 }, { fieldOfViewHalfAngleRad: 80 * Math.PI / 180 })
  expect(plan.northPoleIncluded).toBe(true)
  expect(plan.outlineClosed).toBe(false)
  const longitudes = plan.outline.map((point) => point.longitudeRad)
  expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeCloseTo(2 * Math.PI, 9)
  expect(plan.fill.some((point) => point.geodeticLatitudeRad === Math.PI / 2)).toBe(true)
})

it('does not promote a near-pole cap without pole containment', () => {
  const { plan } = planFor({ longitudeDeg: 0, latitudeDeg: 85, radiusKm: 7000 }, { fieldOfViewHalfAngleRad: 1 * Math.PI / 180 })
  expect(plan.northPoleIncluded).toBe(false)
  expect(plan.fill.every((point) => point.geodeticLatitudeRad < Math.PI / 2)).toBe(true)
})

it('returns an empty plan for an empty boundary', () => {
  const { centre } = planFor({ longitudeDeg: 0, latitudeDeg: 0, radiusKm: 7000 })
  const plan = planFootprintDraw(centre, { angularRadiusRad: 1, boundary: [] })
  expect(plan).toEqual({ fill: [], outline: [], outlineClosed: true, longitudeOffsetsRad: [], northPoleIncluded: false, southPoleIncluded: false })
})

interface CoverageError { readonly wrong: number; readonly double: number }

function coverageErrors(centre: ReturnType<typeof subSatellitePointFromEarthFixed>, cap: SphericalSensorCap, plan: FootprintDrawPlan): CoverageError {
  if (!centre) throw new Error('Expected a sub-satellite point.')
  let wrong = 0
  let double = 0
  for (let latitudeDeg = -89.5; latitudeDeg <= 89.5; latitudeDeg += 1) {
    const latitude = latitudeDeg * Math.PI / 180
    for (let longitudeDeg = -179.5; longitudeDeg <= 179.5; longitudeDeg += 1) {
      const longitude = longitudeDeg * Math.PI / 180
      const direction = { x: Math.cos(latitude) * Math.cos(longitude), y: Math.cos(latitude) * Math.sin(longitude), z: Math.sin(latitude) }
      const dot = centre.directionEarthFixed.x * direction.x + centre.directionEarthFixed.y * direction.y + centre.directionEarthFixed.z * direction.z
      const distance = Math.acos(Math.min(1, Math.max(-1, dot)))
      if (Math.abs(distance - cap.angularRadiusRad) < 1.5 * Math.PI / 180) continue
      const truth = distance <= cap.angularRadiusRad
      let copies = 0
      for (const offset of plan.longitudeOffsetsRad) {
        if (pointInPolygon(longitude, latitude, plan.fill, offset)) copies += 1
      }
      if ((copies >= 1) !== truth) wrong += 1
      if (copies > 1) double += 1
    }
  }
  return { wrong, double }
}

function pointInPolygon(longitude: number, latitude: number, polygon: readonly FootprintMapCoordinate[], offset: number): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]
    const prior = polygon[previous]
    const intersects = (current.geodeticLatitudeRad > latitude) !== (prior.geodeticLatitudeRad > latitude) &&
      longitude < (prior.longitudeRad + offset - current.longitudeRad - offset) * (latitude - current.geodeticLatitudeRad) /
        (prior.geodeticLatitudeRad - current.geodeticLatitudeRad) + current.longitudeRad + offset
    if (intersects) inside = !inside
  }
  return inside
}

const COVERAGE_CASES = [
  ['ordinary', 30, 10, 12_000, 30, 1],
  ['east seam', 179, 10, 12_000, 30, 2],
  ['west seam', -179, 10, 12_000, 30, 2],
  ['wide east', 170, 0, 20_000, 20, 2],
  ['wide west', -170, 0, 20_000, 20, 2],
  ['on seam', 180, -20, 12_000, 30, 2],
  ['tiny on seam', -180, 0, 7_000, 5, 2],
  ['north cap near seam', 175, 80, 12_000, 40, 2],
  ['north cap', 0, 80, 12_000, 40, 2],
  ['south cap', -120, -75, 12_000, 40, 2],
  ['over pole', 0, 90, 12_000, 30, 2],
  ['GEO-sized', 179.5, 0, 42_164, 8.6, 2],
] as const

it.each(COVERAGE_CASES)('has no coverage errors for %s', (_name, longitudeDeg, latitudeDeg, radiusKm, fovDeg, offsetCount) => {
  const { centre, cap, plan } = planFor({ longitudeDeg, latitudeDeg, radiusKm }, { fieldOfViewHalfAngleRad: fovDeg * Math.PI / 180 })
  expect(plan.longitudeOffsetsRad).toHaveLength(offsetCount)
  expect(coverageErrors(centre, cap, plan)).toEqual({ wrong: 0, double: 0 })
})
